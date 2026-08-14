export type FcStdRgb = [number, number, number];

export interface FcStdVisual {
  visible?: boolean;
  color?: FcStdRgb;
  opacity?: number;
  appearanceFile?: string;
}

export interface FcStdDocumentObject {
  name: string;
  label: string;
  shapeFile: string;
  visible: boolean;
  color: FcStdRgb;
  opacity: number;
  appearanceFile?: string;
  hasExplicitColor: boolean;
}

export const DEFAULT_FCSTD_COLOR: FcStdRgb = [0.36, 0.75, 0.84];

export function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function propertyBody(body: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<Property\\s+name="${escaped}"[^>]*>([\\s\\S]*?)<\\/Property>`).exec(body)?.[1];
}

export function attribute(body: string | undefined, tag: string, name: string): string | undefined {
  if (!body) return undefined;
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedTag}\\b[^>]*\\b${name}="([^"]*)"`).exec(body);
  return match ? decodeXml(match[1]) : undefined;
}

export function decodeFreeCadColor(raw: string | undefined): FcStdRgb | undefined {
  if (!raw) return undefined;
  const value = Number(raw) >>> 0;
  if (!Number.isFinite(Number(raw))) return undefined;
  return decodePackedFreeCadColor(value);
}

export function decodePackedFreeCadColor(value: number): FcStdRgb {
  return [((value >>> 24) & 0xff) / 255, ((value >>> 16) & 0xff) / 255, ((value >>> 8) & 0xff) / 255];
}

export function parseShapeAppearance(bytes: Uint8Array): { color: FcStdRgb; opacity: number } | null {
  // App::PropertyMaterialList v3: uint32 count followed by 36-byte material
  // records. Ambient at byte 4, diffuse RGBA at byte 8, shininess at 20,
  // transparency at 24.
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

export function parseVisualProperties(body: string): FcStdVisual {
  const visibilityValue = attribute(propertyBody(body, 'Visibility'), 'Bool', 'value');
  const colorValue = attribute(propertyBody(body, 'ShapeColor'), 'PropertyColor', 'value')
    ?? attribute(propertyBody(body, 'DiffuseColor'), 'PropertyColor', 'value');
  const transparencyValue = attribute(propertyBody(body, 'Transparency'), 'Integer', 'value');
  const appearanceFile = attribute(propertyBody(body, 'ShapeAppearance'), 'MaterialList', 'file');
  const transparency = Number(transparencyValue);
  return {
    visible: visibilityValue === undefined ? undefined : visibilityValue === 'true' || visibilityValue === '1',
    color: decodeFreeCadColor(colorValue),
    opacity: Number.isFinite(transparency) ? Math.max(0, Math.min(1, 1 - transparency / 100)) : undefined,
    appearanceFile,
  };
}

export function parseGuiDocument(xml: string | undefined): Map<string, FcStdVisual> {
  const result = new Map<string, FcStdVisual>();
  if (!xml) return result;

  const providers = /<ViewProvider\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/ViewProvider>/g;
  for (const match of xml.matchAll(providers)) {
    result.set(decodeXml(match[1]), parseVisualProperties(match[2]));
  }
  return result;
}

export function mergeVisuals(gui: FcStdVisual | undefined, app: FcStdVisual): FcStdVisual {
  return {
    visible: gui?.visible ?? app.visible,
    color: gui?.color ?? app.color,
    opacity: gui?.opacity ?? app.opacity,
    appearanceFile: gui?.appearanceFile ?? app.appearanceFile,
  };
}

export function parseDocumentObjects(xml: string | undefined, gui: Map<string, FcStdVisual>): FcStdDocumentObject[] {
  if (!xml) return [];
  const objectData = /<ObjectData\b[^>]*>([\s\S]*?)<\/ObjectData>/.exec(xml)?.[1] ?? xml;
  const objects: FcStdDocumentObject[] = [];
  const objectPattern = /<Object\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/Object>/g;

  for (const match of objectData.matchAll(objectPattern)) {
    const name = decodeXml(match[1]);
    const body = match[2];
    const shapeFile = attribute(propertyBody(body, 'Shape'), 'Part', 'file');
    if (!shapeFile) continue;
    const label = attribute(propertyBody(body, 'Label'), 'String', 'value') || name;
    const visual = mergeVisuals(gui.get(name), parseVisualProperties(body));
    objects.push({
      name,
      label,
      shapeFile,
      visible: visual.visible !== false,
      color: visual.color ?? DEFAULT_FCSTD_COLOR,
      opacity: visual.opacity ?? 1,
      appearanceFile: visual.appearanceFile,
      hasExplicitColor: visual.color !== undefined,
    });
  }
  return objects;
}
