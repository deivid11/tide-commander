export type GcodePathKind = 'external' | 'perimeter' | 'infill' | 'solid' | 'support' | 'skirt' | 'other' | 'travel';

export interface GcodeLayerData {
  z: number;
  height: number;
  paths: Partial<Record<GcodePathKind, Float32Array>>;
}

export interface GcodeStats {
  slicer: string;
  estimatedTimeSeconds?: number;
  estimatedTimeLabel?: string;
  firstLayerTimeSeconds?: number;
  filamentMm: number;
  filamentGrams?: number;
  filamentCm3?: number;
  filamentCost?: number;
  material?: string;
  printer?: string;
  nozzleDiameter?: number;
  nominalLayerHeight?: number;
  infill?: string;
  layers: number;
  printDistanceMm: number;
  travelDistanceMm: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  commands: number;
}

export type GcodeWorkerOutput =
  | { type: 'result'; layers: GcodeLayerData[]; stats: GcodeStats }
  | { type: 'error'; message: string };
