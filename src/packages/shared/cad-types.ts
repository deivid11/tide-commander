export type CadOutputFormat = 'fcstd' | 'stl' | 'step';

export type CadView =
  | 'isometric'
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom';

export interface CadObjectSelection {
  /** FreeCAD document name. May be omitted when exactly one document exists. */
  document?: string;
  /** Internal object names, labels, or aliases returned by build(). */
  objects?: string[];
}

export interface CadOutputRequest extends CadObjectSelection {
  format: CadOutputFormat;
  /** Path relative to the job workspace. */
  path: string;
  linearDeflection?: number;
  angularDeflection?: number;
}

export interface CadRenderRequest extends CadObjectSelection {
  /** PNG path relative to the job workspace. */
  path: string;
  view?: CadView;
  width?: number;
  height?: number;
  /** CSS-style hex color used for every selected object. */
  color?: string;
  /** CSS-style hex color, or "transparent". */
  background?: string;
  edgeColor?: string;
  edges?: boolean;
  fitMargin?: number;
  linearDeflection?: number;
}

export interface CadObjectReference {
  document?: string;
  object: string;
}

export interface CadClearanceCheck {
  type: 'clearance';
  name?: string;
  a: CadObjectReference;
  b: CadObjectReference;
  /** Minimum acceptable distance in millimetres. */
  minimum: number;
}

export interface CadIntersectionCheck {
  type: 'intersection';
  name?: string;
  a: CadObjectReference;
  b: CadObjectReference;
  /** Maximum acceptable common volume in cubic millimetres. Defaults to 0. */
  maximumVolume?: number;
}

export type CadCheckRequest = CadClearanceCheck | CadIntersectionCheck;

export interface CadJobRequest {
  /** Absolute directory containing the model source and all generated artifacts. */
  workspace: string;
  /** Python model script, relative to workspace. */
  script: string;
  /** Function invoked after loading the script. Defaults to build; null means load only. */
  entrypoint?: string | null;
  parameters?: Record<string, unknown>;
  outputs?: CadOutputRequest[];
  renders?: CadRenderRequest[];
  checks?: CadCheckRequest[];
  timeoutMs?: number;
}

export interface CadBoundingBox {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}

export interface CadShapeValidation {
  document: string;
  object: string;
  label: string;
  shapeType: string;
  valid: boolean;
  closed: boolean;
  solids: number;
  volumeMm3: number;
  areaMm2: number;
  boundingBox: CadBoundingBox;
  passed: boolean;
  issues: string[];
}

export interface CadCheckResult {
  type: CadCheckRequest['type'];
  name: string;
  passed: boolean;
  distanceMm?: number;
  commonVolumeMm3?: number;
  expected: Record<string, number>;
}

export interface CadArtifactResult {
  type: CadOutputFormat | 'png';
  path: string;
  sizeBytes: number;
  document: string;
  objects: string[];
  facets?: number;
  view?: CadView;
  meshValidation?: {
    solid: boolean;
    selfIntersections: boolean;
    nonManifolds: boolean;
    volumeMm3: number;
    volumeErrorPercent: number;
    passed: boolean;
  };
}

export interface CadRunResult {
  ok: boolean;
  freecadVersion?: string;
  durationMs: number;
  artifacts: CadArtifactResult[];
  validations: CadShapeValidation[];
  checks: CadCheckResult[];
  documents: string[];
  error?: string;
  traceback?: string;
}

export type CadJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface CadJob {
  id: string;
  status: CadJobStatus;
  request: CadJobRequest;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: CadRunResult;
  error?: string;
  stdout: string;
  stderr: string;
}

export interface CadCapabilities {
  available: boolean;
  engine: 'freecadcmd';
  command?: string;
  version?: string;
  renderBackend: 'pillow-software';
  formats: Array<CadOutputFormat | 'png'>;
  error?: string;
}
