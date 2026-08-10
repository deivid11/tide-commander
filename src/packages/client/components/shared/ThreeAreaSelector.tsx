import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { copyTextToClipboard } from '../../utils/clipboard';

export type ThreeAreaShape = 'sphere' | 'box';

export interface ThreeAreaMark {
  id: string;
  shape: ThreeAreaShape;
  center: [number, number, number];
  size: [number, number, number];
  objectName?: string;
  surfaceNormal?: [number, number, number];
}

interface ThreeAreaSelectorProps {
  areas: ThreeAreaMark[];
  selectedId: string | null;
  placementShape: ThreeAreaShape | null;
  filename: string;
  filePath?: string;
  modelExtent: number;
  className?: string;
  onPlacementShapeChange: (shape: ThreeAreaShape | null) => void;
  onSelectedIdChange: (id: string | null) => void;
  onAreasChange: (areas: ThreeAreaMark[]) => void;
  onClose: () => void;
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(3)).toString();
}

export function buildThreeAreaPrompt(filename: string, filePath: string | undefined, areas: ThreeAreaMark[]): string {
  const path = filePath || filename;
  const descriptions = areas.map((area, index) => {
    const center = area.center.map(formatCoordinate).join(', ');
    const object = area.objectName ? ` objeto/componente \`${area.objectName}\`,` : '';
    const normal = area.surfaceNormal ? ` normal superficial [${area.surfaceNormal.map(formatCoordinate).join(', ')}]` : '';
    if (area.shape === 'sphere') {
      return `${index + 1}. Esfera:${object} centro XYZ [${center}] mm, radio ${formatCoordinate(area.size[0] / 2)} mm.${normal}`;
    }
    return `${index + 1}. Cubo/caja:${object} centro XYZ [${center}] mm, tamaño XYZ [${area.size.map(formatCoordinate).join(', ')}] mm.${normal}`;
  });
  const json = JSON.stringify({
    file: path,
    coordinateSystem: 'original-model-coordinates',
    units: 'mm',
    areas: areas.map((area) => ({
      shape: area.shape,
      center: { x: area.center[0], y: area.center[1], z: area.center[2] },
      ...(area.objectName ? { object: area.objectName } : {}),
      ...(area.surfaceNormal ? { surfaceNormal: { x: area.surfaceNormal[0], y: area.surfaceNormal[1], z: area.surfaceNormal[2] } } : {}),
      ...(area.shape === 'sphere'
        ? { radius: area.size[0] / 2 }
        : { size: { x: area.size[0], y: area.size[1], z: area.size[2] } }),
    })),
  }, null, 2);
  return [
    `Quiero modificar estas áreas del modelo \`${path}\`.`,
    'Las coordenadas están en el sistema original del archivo y las unidades se interpretan como milímetros.',
    '',
    ...descriptions,
    '',
    '```json',
    json,
    '```',
  ].join('\n');
}

export function createThreeAreaMarkerGroup(
  areas: ThreeAreaMark[],
  modelCenter: THREE.Vector3,
  selectedId: string | null,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'tide-area-markers';
  for (const area of areas) {
    const geometry = area.shape === 'sphere'
      ? new THREE.SphereGeometry(Math.max(area.size[0] / 2, 0.001), 24, 16)
      : new THREE.BoxGeometry(...area.size.map((value) => Math.max(value, 0.001)) as [number, number, number]);
    const selected = area.id === selectedId;
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: selected ? 0xffca48 : 0x38d7ff,
      transparent: true,
      opacity: selected ? 0.22 : 0.13,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: selected ? 0xffd75f : 0x70e4ff,
      transparent: true,
      opacity: 0.95,
      wireframe: true,
      depthTest: false,
    });
    const marker = new THREE.Group();
    marker.userData.areaId = area.id;
    marker.position.set(...area.center).sub(modelCenter);
    const fill = new THREE.Mesh(geometry, fillMaterial);
    const wire = new THREE.Mesh(geometry, wireMaterial);
    fill.renderOrder = 20;
    wire.renderOrder = 21;
    marker.add(fill, wire);
    root.add(marker);
  }
  return root;
}

