import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { authFetch } from '../../utils/storage';
import type { FcStdWorkerOutput } from './fcstdTypes';
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

interface FcStdViewerProps {
  url: string;
  filename: string;
  filePath?: string;
  onFileSelect?: (path: string) => void;
}

interface ModelInfo {
  objects: number;
  triangles: number;
  dimensions: [number, number, number];
}

function formatDimension(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

export function FcStdViewer({ url, filename, filePath, onFileSelect }: FcStdViewerProps) {
  const { t } = useTranslation('terminal');
  const containerRef = useRef<HTMLDivElement>(null);
  const resetViewRef = useRef<(() => void) | null>(null);
  const setViewRef = useRef<((view: ThreeViewDirection) => void) | null>(null);
  const renderRef = useRef<(() => void) | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const meshMaterialsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const edgeObjectsRef = useRef<THREE.LineSegments[]>([]);
  const lightsRef = useRef<{ hemisphere: THREE.HemisphereLight; key: THREE.DirectionalLight; fill: THREE.DirectionalLight } | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const raycastObjectsRef = useRef<THREE.Object3D[]>([]);
  const modelCenterRef = useRef(new THREE.Vector3());
  const defaultAreaSizeRef = useRef(1);
  const areaMarkerGroupRef = useRef<THREE.Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [initialPreferences] = useState(getThreeViewerPreferences);
  const [modelColor, setModelColor] = useState(initialPreferences.modelColor);
  const [backgroundColor, setBackgroundColor] = useState(initialPreferences.backgroundColor);
  const [lightIntensity, setLightIntensity] = useState(initialPreferences.lightIntensity);
  const [modelOpacity, setModelOpacity] = useState(initialPreferences.modelOpacity);
  const [showEdges, setShowEdges] = useState(initialPreferences.showEdges);
  const [preserveModelColors, setPreserveModelColors] = useState(initialPreferences.preserveModelColors);
  const [areaPanelOpen, setAreaPanelOpen] = useState(false);
  const [placementShape, setPlacementShape] = useState<ThreeAreaShape | null>(null);
  const [areas, setAreas] = useState<ThreeAreaMark[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const effectiveFilePath = filePath || viewerFilePathFromUrl(url);
  const recentFiles = useRecentThreeFiles(effectiveFilePath, filename, 'fcstd');

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
    const worker = new Worker(new URL('./fcstd.worker.ts', import.meta.url), { type: 'module' });
    let disposed = false;
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    let axesHelper: THREE.AxesHelper | null = null;

    setLoading(true);
    setProgress(null);
    setError(null);
    setModelInfo(null);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x11141a);
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100000);
    cameraRef.current = camera;
    camera.up.set(0, 0, 1);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      worker.terminate();
      setLoading(false);
      setError(t('fileViewerModal.webglUnavailable'));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    rendererRef.current = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'stl-viewer-canvas';
    renderer.domElement.setAttribute('aria-label', t('fileViewerModal.fcstdPreviewLabel', { filename }));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.addEventListener('change', () => renderer.render(scene, camera));
    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x263044, 2.2);
    scene.add(hemisphereLight);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(3, -4, 6);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x7aaeff, 1.1);
    fillLight.position.set(-4, 3, 1);
    scene.add(fillLight);
    lightsRef.current = { hemisphere: hemisphereLight, key: keyLight, fill: fillLight };
    renderRef.current = () => renderer.render(scene, camera);

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

    worker.onmessage = (event: MessageEvent<FcStdWorkerOutput>) => {
      if (disposed) return;
      const output = event.data;
      if (output.type === 'progress') {
        setProgress({ current: output.current, total: output.total });
        return;
      }
      if (output.type === 'error') {
        const errorKey = output.message === 'NO_BREP_GEOMETRY'
          ? 'fileViewerModal.noBrepGeometry'
          : output.message === 'BREP_IMPORT_FAILED'
            ? 'fileViewerModal.brepImportFailed'
            : 'fileViewerModal.fcstdRenderError';
        setError(t(errorKey));
        setLoading(false);
        return;
      }

      const modelRoot = new THREE.Group();
      const triangleTotal = output.meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0);
      // CAD edge extraction is useful on normal models but can monopolize the
      // main thread on very dense assemblies. The shaded geometry still renders
      // at any size; only the decorative outlines are capped.
      const canShowEdges = triangleTotal <= 250_000;
      let triangles = 0;
      for (const meshData of output.meshes) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
        if (meshData.normals) geometry.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
        else geometry.computeVertexNormals();
        geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
        geometries.push(geometry);

        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color().setRGB(
            meshData.color[0],
            meshData.color[1],
            meshData.color[2],
            THREE.SRGBColorSpace,
          ),
          metalness: 0.05,
          roughness: 0.68,
          side: THREE.DoubleSide,
          transparent: meshData.opacity < 1,
          opacity: meshData.opacity,
          depthWrite: meshData.opacity >= 1,
        });
        material.userData.originalColor = material.color.clone();
        material.userData.originalOpacity = meshData.opacity;
        materials.push(material);
        meshMaterialsRef.current.push(material);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = meshData.name;
        raycastObjectsRef.current.push(mesh);
        modelRoot.add(mesh);

        if (canShowEdges) {
          const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x18242b, transparent: true, opacity: 0.48 });
          const edgeGeometry = new THREE.EdgesGeometry(geometry, 28);
          geometries.push(edgeGeometry);
          materials.push(edgeMaterial);
          const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
          edgeObjectsRef.current.push(edges);
          modelRoot.add(edges);
        }
        triangles += meshData.indices.length / 3;
      }
      scene.add(modelRoot);

      const box = new THREE.Box3().setFromObject(modelRoot);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      modelCenterRef.current.copy(center);
      defaultAreaSizeRef.current = Math.max(size.x, size.y, size.z, 0.001) * 0.12;
      modelRoot.position.sub(center);
      const axisLength = Math.max(size.x, size.y, size.z, 0.001) * 0.3;
      axesHelper = new THREE.AxesHelper(axisLength);
      axesHelper.position.set(-size.x / 2, -size.y / 2, -size.z / 2);
      axesHelper.renderOrder = 5;
      scene.add(axesHelper);
      const radius = Math.max(size.length() / 2, 0.001);
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const distance = Math.max(radius / Math.sin(halfFov) * 1.18, 0.01);
      const setView = (view: ThreeViewDirection) => {
        camera.near = Math.max(distance / 1000, 0.0001);
        camera.far = Math.max(distance * 100, 10);
        const direction = view === 'x'
          ? new THREE.Vector3(1, 0, 0)
          : view === 'y'
            ? new THREE.Vector3(0, 1, 0)
            : view === 'z'
              ? new THREE.Vector3(0, 0, 1)
              : new THREE.Vector3(1, -1, 0.78).normalize();
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

      const handleShortcut = (keyboardEvent: KeyboardEvent) => {
        if (keyboardEvent.ctrlKey || keyboardEvent.metaKey || keyboardEvent.altKey) return;
        const key = keyboardEvent.key.toLowerCase();
        const view = key === 'x' || key === '1' ? 'x'
          : key === 'y' || key === '2' ? 'y'
            : key === 'z' || key === '3' ? 'z'
              : key === 'i' || key === '4' ? 'iso' : null;
        if (!view) return;
        keyboardEvent.preventDefault();
        setView(view);
      };
      renderer.domElement.tabIndex = 0;
      renderer.domElement.addEventListener('pointerdown', () => renderer.domElement.focus());
      renderer.domElement.addEventListener('keydown', handleShortcut);
      setModelInfo({
        objects: output.objectCount,
        triangles: Math.floor(triangles),
        dimensions: [size.x, size.y, size.z],
      });
      setLoading(false);
      setProgress(null);
    };

    worker.onerror = () => {
      if (disposed) return;
      setError(t('fileViewerModal.fcstdRenderError'));
      setLoading(false);
    };

    const load = async () => {
      try {
        const response = await authFetch(url, { signal: abortController.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (!disposed) worker.postMessage(buffer, [buffer]);
      } catch {
        if (disposed || abortController.signal.aborted) return;
        setError(t('fileViewerModal.fcstdLoadError'));
        setLoading(false);
      }
    };
    void load();

    return () => {
      disposed = true;
      abortController.abort();
      worker.terminate();
      resetViewRef.current = null;
      setViewRef.current = null;
      renderRef.current = null;
      sceneRef.current = null;
      meshMaterialsRef.current = [];
      edgeObjectsRef.current = [];
      lightsRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      raycastObjectsRef.current = [];
      disposeThreeAreaMarkerGroup(areaMarkerGroupRef.current);
      areaMarkerGroupRef.current = null;
      resizeObserver.disconnect();
      controls.dispose();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
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
    for (const material of meshMaterialsRef.current) {
      const originalColor = material.userData.originalColor;
      if (preserveModelColors && originalColor instanceof THREE.Color) material.color.copy(originalColor);
      else material.color.set(modelColor);
      const originalOpacity = typeof material.userData.originalOpacity === 'number' ? material.userData.originalOpacity : 1;
      material.opacity = originalOpacity * (modelOpacity / 100);
      material.transparent = material.opacity < 1;
      material.depthWrite = material.opacity >= 1;
      material.needsUpdate = true;
    }
    const lights = lightsRef.current;
    if (lights) {
      const scale = lightIntensity / 100;
      lights.hemisphere.intensity = 2.2 * scale;
      lights.key.intensity = 2.5 * scale;
      lights.fill.intensity = 1.1 * scale;
    }
    edgeObjectsRef.current.forEach((edges) => { edges.visible = showEdges; });
    renderRef.current?.();
  }, [modelColor, backgroundColor, lightIntensity, modelOpacity, showEdges, preserveModelColors, modelInfo]);

  useEffect(() => {
    setThreeViewerPreferences({ modelColor, backgroundColor, lightIntensity, modelOpacity, showEdges, preserveModelColors });
  }, [modelColor, backgroundColor, lightIntensity, modelOpacity, showEdges, preserveModelColors]);

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
      setAreas((current) => [...current, { id, shape: placementShape, center: center.toArray() as [number, number, number], size: [diameter, diameter, diameter], objectName: hit.object.name || undefined, surfaceNormal }]);
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
  const loadingMessage = progress
    ? t('fileViewerModal.processingFcstd', progress)
    : t('fileViewerModal.loadingFcstd');

  return (
    <div className={`stl-viewer fcstd-viewer${placementShape ? ' area-placement-active' : ''}`} ref={containerRef}>
      {loading && <div className="stl-viewer-status">{loadingMessage}</div>}
      {error && <div className="stl-viewer-status stl-viewer-error">{error}</div>}
      {!loading && !error && (
        <div className="stl-viewer-toolbar">
          {modelInfo && (
            <span className="stl-viewer-info">
              {t('fileViewerModal.fcstdStats', {
                objects: modelInfo.objects.toLocaleString(),
                triangles: modelInfo.triangles.toLocaleString(),
              })} · {modelInfo.dimensions.map(formatDimension).join(' × ')}
            </span>
          )}
          <ThreeViewShortcuts onView={setStandardView} />
          <button type="button" onClick={resetView} title={t('fileViewerModal.resetCamera')}>
            {t('fileViewerModal.resetView')}
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
          onModelColorChange={(color) => {
            setModelColor(color);
            setPreserveModelColors(false);
          }}
          backgroundColor={backgroundColor}
          onBackgroundColorChange={setBackgroundColor}
          lightIntensity={lightIntensity}
          onLightIntensityChange={setLightIntensity}
          modelOpacity={modelOpacity}
          onModelOpacityChange={setModelOpacity}
          showEdges={showEdges}
          onShowEdgesChange={setShowEdges}
          preserveModelColors={preserveModelColors}
          onPreserveModelColorsChange={setPreserveModelColors}
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
          onPlacementShapeChange={setPlacementShape}
          onSelectedIdChange={setSelectedAreaId}
          onAreasChange={setAreas}
          onClose={() => { setAreaPanelOpen(false); setPlacementShape(null); }}
        />
      )}
      {!loading && !error && <div className="stl-viewer-hint">{t('fileViewerModal.controlsHint')}</div>}
      {!loading && !error && <ThreeAxisLegend />}
    </div>
  );
}
