import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { authFetch } from '../../utils/storage';
import { ThreeViewerSettings } from './ThreeViewerSettings';
import { getThreeViewerPreferences, setThreeViewerPreferences } from './threeViewerPreferences';
import { useRecentThreeFiles, viewerFilePathFromUrl } from './useRecentThreeFiles';
import { ThreeAxisLegend, ThreeViewShortcuts, type ThreeViewDirection } from './ThreeViewShortcuts';
import {
  createThreeAreaMarkerGroup,
  disposeThreeAreaMarkerGroup,
  ThreeAreaSelector,
  useThreeAreaMarkerDrag,
  type ThreeAreaMark,
  type ThreeAreaShape,
} from './ThreeAreaSelector';

interface StlViewerProps {
  url: string;
  filename: string;
  filePath?: string;
  onFileSelect?: (path: string) => void;
}

interface ModelInfo {
  triangles: number;
  dimensions: [number, number, number];
}

function formatDimension(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

/** Interactive STL preview supporting both binary and ASCII STL files. */
export function StlViewer({ url, filename, filePath, onFileSelect }: StlViewerProps) {
  const { t } = useTranslation('terminal');
  const containerRef = useRef<HTMLDivElement>(null);
  const resetViewRef = useRef<(() => void) | null>(null);
  const setViewRef = useRef<((view: ThreeViewDirection) => void) | null>(null);
  const renderRef = useRef<(() => void) | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const edgeMaterialRef = useRef<THREE.LineBasicMaterial | null>(null);
  const edgeObjectRef = useRef<THREE.LineSegments | null>(null);
  const lightsRef = useRef<{ hemisphere: THREE.HemisphereLight; key: THREE.DirectionalLight; fill: THREE.DirectionalLight } | null>(null);
  const clippingPlanesRef = useRef<{ lower: THREE.Plane; upper: THREE.Plane } | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const raycastObjectsRef = useRef<THREE.Object3D[]>([]);
  const modelCenterRef = useRef(new THREE.Vector3());
  const defaultAreaSizeRef = useRef(1);
  const areaMarkerGroupRef = useRef<THREE.Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [initialPreferences] = useState(getThreeViewerPreferences);
  const [modelColor, setModelColor] = useState(initialPreferences.modelColor);
  const [backgroundColor, setBackgroundColor] = useState(initialPreferences.backgroundColor);
  const [lightIntensity, setLightIntensity] = useState(initialPreferences.lightIntensity);
  const [modelOpacity, setModelOpacity] = useState(initialPreferences.modelOpacity);
  const [showEdges, setShowEdges] = useState(initialPreferences.showEdges);
  const [layerMode, setLayerMode] = useState(false);
  const [layerBottom, setLayerBottom] = useState(0);
  const [layerTop, setLayerTop] = useState(100);
  const [areaPanelOpen, setAreaPanelOpen] = useState(false);
  const [placementShape, setPlacementShape] = useState<ThreeAreaShape | null>(null);
  const [areas, setAreas] = useState<ThreeAreaMark[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const effectiveFilePath = filePath || viewerFilePathFromUrl(url);
  const recentFiles = useRecentThreeFiles(effectiveFilePath, filename, 'stl');

  useThreeAreaMarkerDrag({
    enabled: Boolean(modelInfo) && placementShape === null,
    rendererRef,
    cameraRef,
    controlsRef,
    modelObjectsRef: raycastObjectsRef,
    modelCenterRef,
    markerGroupRef: areaMarkerGroupRef,
    renderRef,
    setAreas,
    setSelectedId: setSelectedAreaId,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const abortController = new AbortController();
    let disposed = false;
    let geometry: THREE.BufferGeometry | null = null;
    let material: THREE.MeshStandardMaterial | null = null;
    let edgeGeometry: THREE.EdgesGeometry | null = null;
    let edgeMaterial: THREE.LineBasicMaterial | null = null;
    let axesHelper: THREE.AxesHelper | null = null;

    setLoading(true);
    setError(null);
    setModelInfo(null);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x11141a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 10000);
    cameraRef.current = camera;
    camera.up.set(0, 0, 1);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setLoading(false);
      setError(t('fileViewerModal.webglUnavailable'));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    rendererRef.current = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.localClippingEnabled = true;
    renderer.domElement.className = 'stl-viewer-canvas';
    renderer.domElement.setAttribute('aria-label', t('fileViewerModal.previewLabel', { filename }));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.addEventListener('change', () => renderer.render(scene, camera));

    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x263044, 2.2);
    scene.add(hemisphereLight);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x7aaeff, 1.1);
    fillLight.position.set(-4, 1, -3);
    scene.add(fillLight);
    lightsRef.current = { hemisphere: hemisphereLight, key: keyLight, fill: fillLight };
    renderRef.current = () => renderer.render(scene, camera);

    clippingPlanesRef.current = {
      lower: new THREE.Plane(new THREE.Vector3(0, 0, 1), 1e9),
      upper: new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e9),
    };

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.render(scene, camera);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const load = async () => {
      try {
        const response = await authFetch(url, { signal: abortController.signal });
        if (!response.ok) {
          let message = `Could not load STL (${response.status})`;
          try {
            const body = await response.json();
            if (typeof body?.error === 'string') message = body.error;
          } catch { /* The binary endpoint may return a non-JSON error. */ }
          throw new Error(message);
        }

        const buffer = await response.arrayBuffer();
        if (disposed) return;

        geometry = new STLLoader().parse(buffer);
        if (!geometry.getAttribute('position')?.count) {
          throw new Error(t('fileViewerModal.emptyStl'));
        }
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        const size = geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, 1);
        modelCenterRef.current.copy(geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3());
        defaultAreaSizeRef.current = Math.max(size.x, size.y, size.z, 0.001) * 0.12;
        geometry.center();
        geometry.computeBoundingSphere();

        material = new THREE.MeshStandardMaterial({
          color: 0x58c7d9,
          vertexColors: false,
          metalness: 0.08,
          roughness: 0.62,
          side: THREE.DoubleSide,
        });
        materialRef.current = material;
        const mesh = new THREE.Mesh(geometry, material);
        raycastObjectsRef.current = [mesh];
        scene.add(mesh);

        edgeGeometry = new THREE.EdgesGeometry(geometry, 28);
        edgeMaterial = new THREE.LineBasicMaterial({ color: 0x18242b, transparent: true, opacity: 0.52 });
        const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        edgeMaterialRef.current = edgeMaterial;
        edgeObjectRef.current = edges;
        scene.add(edges);

        const axisLength = Math.max(size.x, size.y, size.z, 0.001) * 0.3;
        axesHelper = new THREE.AxesHelper(axisLength);
        axesHelper.position.set(-size.x / 2, -size.y / 2, -size.z / 2);
        axesHelper.renderOrder = 5;
        scene.add(axesHelper);

        const radius = Math.max(geometry.boundingSphere?.radius ?? 1, 0.001);
        const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
        const distance = Math.max(radius / Math.sin(halfFov) * 1.15, 0.01);
        const setView = (view: ThreeViewDirection) => {
          camera.near = Math.max(distance / 1000, 0.0001);
          camera.far = Math.max(distance * 100, 10);
          const direction = view === 'x'
            ? new THREE.Vector3(1, 0, 0)
            : view === 'y'
              ? new THREE.Vector3(0, 1, 0)
              : view === 'z'
                ? new THREE.Vector3(0, 0, 1)
                : new THREE.Vector3(1, -1, 0.82).normalize();
          camera.up.set(0, view === 'z' ? 1 : 0, view === 'z' ? 0 : 1);
          camera.position.copy(direction.multiplyScalar(distance));
          camera.updateProjectionMatrix();
          controls.target.set(0, 0, 0);
          controls.minDistance = radius * 0.05;
          controls.maxDistance = distance * 20;
          controls.update();
          renderer.render(scene, camera);
        };
        const fitView = () => setView('iso');
        setViewRef.current = setView;
        resetViewRef.current = fitView;
        fitView();

        const handleShortcut = (event: KeyboardEvent) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          const key = event.key.toLowerCase();
          const view = key === 'x' || key === '1' ? 'x'
            : key === 'y' || key === '2' ? 'y'
              : key === 'z' || key === '3' ? 'z'
                : key === 'i' || key === '4' ? 'iso' : null;
          if (!view) return;
          event.preventDefault();
          setView(view);
        };
        renderer.domElement.tabIndex = 0;
        renderer.domElement.addEventListener('pointerdown', () => renderer.domElement.focus());
        renderer.domElement.addEventListener('keydown', handleShortcut);

        setModelInfo({
          triangles: Math.floor(geometry.getAttribute('position').count / 3),
          dimensions: [size.x, size.y, size.z],
        });
        setLoading(false);
      } catch (loadError) {
        if (abortController.signal.aborted || disposed) return;
        setError(loadError instanceof Error ? loadError.message : t('fileViewerModal.renderError'));
        setLoading(false);
      }
    };

    void load();

    return () => {
      disposed = true;
      abortController.abort();
      resetViewRef.current = null;
      setViewRef.current = null;
      renderRef.current = null;
      sceneRef.current = null;
      materialRef.current = null;
      edgeMaterialRef.current = null;
      edgeObjectRef.current = null;
      lightsRef.current = null;
      clippingPlanesRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      raycastObjectsRef.current = [];
      disposeThreeAreaMarkerGroup(areaMarkerGroupRef.current);
      areaMarkerGroupRef.current = null;
      resizeObserver.disconnect();
      controls.dispose();
      geometry?.dispose();
      material?.dispose();
      edgeGeometry?.dispose();
      edgeMaterial?.dispose();
      axesHelper?.geometry.dispose();
      if (axesHelper) {
        const axisMaterials = Array.isArray(axesHelper.material) ? axesHelper.material : [axesHelper.material];
        axisMaterials.forEach((axisMaterial) => axisMaterial.dispose());
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url, filename, t]);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.background = new THREE.Color(backgroundColor);
    if (materialRef.current) {
      materialRef.current.color.set(modelColor);
      materialRef.current.transparent = modelOpacity < 100;
      materialRef.current.opacity = modelOpacity / 100;
      materialRef.current.depthWrite = modelOpacity >= 100;
      materialRef.current.needsUpdate = true;
    }
    const lights = lightsRef.current;
    if (lights) {
      const scale = lightIntensity / 100;
      lights.hemisphere.intensity = 2.2 * scale;
      lights.key.intensity = 2.4 * scale;
      lights.fill.intensity = 1.1 * scale;
    }
    if (edgeObjectRef.current) edgeObjectRef.current.visible = showEdges;
    renderRef.current?.();
  }, [modelColor, backgroundColor, lightIntensity, modelOpacity, showEdges, modelInfo]);

  useEffect(() => {
    setThreeViewerPreferences({
      modelColor,
      backgroundColor,
      lightIntensity,
      modelOpacity,
      showEdges,
    });
  }, [modelColor, backgroundColor, lightIntensity, modelOpacity, showEdges]);

  useEffect(() => {
    const planes = clippingPlanesRef.current;
    const material = materialRef.current;
    if (!planes || !material || !modelInfo) return;
    const height = modelInfo.dimensions[2];
    const minimum = -height / 2;
    const lowerCutoff = minimum + height * (layerBottom / 100);
    const upperCutoff = minimum + height * (layerTop / 100);
    // Three.js keeps the positive side of each plane. Together these planes
    // expose only the selected Z interval, allowing inspection from either end.
    planes.lower.constant = -lowerCutoff;
    planes.upper.constant = upperCutoff;
    const clippingPlanes = layerMode ? [planes.lower, planes.upper] : [];
    if ((material.clippingPlanes?.length ?? 0) !== clippingPlanes.length) material.needsUpdate = true;
    material.clippingPlanes = clippingPlanes;
    if (edgeMaterialRef.current) {
      if ((edgeMaterialRef.current.clippingPlanes?.length ?? 0) !== clippingPlanes.length) {
        edgeMaterialRef.current.needsUpdate = true;
      }
      edgeMaterialRef.current.clippingPlanes = clippingPlanes;
    }
    renderRef.current?.();
  }, [layerMode, layerBottom, layerTop, modelInfo]);

  useEffect(() => {
    setAreas([]);
    setSelectedAreaId(null);
    setPlacementShape(null);
    setAreaPanelOpen(false);
  }, [url]);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.enabled = placementShape === null;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera || !modelInfo || !placementShape) return;
    const canvas = renderer.domElement;
    let pointerStart: [number, number] | null = null;
    const onPointerDown = (event: PointerEvent) => { pointerStart = [event.clientX, event.clientY]; };
    const onPointerUp = (event: PointerEvent) => {
      if (!pointerStart || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5) return;
      const rect = canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        (event.clientX - rect.left) / rect.width * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(raycastObjectsRef.current, false)[0];
      if (!hit) return;
      const center = hit.point.clone().add(modelCenterRef.current);
      const surfaceNormal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld).toArray() as [number, number, number] | undefined;
      const diameter = defaultAreaSizeRef.current;
      const id = `area-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setAreas((current) => [...current, { id, shape: placementShape, center: center.toArray() as [number, number, number], size: [diameter, diameter, diameter], surfaceNormal }]);
      setSelectedAreaId(id);
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [placementShape, modelInfo]);

  useEffect(() => {
    disposeThreeAreaMarkerGroup(areaMarkerGroupRef.current);
    areaMarkerGroupRef.current = null;
    const scene = sceneRef.current;
    if (!scene || areas.length === 0) { renderRef.current?.(); return; }
    const group = createThreeAreaMarkerGroup(areas, modelCenterRef.current, selectedAreaId);
    areaMarkerGroupRef.current = group;
    scene.add(group);
    renderRef.current?.();
  }, [areas, selectedAreaId, modelInfo]);

  const resetView = useCallback(() => resetViewRef.current?.(), []);
  const setStandardView = useCallback((view: ThreeViewDirection) => setViewRef.current?.(view), []);

  return (
    <div className={`stl-viewer${placementShape ? ' area-placement-active' : ''}`} ref={containerRef}>
      {loading && <div className="stl-viewer-status">{t('fileViewerModal.loading3d')}</div>}
      {error && <div className="stl-viewer-status stl-viewer-error">{error}</div>}
      {!loading && !error && (
        <div className="stl-viewer-toolbar">
          {modelInfo && (
            <span className="stl-viewer-info">
              {t('fileViewerModal.triangleCount', { count: modelInfo.triangles.toLocaleString() })} ·{' '}
              {modelInfo.dimensions.map(formatDimension).join(' × ')}
            </span>
          )}
          <ThreeViewShortcuts onView={setStandardView} />
          <button
            type="button"
            onClick={resetView}
            title={t('fileViewerModal.resetCamera')}
            aria-label={t('fileViewerModal.resetCamera')}
          >
            {t('fileViewerModal.resetView')}
          </button>
          <button
            type="button"
            className={layerMode ? 'active' : undefined}
            onClick={() => setLayerMode((enabled) => !enabled)}
            aria-pressed={layerMode}
          >
            {t('fileViewerModal.layers')}
          </button>
          <button
            type="button"
            className={areaPanelOpen ? 'active' : undefined}
            onClick={() => { setAreaPanelOpen((open) => !open); setPlacementShape(null); }}
            aria-expanded={areaPanelOpen}
          >
            {t('fileViewerModal.areas')}{areas.length > 0 ? ` (${areas.length})` : ''}
          </button>
          <button
            type="button"
            className={settingsOpen ? 'active' : undefined}
            onClick={() => setSettingsOpen((open) => !open)}
            aria-expanded={settingsOpen}
          >
            {t('fileViewerModal.viewerSettings')}
          </button>
        </div>
      )}
      {!loading && !error && settingsOpen && (
        <ThreeViewerSettings
          modelColor={modelColor}
          onModelColorChange={setModelColor}
          backgroundColor={backgroundColor}
          onBackgroundColorChange={setBackgroundColor}
          lightIntensity={lightIntensity}
          onLightIntensityChange={setLightIntensity}
          modelOpacity={modelOpacity}
          onModelOpacityChange={setModelOpacity}
          showEdges={showEdges}
          onShowEdgesChange={setShowEdges}
          recentFiles={recentFiles}
          currentFilePath={effectiveFilePath}
          onRecentFileSelect={onFileSelect}
        />
      )}
      {!loading && !error && areaPanelOpen && (
        <ThreeAreaSelector
          areas={areas}
          selectedId={selectedAreaId}
          placementShape={placementShape}
          filename={filename}
          filePath={effectiveFilePath}
          modelExtent={Math.max(...modelInfo!.dimensions)}
          className={layerMode ? 'with-layer-control' : undefined}
          onPlacementShapeChange={setPlacementShape}
          onSelectedIdChange={setSelectedAreaId}
          onAreasChange={setAreas}
          onClose={() => { setAreaPanelOpen(false); setPlacementShape(null); }}
        />
      )}
      {!loading && !error && layerMode && modelInfo && (
        <div className="stl-layer-control">
          <div className="stl-layer-values">
            <output>{Math.round(layerBottom)}%</output>
            <span>–</span>
            <output>{Math.round(layerTop)}%</output>
          </div>
          <span className="stl-layer-height">
            {formatDimension(modelInfo.dimensions[2] * (layerTop - layerBottom) / 100)} / {formatDimension(modelInfo.dimensions[2])}
          </span>
          <div
            className="stl-layer-slider"
            style={{
              '--layer-bottom': `${layerBottom}%`,
              '--layer-top-offset': `${100 - layerTop}%`,
            } as React.CSSProperties}
          >
            <span className="stl-layer-slider-track" aria-hidden="true" />
            <span className="stl-layer-slider-selection" aria-hidden="true" />
            <input
              className="stl-layer-range stl-layer-range-bottom"
              type="range"
              min="0"
              max="100"
              step="1"
              value={layerBottom}
              onChange={(event) => setLayerBottom(Math.min(Number(event.target.value), layerTop))}
              aria-label={t('fileViewerModal.layerBottom')}
              aria-orientation="vertical"
              title={t('fileViewerModal.layerBottom')}
            />
            <input
              className="stl-layer-range stl-layer-range-top"
              type="range"
              min="0"
              max="100"
              step="1"
              value={layerTop}
              onChange={(event) => setLayerTop(Math.max(Number(event.target.value), layerBottom))}
              aria-label={t('fileViewerModal.layerTop')}
              aria-orientation="vertical"
              title={t('fileViewerModal.layerTop')}
            />
          </div>
          <span>{t('fileViewerModal.layerAxis')}</span>
        </div>
      )}
      {!loading && !error && (
        <div className="stl-viewer-hint">{t('fileViewerModal.controlsHint')}</div>
      )}
      {!loading && !error && <ThreeAxisLegend />}
    </div>
  );
}