export function disposeThreeAreaMarkerGroup(group: THREE.Group | null): void {
  if (!group) return;
  group.removeFromParent();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

interface ThreeAreaMarkerDragOptions {
  enabled: boolean;
  rendererRef: RefObject<THREE.WebGLRenderer | null>;
  cameraRef: RefObject<THREE.PerspectiveCamera | null>;
  controlsRef: RefObject<OrbitControls | null>;
  modelObjectsRef: RefObject<THREE.Object3D[]>;
  modelCenterRef: RefObject<THREE.Vector3>;
  markerGroupRef: RefObject<THREE.Group | null>;
  renderRef: RefObject<(() => void) | null>;
  setAreas: Dispatch<SetStateAction<ThreeAreaMark[]>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
}

/** Drag an existing volume across the model surface, falling back to a camera-facing plane off-model. */
export function useThreeAreaMarkerDrag({
  enabled,
  rendererRef,
  cameraRef,
  controlsRef,
  modelObjectsRef,
  modelCenterRef,
  markerGroupRef,
  renderRef,
  setAreas,
  setSelectedId,
}: ThreeAreaMarkerDragOptions): void {
  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!enabled || !renderer || !camera) return;
    const canvas = renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const fallbackPlane = new THREE.Plane();
    let drag: {
      pointerId: number;
      areaId: string;
      marker: THREE.Object3D;
      center: [number, number, number];
      objectName?: string;
      surfaceNormal?: [number, number, number];
    } | null = null;

    const updateRay = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        (event.clientX - rect.left) / rect.width * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
    };
    const findAreaMarker = (object: THREE.Object3D | null): THREE.Object3D | null => {
      let current = object;
      while (current && typeof current.userData.areaId !== 'string') current = current.parent;
      return current;
    };
    const onPointerDown = (event: PointerEvent) => {
      const markerRoot = markerGroupRef.current;
      if (event.button !== 0 || !markerRoot) return;
      updateRay(event);
      const marker = findAreaMarker(raycaster.intersectObject(markerRoot, true)[0]?.object ?? null);
      if (!marker) return;
      const worldPosition = marker.getWorldPosition(new THREE.Vector3());
      fallbackPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), worldPosition);
      drag = {
        pointerId: event.pointerId,
        areaId: marker.userData.areaId as string,
        marker,
        center: worldPosition.clone().add(modelCenterRef.current).toArray() as [number, number, number],
      };
      if (controlsRef.current) controlsRef.current.enabled = false;
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      updateRay(event);
      const surfaceHit = raycaster.intersectObjects(modelObjectsRef.current, false)[0];
      const point = surfaceHit?.point ?? raycaster.ray.intersectPlane(fallbackPlane, new THREE.Vector3());
      if (!point) return;
      drag.marker.position.copy(point);
      drag.center = point.clone().add(modelCenterRef.current).toArray() as [number, number, number];
      if (surfaceHit) {
        drag.objectName = surfaceHit.object.name || undefined;
        drag.surfaceNormal = surfaceHit.face?.normal.clone().transformDirection(surfaceHit.object.matrixWorld).toArray() as [number, number, number] | undefined;
      }
      renderRef.current?.();
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const finishDrag = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const { areaId, center, objectName, surfaceNormal } = drag;
      drag = null;
      setAreas((current) => current.map((area) => area.id === areaId
        ? { ...area, center, ...(objectName ? { objectName } : {}), ...(surfaceNormal ? { surfaceNormal } : {}) }
        : area));
      setSelectedId(areaId);
      if (controlsRef.current) controlsRef.current.enabled = true;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    canvas.addEventListener('pointerdown', onPointerDown, true);
    canvas.addEventListener('pointermove', onPointerMove, true);
    canvas.addEventListener('pointerup', finishDrag, true);
    canvas.addEventListener('pointercancel', finishDrag, true);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown, true);
      canvas.removeEventListener('pointermove', onPointerMove, true);
      canvas.removeEventListener('pointerup', finishDrag, true);
      canvas.removeEventListener('pointercancel', finishDrag, true);
      if (controlsRef.current) controlsRef.current.enabled = true;
    };
  }, [enabled, cameraRef, controlsRef, markerGroupRef, modelCenterRef, modelObjectsRef, renderRef, rendererRef, setAreas, setSelectedId]);
}

