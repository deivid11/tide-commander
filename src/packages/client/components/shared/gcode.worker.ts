/// <reference lib="webworker" />

import type { GcodeLayerData, GcodePathKind, GcodeStats, GcodeWorkerOutput } from './gcodeTypes';

interface MutableLayer {
  z: number;
  height: number;
  paths: Record<GcodePathKind, number[]>;
}

const PATH_KINDS: GcodePathKind[] = ['external', 'perimeter', 'infill', 'solid', 'support', 'skirt', 'other', 'travel'];

function emptyPaths(): Record<GcodePathKind, number[]> {
  return Object.fromEntries(PATH_KINDS.map((kind) => [kind, [] as number[]])) as unknown as Record<GcodePathKind, number[]>;
}

function classifyType(value: string): GcodePathKind {
  const type = value.toLowerCase();
  if (type.includes('external perimeter')) return 'external';
  if (type.includes('perimeter')) return 'perimeter';
  if (type.includes('support')) return 'support';
  if (type.includes('skirt') || type.includes('brim')) return 'skirt';
  if (type.includes('solid') || type.includes('top')) return 'solid';
  if (type.includes('infill') || type.includes('fill')) return 'infill';
  return 'other';
}

function parseDuration(value: string): number | undefined {
  let seconds = 0;
  let matched = false;
  for (const match of value.matchAll(/([\d.]+)\s*([dhms])/gi)) {
    matched = true;
    const amount = Number(match[1]);
    seconds += amount * (match[2].toLowerCase() === 'd' ? 86400 : match[2].toLowerCase() === 'h' ? 3600 : match[2].toLowerCase() === 'm' ? 60 : 1);
  }
  return matched ? seconds : undefined;
}

