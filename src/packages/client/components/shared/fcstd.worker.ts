/// <reference lib="webworker" />

import PizZip from 'pizzip';
import occtImport from 'occt-import-js';
import occtWasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import type { FcStdMeshData, FcStdWorkerOutput } from './fcstdTypes';

interface FcStdObject {
  name: string;
  label: string;
  shapeFile: string;
  visible: boolean;
  color: [number, number, number];
  opacity: number;
  appearanceFile?: string;
  hasGuiColor: boolean;
}

interface GuiProperties {
  visible?: boolean;
  color?: [number, number, number];
  opacity?: number;
  appearanceFile?: string;
}

interface OcctMesh {
  name?: string;
  color?: number[];
  attributes: {
    position: { array: number[] };
    normal?: { array: number[] };
  };
  index: { array: number[] };
}

interface OcctResult {
  success: boolean;
  meshes?: OcctMesh[];
}

interface OcctModule {
  ReadBrepFile(content: Uint8Array, params: Record<string, unknown> | null): OcctResult;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function propertyBody(body: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<Property\\s+name="${escaped}"[^>]*>([\\s\\S]*?)<\\/Property>`).exec(body)?.[1];
}

function attribute(body: string | undefined, tag: string, name: string): string | undefined {
  if (!body) return undefined;
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedTag}\\b[^>]*\\b${name}="([^"]*)"`).exec(body);
  return match ? decodeXml(match[1]) : undefined;
}

function decodeFreeCadColor(raw: string | undefined): [number, number, number] | undefined {
  if (!raw) return undefined;
  const value = Number(raw) >>> 0;
  return [((value >>> 24) & 0xff) / 255, ((value >>> 16) & 0xff) / 255, ((value >>> 8) & 0xff) / 255];
}

function decodePackedFreeCadColor(value: number): [number, number, number] {
  return [((value >>> 24) & 0xff) / 255, ((value >>> 16) & 0xff) / 255, ((value >>> 8) & 0xff) / 255];
}

function parseShapeAppearance(bytes: Uint8Array): { color: [number, number, number]; opacity: number } | null {
  // App::PropertyMaterialList v3: uint32 count followed by 36-byte material
  // records. The diffuse RGBA value starts at byte 8 and transparency at 24.
  if (bytes.byteLength < 40) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) < 1) return null;
  const diffuse = view.getUint32(8, true);
  const transparency = view.getFloat32(24, true);
  return {
    color: decodePackedFreeCadColor(diffuse),
    opacity: Number.isFinite(transparency) ? Math.max(0, Math.min(1, 1 - transparency)) : 1,
  };
}

function parseGuiDocument(xml: string | undefined): Map<string, GuiProperties> {
  const result = new Map<string, GuiProperties>();
  if (!xml) return result;

  const providers = /<ViewProvider\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/ViewProvider>/g;
  for (const match of xml.matchAll(providers)) {
    const body = match[2];
    const visibilityValue = attribute(propertyBody(body, 'Visibility'), 'Bool', 'value');
    const colorValue = attribute(propertyBody(body, 'ShapeColor'), 'PropertyColor', 'value');
    const transparencyValue = attribute(propertyBody(body, 'Transparency'), 'Integer', 'value');
    const appearanceFile = attribute(propertyBody(body, 'ShapeAppearance'), 'MaterialList', 'file');
    const transparency = Number(transparencyValue);
    result.set(decodeXml(match[1]), {
      visible: visibilityValue === undefined ? undefined : visibilityValue === 'true' || visibilityValue === '1',
      color: decodeFreeCadColor(colorValue),
      opacity: Number.isFinite(transparency) ? Math.max(0, Math.min(1, 1 - transparency / 100)) : undefined,
      appearanceFile,
    });
  }
  return result;
}

function parseDocument(xml: string | undefined, gui: Map<string, GuiProperties>): FcStdObject[] {
  if (!xml) return [];
  const objectData = /<ObjectData\b[^>]*>([\s\S]*?)<\/ObjectData>/.exec(xml)?.[1] ?? xml;
  const objects: FcStdObject[] = [];
  const objectPattern = /<Object\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/Object>/g;

  for (const match of objectData.matchAll(objectPattern)) {
    const name = decodeXml(match[1]);
    const body = match[2];
    const shapeFile = attribute(propertyBody(body, 'Shape'), 'Part', 'file');
    if (!shapeFile) continue;
    const label = attribute(propertyBody(body, 'Label'), 'String', 'value') || name;
    const visual = gui.get(name);
    objects.push({
      name,
      label,
      shapeFile,
      visible: visual?.visible !== false,
      color: visual?.color ?? [0.36, 0.75, 0.84],
      opacity: visual?.opacity ?? 1,
      appearanceFile: visual?.appearanceFile,
      hasGuiColor: visual?.color !== undefined,
    });
  }
  return objects;
}

