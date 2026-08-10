export interface FcStdMeshData {
  name: string;
  positions: Float32Array;
  normals?: Float32Array;
  indices: Uint32Array;
  color: [number, number, number];
  opacity: number;
}

export type FcStdWorkerOutput =
  | { type: 'progress'; current: number; total: number }
  | { type: 'result'; meshes: FcStdMeshData[]; objectCount: number }
  | { type: 'error'; message: string };