function numericMetadata(text: string, pattern: RegExp): number | undefined {
  const value = pattern.exec(text)?.[1];
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringMetadata(text: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^;\\s*${escaped}\\s*=\\s*(.+?)\\s*$`, 'mi').exec(text)?.[1].replace(/^"|"$/g, '');
}

function post(output: GcodeWorkerOutput, transfer: Transferable[] = []): void {
  self.postMessage(output, { transfer });
}

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const text = new TextDecoder().decode(event.data);
    const lines = text.split(/\r?\n/);
    const layers: MutableLayer[] = [];
    let layer: MutableLayer | null = null;
    let pendingLayer = false;
    let currentKind: GcodePathKind = 'other';
    let x = 0, y = 0, z = 0, e = 0, feed = 0;
    let absolutePosition = true;
    let absoluteExtrusion = true;
    let unitScale = 1;
    let printDistanceMm = 0;
    let travelDistanceMm = 0;
    let calculatedTimeSeconds = 0;
    let filamentMm = 0;
    let commands = 0;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith(';')) {
        if (/^;LAYER_CHANGE/i.test(trimmed)) pendingLayer = true;
        if (/^;LAYER:\s*\d+/i.test(trimmed)) {
          pendingLayer = true;
          // Cura normally announces a layer before its first Z move and does
          // not include PrusaSlicer's explicit ;Z metadata.
          currentKind = 'other';
        }
        const zMatch = /^;Z:\s*([-+\d.]+)/i.exec(trimmed);
        if (zMatch && pendingLayer) {
          z = Number(zMatch[1]);
          layer = { z, height: 0, paths: emptyPaths() };
          layers.push(layer);
          pendingLayer = false;
        }
        const heightMatch = /^;HEIGHT:\s*([-+\d.]+)/i.exec(trimmed);
        if (heightMatch && layer) layer.height = Number(heightMatch[1]);
        const typeMatch = /^;TYPE:\s*(.+)/i.exec(trimmed);
        if (typeMatch) currentKind = classifyType(typeMatch[1]);
        continue;
      }

      const code = trimmed.split(';', 1)[0].trim();
      const command = /^(G\d+|M\d+)/i.exec(code)?.[1].toUpperCase();
      if (!command) continue;
      commands++;
      if (command === 'G20') { unitScale = 25.4; continue; }
      if (command === 'G21') { unitScale = 1; continue; }
      if (command === 'G90') { absolutePosition = true; continue; }
      if (command === 'G91') { absolutePosition = false; continue; }
      if (command === 'M82') { absoluteExtrusion = true; continue; }
      if (command === 'M83') { absoluteExtrusion = false; continue; }
      const params = new Map<string, number>();
      for (const match of code.matchAll(/([XYZEF])\s*(-?(?:\d+(?:\.\d*)?|\.\d+))/gi)) {
        params.set(match[1].toUpperCase(), Number(match[2]) * (match[1].toUpperCase() === 'F' ? unitScale : unitScale));
      }
      if (command === 'G92') {
        if (params.has('X')) x = params.get('X')!;
        if (params.has('Y')) y = params.get('Y')!;
        if (params.has('Z')) z = params.get('Z')!;
        if (params.has('E')) e = params.get('E')!;
        continue;
      }
      if (command !== 'G0' && command !== 'G1' && command !== 'G2' && command !== 'G3') continue;

      const nextX = params.has('X') ? (absolutePosition ? params.get('X')! : x + params.get('X')!) : x;
      const nextY = params.has('Y') ? (absolutePosition ? params.get('Y')! : y + params.get('Y')!) : y;
      const nextZ = params.has('Z') ? (absolutePosition ? params.get('Z')! : z + params.get('Z')!) : z;
      const nextE = params.has('E') ? (absoluteExtrusion ? params.get('E')! : e + params.get('E')!) : e;
      if (pendingLayer && params.has('Z') && nextZ !== z) {
        layer = { z: nextZ, height: Math.abs(nextZ - (layers.at(-1)?.z ?? 0)), paths: emptyPaths() };
        layers.push(layer);
        pendingLayer = false;
      }
      if (params.has('F')) feed = params.get('F')!;
      const dx = nextX - x, dy = nextY - y, dz = nextZ - z;
      const distance = Math.hypot(dx, dy, dz);
      const extrusion = nextE - e;
      if (distance > 0 && feed > 0) calculatedTimeSeconds += distance / (feed / 60);

      if (layer && distance > 0) {
        const kind = extrusion > 0.00001 ? currentKind : 'travel';
        layer.paths[kind].push(x, y, z, nextX, nextY, nextZ);
        if (kind === 'travel') travelDistanceMm += distance;
        else {
          printDistanceMm += distance;
          filamentMm += extrusion;
          min[0] = Math.min(min[0], x, nextX); min[1] = Math.min(min[1], y, nextY); min[2] = Math.min(min[2], z, nextZ);
          max[0] = Math.max(max[0], x, nextX); max[1] = Math.max(max[1], y, nextY); max[2] = Math.max(max[2], z, nextZ);
        }
      }
      x = nextX; y = nextY; z = nextZ; e = nextE;
    }

    const slicerMatch = /^;\s*generated by\s+(.+)$/mi.exec(text);
    const estimatedLabel = /estimated printing time[^=]*=\s*(.+)$/mi.exec(text)?.[1].trim();
    const firstLayerLabel = /estimated first layer printing time[^=]*=\s*(.+)$/mi.exec(text)?.[1].trim();
    const metadataFilament = numericMetadata(text, /filament used \[mm\]\s*=\s*([\d.]+)/i);
    const stats: GcodeStats = {
      slicer: slicerMatch?.[1].trim() || 'Unknown slicer',
      estimatedTimeSeconds: estimatedLabel ? parseDuration(estimatedLabel) : calculatedTimeSeconds,
      estimatedTimeLabel: estimatedLabel,
      firstLayerTimeSeconds: firstLayerLabel ? parseDuration(firstLayerLabel) : undefined,
      filamentMm: metadataFilament ?? Math.max(filamentMm, 0),
      filamentGrams: numericMetadata(text, /total filament used \[g\]\s*=\s*([\d.]+)/i) ?? numericMetadata(text, /filament used \[g\]\s*=\s*([\d.]+)/i),
      filamentCm3: numericMetadata(text, /filament used \[cm3\]\s*=\s*([\d.]+)/i),
      filamentCost: numericMetadata(text, /total filament cost\s*=\s*([\d.]+)/i),
      material: stringMetadata(text, 'filament_type'),
      printer: stringMetadata(text, 'printer_settings_id'),
      nozzleDiameter: numericMetadata(text, /^;\s*nozzle_diameter\s*=\s*([\d.]+)/mi),
      nominalLayerHeight: numericMetadata(text, /^;\s*layer_height\s*=\s*([\d.]+)/mi),
      infill: stringMetadata(text, 'fill_density'),
      layers: layers.length,
      printDistanceMm,
      travelDistanceMm,
      bounds: {
        min: min.every(Number.isFinite) ? min as [number, number, number] : [0, 0, 0],
        max: max.every(Number.isFinite) ? max as [number, number, number] : [0, 0, 0],
      },
      commands,
    };
    const outputLayers: GcodeLayerData[] = layers.map((item) => ({
      z: item.z,
      height: item.height,
      paths: Object.fromEntries(PATH_KINDS
        .filter((kind) => item.paths[kind].length > 0)
        .map((kind) => [kind, Float32Array.from(item.paths[kind])])),
    }));
    const transfer = outputLayers.flatMap((item) => Object.values(item.paths).map((positions) => positions!.buffer));
    post({ type: 'result', layers: outputLayers, stats }, transfer);
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : 'GCODE_PARSE_FAILED' });
  }
};