export function ThreeAreaSelector({
  areas,
  selectedId,
  placementShape,
  filename,
  filePath,
  modelExtent,
  className,
  onPlacementShapeChange,
  onSelectedIdChange,
  onAreasChange,
  onClose,
}: ThreeAreaSelectorProps) {
  const { t } = useTranslation('terminal');
  const [copied, setCopied] = useState(false);
  const selected = areas.find((area) => area.id === selectedId) ?? null;
  const sizeStep = Math.max(modelExtent / 200, 0.01);
  const maximumSize = Math.max(modelExtent * 1.5, sizeStep * 2);

  useEffect(() => { setCopied(false); }, [areas]);

  const updateSelected = (update: Partial<ThreeAreaMark>) => {
    if (!selected) return;
    onAreasChange(areas.map((area) => area.id === selected.id ? { ...area, ...update } : area));
  };
  const updateVector = (key: 'center' | 'size', index: number, value: number) => {
    if (!selected || !Number.isFinite(value)) return;
    const vector = [...selected[key]] as [number, number, number];
    vector[index] = key === 'size' ? Math.max(value, 0.001) : value;
    if (selected.shape === 'sphere' && key === 'size') vector.fill(vector[index]);
    updateSelected({ [key]: vector });
  };
  const removeSelected = () => {
    if (!selected) return;
    onAreasChange(areas.filter((area) => area.id !== selected.id));
    onSelectedIdChange(null);
  };
  const copyAreas = async () => {
    if (areas.length === 0) return;
    await copyTextToClipboard(buildThreeAreaPrompt(filename, filePath, areas));
    setCopied(true);
  };

  return (
    <aside className={`three-area-panel${className ? ` ${className}` : ''}`}>
      <header>
        <strong>{t('fileViewerModal.areaSelection')}</strong>
        <button type="button" onClick={onClose} aria-label={t('fileViewerModal.closeAreas')}>×</button>
      </header>
      <p>{placementShape ? t('fileViewerModal.areaClickHint') : t('fileViewerModal.areaSelectShape')}</p>
      <div className="three-area-shapes" role="group" aria-label={t('fileViewerModal.areaShape')}>
        {(['sphere', 'box'] as const).map((shape) => (
          <button
            key={shape}
            type="button"
            className={placementShape === shape ? 'active' : undefined}
            onClick={() => onPlacementShapeChange(placementShape === shape ? null : shape)}
            aria-pressed={placementShape === shape}
          >
            <span aria-hidden="true">{shape === 'sphere' ? '●' : '◆'}</span>
            {t(`fileViewerModal.areaShapes.${shape}`)}
          </button>
        ))}
      </div>
      {areas.length > 0 && (
        <div className="three-area-list">
          {areas.map((area, index) => (
            <button key={area.id} type="button" className={area.id === selectedId ? 'active' : undefined} onClick={() => onSelectedIdChange(area.id)}>
              {index + 1}. {t(`fileViewerModal.areaShapes.${area.shape}`)}
              <small>{area.objectName ? `${area.objectName} · ` : ''}{area.center.map(formatCoordinate).join(', ')}</small>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="three-area-editor">
          <span>{t('fileViewerModal.areaCenter')} XYZ</span>
          <div className="three-area-vector">
            {selected.center.map((value, index) => <label key={index}>{'XYZ'[index]}<input type="number" step="0.1" value={formatCoordinate(value)} onChange={(event) => updateVector('center', index, Number(event.target.value))} /></label>)}
          </div>
          <span>{selected.shape === 'sphere' ? t('fileViewerModal.areaDiameter') : `${t('fileViewerModal.areaSize')} XYZ`}</span>
          <div className="three-area-size-sliders">
            {(selected.shape === 'sphere' ? selected.size.slice(0, 1) : selected.size).map((value, index) => (
              <label key={index}>
                <span>{selected.shape === 'sphere' ? 'Ø' : 'XYZ'[index]}</span>
                <input type="range" min={sizeStep} max={maximumSize} step={sizeStep} value={value} onChange={(event) => updateVector('size', index, Number(event.target.value))} />
                <input type="number" min="0.001" step={sizeStep} value={formatCoordinate(value)} onChange={(event) => updateVector('size', index, Number(event.target.value))} />
              </label>
            ))}
          </div>
          <button type="button" className="danger" onClick={removeSelected}>{t('fileViewerModal.removeArea')}</button>
        </div>
      )}
      <footer>
        <button type="button" onClick={() => { onAreasChange([]); onSelectedIdChange(null); }} disabled={areas.length === 0}>{t('fileViewerModal.clearAreas')}</button>
        <button type="button" className="primary" onClick={() => void copyAreas()} disabled={areas.length === 0}>{copied ? t('fileViewerModal.areasCopied') : t('fileViewerModal.copyAreas')}</button>
      </footer>
    </aside>
  );
}
