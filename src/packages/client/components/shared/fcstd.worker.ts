/// <reference lib="webworker" />

import PizZip from 'pizzip';
import occtImport from 'occt-import-js';
import occtWasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import type { FcStdMeshData, FcStdWorkerOutput } from './fcstdTypes';
import {
  DEFAULT_FCSTD_COLOR,
  parseDocumentObjects,
  parseGuiDocument,
  parseShapeAppearance,
} from './fcstdColors';

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
    const documentObjects = parseDocumentObjects(documentXml, gui);
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
          color: DEFAULT_FCSTD_COLOR,
          opacity: 1,
          hasExplicitColor: false,
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
      object.hasExplicitColor = true;
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
        const importedColor = !object.hasExplicitColor && importedMesh.color?.length === 3
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
