import { STORAGE_KEYS, getStorage, setStorage } from './storage';

export interface CameraState {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

export interface CameraState2D {
  posX: number;
  posZ: number;
  zoom: number;
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

export function saveCameraState2D(posX: number, posZ: number, zoom: number): void {
  const state: CameraState2D = { posX, posZ, zoom };
  setStorage(STORAGE_KEYS.CAMERA_STATE_2D, state);
}

export function loadCameraState2D(): CameraState2D | null {
  return getStorage<CameraState2D | null>(STORAGE_KEYS.CAMERA_STATE_2D, null);
}