function findZipFile(zip: PizZip, name: string): PizZip.ZipObject | null {
  const exact = zip.file(name);
  if (exact) return exact;
  const normalized = name.toLowerCase();
  const matchingName = Object.keys(zip.files).find((candidate) => candidate.toLowerCase() === normalized);
  return matchingName ? zip.file(matchingName) : null;
}

let occtPromise: Promise<OcctModule> | null = null;

function getOcct(): Promise<OcctModule> {
  if (!occtPromise) {
    occtPromise = occtImport({
      locateFile: (path: string) => path.endsWith('.wasm') ? occtWasmUrl : path,
    }) as Promise<OcctModule>;
  }
  return occtPromise;
}

function post(output: FcStdWorkerOutput, transfer: Transferable[] = []): void {
  self.postMessage(output, { transfer });
}

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const zip = new PizZip(event.data);
    const documentXml = zip.file('Document.xml')?.asText();
    const guiXml = zip.file('GuiDocument.xml')?.asText();
    const gui = parseGuiDocument(guiXml);
    const documentObjects = parseDocument(documentXml, gui);
    let selectedObjects = documentObjects.filter((object) => object.visible);
    if (selectedObjects.length === 0) selectedObjects = documentObjects;

    if (selectedObjects.length === 0) {
      selectedObjects = Object.keys(zip.files)
        .filter((name) => /\.(?:brp\d*|brep)$/i.test(name))
        .map((shapeFile) => ({
          name: shapeFile,
          label: shapeFile,
          shapeFile,
          visible: true,
          color: [0.36, 0.75, 0.84] as [number, number, number],
          opacity: 1,
          hasGuiColor: false,
        }));
    }

    for (const object of selectedObjects) {
      if (!object.appearanceFile) continue;
      const appearanceEntry = findZipFile(zip, object.appearanceFile);
      if (!appearanceEntry) continue;
      const appearance = parseShapeAppearance(appearanceEntry.asUint8Array());
      if (!appearance) continue;
      object.color = appearance.color;
      object.opacity = appearance.opacity;
      object.hasGuiColor = true;
    }

    // Multiple document objects can reference the same serialized shape.
    selectedObjects = selectedObjects.filter((object, index, all) =>
      all.findIndex((candidate) => candidate.shapeFile === object.shapeFile) === index,
    );
    if (selectedObjects.length === 0) throw new Error('NO_BREP_GEOMETRY');

    const occt = await getOcct();
    const meshes: FcStdMeshData[] = [];
    for (let index = 0; index < selectedObjects.length; index++) {
      const object = selectedObjects[index];
      post({ type: 'progress', current: index + 1, total: selectedObjects.length });
      const shapeEntry = findZipFile(zip, object.shapeFile);
      if (!shapeEntry) continue;
      const imported = occt.ReadBrepFile(shapeEntry.asUint8Array(), {
        linearDeflectionType: 'bounding_box_ratio',
        linearDeflection: 0.001,
        angularDeflection: 0.5,
      });
      if (!imported.success || !imported.meshes) continue;

      for (const importedMesh of imported.meshes) {
        const positions = Float32Array.from(importedMesh.attributes.position.array);
        const normals = importedMesh.attributes.normal
          ? Float32Array.from(importedMesh.attributes.normal.array)
          : undefined;
        const indices = Uint32Array.from(importedMesh.index.array);
        const importedColor = !object.hasGuiColor && importedMesh.color?.length === 3
          ? importedMesh.color as [number, number, number]
          : object.color;
        meshes.push({
          name: importedMesh.name || object.label,
          positions,
          normals,
          indices,
          color: importedColor,
          opacity: object.opacity,
        });
      }
    }

    if (meshes.length === 0) throw new Error('BREP_IMPORT_FAILED');
    const transfer = meshes.flatMap((mesh) => [
      mesh.positions.buffer,
      ...(mesh.normals ? [mesh.normals.buffer] : []),
      mesh.indices.buffer,
    ]);
    post({ type: 'result', meshes, objectCount: selectedObjects.length }, transfer);
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : 'FCSTD_IMPORT_FAILED' });
  }
};
