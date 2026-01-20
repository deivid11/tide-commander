import { STORAGE_KEYS, getStorage, setStorage } from './storage';

export interface CameraState {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

export function saveCameraState(
  position: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number }
): void {
  const state: CameraState = { position, target };
  setStorage(STORAGE_KEYS.CAMERA_STATE, state);
}

export function loadCameraState(): CameraState | null {
  return getStorage<CameraState | null>(STORAGE_KEYS.CAMERA_STATE, null);
}
