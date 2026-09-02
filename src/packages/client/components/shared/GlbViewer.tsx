import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { apiUrl, authFetch, getAuthToken } from '../../utils/storage';
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

interface GlbViewerProps {
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

export interface GlbAnimationOption {
  index: number;
  label: string;
  duration: number;
}

export function buildGlbAnimationOptions(
  clips: ReadonlyArray<Pick<THREE.AnimationClip, 'name' | 'duration'>>,
): GlbAnimationOption[] {
  const nameCounts = new Map<string, number>();
  return clips.map((clip, index) => {
    const baseName = clip.name.trim() || `Animation ${index + 1}`;
    const count = (nameCounts.get(baseName) ?? 0) + 1;
    nameCounts.set(baseName, count);
    return {
      index,
      label: count === 1 ? baseName : `${baseName} (${count})`,
      duration: clip.duration,
    };
  });
}

type ColorMaterial = THREE.Material & { color: THREE.Color };

function hasColor(material: THREE.Material): material is ColorMaterial {
  return 'color' in material && (material as ColorMaterial).color instanceof THREE.Color;
}

function formatDimension(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

export function resolveGlbResourcePath(modelPath: string, resourceUrl: string): string {
  const normalizedModel = modelPath.replace(/\\/g, '/');
  const slash = normalizedModel.lastIndexOf('/');
  const modelDirectory = slash >= 0 ? normalizedModel.slice(0, slash + 1) : '';
  const cleanResourceUrl = resourceUrl.split(/[?#]/, 1)[0];
  let decodedResourceUrl = cleanResourceUrl;
  try { decodedResourceUrl = decodeURIComponent(cleanResourceUrl); } catch { /* Keep the authored path. */ }
  if (decodedResourceUrl.startsWith('/')) return decodedResourceUrl;
  const segments = `${modelDirectory}${decodedResourceUrl}`.split('/');
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') resolved.pop();
    else resolved.push(segment);
  }
  return `${normalizedModel.startsWith('/') ? '/' : ''}${resolved.join('/')}`;
}

/** Interactive viewer for self-contained binary glTF (.glb) models. */
export function GlbViewer({ url, filename, filePath, onFileSelect }: GlbViewerProps) {
  const { t } = useTranslation('terminal');
  const containerRef = useRef<HTMLDivElement>(null);
  const resetViewRef = useRef<(() => void) | null>(null);
  const setViewRef = useRef<((view: ThreeViewDirection) => void) | null>(null);
  const renderRef = useRef<(() => void) | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const raycastObjectsRef = useRef<THREE.Object3D[]>([]);
  const modelCenterRef = useRef(new THREE.Vector3());
  const defaultAreaSizeRef = useRef(1);
  const areaMarkerGroupRef = useRef<THREE.Group | null>(null);
  const modelMaterialsRef = useRef<THREE.Material[]>([]);
  const edgeObjectsRef = useRef<THREE.LineSegments[]>([]);
  const lightsRef = useRef<{ hemisphere: THREE.HemisphereLight; key: THREE.DirectionalLight; fill: THREE.DirectionalLight } | null>(null);
  const animationMixerRef = useRef<THREE.AnimationMixer | null>(null);
  const animationClipsRef = useRef<THREE.AnimationClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [animationOptions, setAnimationOptions] = useState<GlbAnimationOption[]>([]);
  const [selectedAnimation, setSelectedAnimation] = useState<number | null>(null);
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
  const recentFiles = useRecentThreeFiles(effectiveFilePath, filename, 'glb');

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
    let modelRoot: THREE.Group | null = null;
    let animationMixer: THREE.AnimationMixer | null = null;
    let animationFrame = 0;
    const animationClock = new THREE.Clock();
    let axesHelper: THREE.AxesHelper | null = null;
    const edgeGeometries: THREE.BufferGeometry[] = [];
    const edgeMaterials: THREE.Material[] = [];

    setLoading(true);
    setError(null);
    setModelInfo(null);
    setAnimationOptions([]);
    setSelectedAnimation(null);
    animationMixerRef.current = null;
    animationClipsRef.current = [];
    modelMaterialsRef.current = [];
    edgeObjectsRef.current = [];
    raycastObjectsRef.current = [];

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x11141a);
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100000);
    // glTF's native coordinate system is Y-up. Keep it unchanged so copied
    // annotations use the exact coordinates authored in the source model.
    camera.up.set(0, 1, 0);
    cameraRef.current = camera;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setLoading(false);
      setError(t('fileViewerModal.webglUnavailable'));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.className = 'stl-viewer-canvas';
    renderer.domElement.setAttribute('aria-label', t('fileViewerModal.glbPreviewLabel', { filename }));
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.screenSpacePanning = true;
    controls.addEventListener('change', () => renderer.render(scene, camera));
    controlsRef.current = controls;
    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x263044, 2.1);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
    keyLight.position.set(3, -4, 6);
    const fillLight = new THREE.DirectionalLight(0x7aaeff, 0.9);
    fillLight.position.set(-4, 3, 1);
    scene.add(hemisphereLight, keyLight, fillLight);
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

    const finishModel = (root: THREE.Group, clips: THREE.AnimationClip[]) => {
      if (disposed) return;
      modelRoot = root;
      const meshes: THREE.Mesh[] = [];
      const materialSet = new Set<THREE.Material>();
      let triangles = 0;
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        meshes.push(object);
        raycastObjectsRef.current.push(object);
        const geometry = object.geometry as THREE.BufferGeometry;
        triangles += geometry.index ? geometry.index.count / 3 : (geometry.getAttribute('position')?.count ?? 0) / 3;
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        objectMaterials.forEach((material) => {
          if (materialSet.has(material)) return;
          materialSet.add(material);
          material.userData.originalOpacity = material.opacity;
          material.userData.originalTransparent = material.transparent;
          material.userData.originalDepthWrite = material.depthWrite;
          if (hasColor(material)) material.userData.originalColor = material.color.clone();
        });
      });
      if (meshes.length === 0) {
        setError(t('fileViewerModal.emptyGlb'));
        setLoading(false);
        return;
      }
      modelMaterialsRef.current = [...materialSet];
      scene.add(root);
      animationClipsRef.current = clips;
      setAnimationOptions(buildGlbAnimationOptions(clips));
      if (clips.length > 0) {
        animationMixer = new THREE.AnimationMixer(root);
        animationMixerRef.current = animationMixer;
        setSelectedAnimation(0);
        const tick = () => {
          if (disposed) return;
          animationMixer?.update(Math.min(animationClock.getDelta(), 0.1));
          renderer.render(scene, camera);
          animationFrame = requestAnimationFrame(tick);
        };
        animationClock.start();
        animationFrame = requestAnimationFrame(tick);
      }
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      modelCenterRef.current.copy(center);
      defaultAreaSizeRef.current = Math.max(size.x, size.y, size.z, 0.001) * 0.12;
      root.position.sub(center);

      if (triangles <= 250_000) {
        for (const mesh of meshes) {
          const edgeGeometry = new THREE.EdgesGeometry(mesh.geometry, 28);
          const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x17222c, transparent: true, opacity: 0.5 });
          const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
          edges.visible = false;
          mesh.add(edges);
          edgeGeometries.push(edgeGeometry);
          edgeMaterials.push(edgeMaterial);
          edgeObjectsRef.current.push(edges);
        }
      }

      const axisLength = Math.max(size.x, size.y, size.z, 0.001) * 0.3;
      axesHelper = new THREE.AxesHelper(axisLength);
      axesHelper.position.set(-size.x / 2, -size.y / 2, -size.z / 2);
      scene.add(axesHelper);
      const radius = Math.max(size.length() / 2, 0.001);
      const distance = Math.max(radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.18, 0.01);
      const setView = (view: ThreeViewDirection) => {
        const direction = view === 'x' ? new THREE.Vector3(1, 0, 0)
          : view === 'y' ? new THREE.Vector3(0, 1, 0)
            : view === 'z' ? new THREE.Vector3(0, 0, 1)
              : new THREE.Vector3(1, 0.8, 1).normalize();
        camera.up.set(0, view === 'y' ? 0 : 1, view === 'y' ? -1 : 0);
        camera.near = Math.max(distance / 1000, 0.0001);
        camera.far = Math.max(distance * 100, 10);
        camera.position.copy(direction.multiplyScalar(distance));
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.minDistance = radius * 0.05;
        controls.maxDistance = distance * 20;
        controls.update();
        renderer.render(scene, camera);
      };
      setViewRef.current = setView;
      resetViewRef.current = () => setView('iso');
      setView('iso');
      renderer.domElement.tabIndex = 0;
      renderer.domElement.addEventListener('pointerdown', () => renderer.domElement.focus());
      renderer.domElement.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const key = event.key.toLowerCase();
        const view = key === 'x' || key === '1' ? 'x' : key === 'y' || key === '2' ? 'y'
          : key === 'z' || key === '3' ? 'z' : key === 'i' || key === '4' ? 'iso' : null;
        if (view) { event.preventDefault(); setView(view); }
      });
      setModelInfo({ objects: meshes.length, triangles: Math.floor(triangles), dimensions: [size.x, size.y, size.z] });
      setLoading(false);
    };

    void authFetch(url, { signal: abortController.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (disposed) return;
        const manager = new THREE.LoadingManager();
        const token = getAuthToken();
        const resourceEndpoint = url.includes('/git-original-binary') ? '/api/files/git-original-binary' : '/api/files/binary';
        manager.setURLModifier((resourceUrl) => {
          if (/^(?:blob:|data:|https?:)/i.test(resourceUrl)) return resourceUrl;
          const resourcePath = resolveGlbResourcePath(effectiveFilePath, resourceUrl);
          return apiUrl(`${resourceEndpoint}?path=${encodeURIComponent(resourcePath)}${token ? `&token=${encodeURIComponent(token)}` : ''}`);
        });
        new GLTFLoader(manager).parse(buffer, '', (gltf) => finishModel(gltf.scene, gltf.animations), () => {
          if (!disposed) { setError(t('fileViewerModal.glbLoadError')); setLoading(false); }
        });
      })
      .catch(() => {
        if (!disposed && !abortController.signal.aborted) { setError(t('fileViewerModal.glbLoadError')); setLoading(false); }
      });

    return () => {
      disposed = true;
      abortController.abort();
      cancelAnimationFrame(animationFrame);
      animationMixer?.stopAllAction();
      if (modelRoot && animationMixer) animationMixer.uncacheRoot(modelRoot);
      disposeThreeAreaMarkerGroup(areaMarkerGroupRef.current);
      areaMarkerGroupRef.current = null;
      resizeObserver.disconnect();
      controls.dispose();
      modelRoot?.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        objectMaterials.forEach((material) => {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
          material.dispose();
        });
      });
      edgeGeometries.forEach((geometry) => geometry.dispose());
      edgeMaterials.forEach((material) => material.dispose());
      axesHelper?.geometry.dispose();
      if (axesHelper) (Array.isArray(axesHelper.material) ? axesHelper.material : [axesHelper.material]).forEach((material) => material.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      renderRef.current = null;
      raycastObjectsRef.current = [];
      modelMaterialsRef.current = [];
      edgeObjectsRef.current = [];
      lightsRef.current = null;
      animationMixerRef.current = null;
      animationClipsRef.current = [];
      resetViewRef.current = null;
      setViewRef.current = null;
    };
  }, [url, filename, effectiveFilePath, t]);

  useEffect(() => {
    const mixer = animationMixerRef.current;
    if (!mixer) return;
    mixer.stopAllAction();
    if (selectedAnimation !== null) {
      const clip = animationClipsRef.current[selectedAnimation];
      if (clip) mixer.clipAction(clip).reset().play();
    }
    renderRef.current?.();
  }, [selectedAnimation]);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.background = new THREE.Color(backgroundColor);
    for (const material of modelMaterialsRef.current) {
      if (hasColor(material)) {
        const originalColor = material.userData.originalColor;
        if (preserveModelColors && originalColor instanceof THREE.Color) material.color.copy(originalColor);
        else material.color.set(modelColor);
      }
      const originalOpacity = typeof material.userData.originalOpacity === 'number' ? material.userData.originalOpacity : 1;
      material.opacity = originalOpacity * modelOpacity / 100;
      material.transparent = material.userData.originalTransparent === true || material.opacity < 1;
      material.depthWrite = material.userData.originalDepthWrite !== false && material.opacity >= 1;
      material.needsUpdate = true;
    }
    edgeObjectsRef.current.forEach((edges) => { edges.visible = showEdges; });
    const lights = lightsRef.current;
    if (lights) {
      const scale = lightIntensity / 100;
      lights.hemisphere.intensity = 2.1 * scale;
      lights.key.intensity = 2.3 * scale;
      lights.fill.intensity = 0.9 * scale;
    }
    renderRef.current?.();
  }, [modelColor, backgroundColor, lightIntensity, modelOpacity, showEdges, preserveModelColors, modelInfo]);

  useEffect(() => {
    setThreeViewerPreferences({ modelColor, backgroundColor, lightIntensity, modelOpacity, showEdges, preserveModelColors });
  }, [modelColor, backgroundColor, lightIntensity, modelOpacity, showEdges, preserveModelColors]);

  useEffect(() => {
    setAreas([]); setSelectedAreaId(null); setPlacementShape(null); setAreaPanelOpen(false);
  }, [url]);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.enabled = placementShape === null;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera || !modelInfo || !placementShape) return;
    const canvas = renderer.domElement;
    let start: [number, number] | null = null;
    const down = (event: PointerEvent) => { start = [event.clientX, event.clientY]; };
    const up = (event: PointerEvent) => {
      if (!start || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 5) return;
      const rect = canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(raycastObjectsRef.current, false)[0];
      if (!hit) return;
      const center = hit.point.clone().add(modelCenterRef.current).toArray() as [number, number, number];
      const surfaceNormal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld).toArray() as [number, number, number] | undefined;
      const diameter = defaultAreaSizeRef.current;
      const id = `area-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setAreas((current) => [...current, { id, shape: placementShape, center, size: [diameter, diameter, diameter], objectName: hit.object.name || undefined, surfaceNormal }]);
      setSelectedAreaId(id);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointerup', up);
    return () => { canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointerup', up); };
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
    <div className={`stl-viewer glb-viewer${placementShape ? ' area-placement-active' : ''}`} ref={containerRef}>
      {loading && <div className="stl-viewer-status">{t('fileViewerModal.loadingGlb')}</div>}
      {error && <div className="stl-viewer-status stl-viewer-error">{error}</div>}
      {!loading && !error && modelInfo && <>
        <div className="stl-viewer-toolbar">
          <span className="stl-viewer-info">{t('fileViewerModal.glbStats', { objects: modelInfo.objects.toLocaleString(), triangles: modelInfo.triangles.toLocaleString() })} · {modelInfo.dimensions.map(formatDimension).join(' × ')}</span>
          {animationOptions.length > 0 && (
            <label className="glb-animation-selector">
              <span>{t('fileViewerModal.animation')}</span>
              <select
                value={selectedAnimation ?? ''}
                onChange={(event) => setSelectedAnimation(event.target.value === '' ? null : Number(event.target.value))}
                aria-label={t('fileViewerModal.animation')}
              >
                <option value="">{t('fileViewerModal.staticPose')}</option>
                {animationOptions.map((animation) => (
                  <option key={animation.index} value={animation.index}>
                    {animation.label} · {animation.duration.toFixed(2)}s
                  </option>
                ))}
              </select>
            </label>
          )}
          <ThreeViewShortcuts onView={setStandardView} />
          <button type="button" onClick={resetView}>{t('fileViewerModal.resetView')}</button>
          <button type="button" className={areaPanelOpen ? 'active' : undefined} onClick={() => { setAreaPanelOpen((open) => !open); setPlacementShape(null); }}>{t('fileViewerModal.areas')}{areas.length ? ` (${areas.length})` : ''}</button>
          <button type="button" className={settingsOpen ? 'active' : undefined} onClick={() => setSettingsOpen((open) => !open)}>{t('fileViewerModal.viewerSettings')}</button>
        </div>
        {settingsOpen && <ThreeViewerSettings modelColor={modelColor} onModelColorChange={(color) => { setModelColor(color); setPreserveModelColors(false); }} backgroundColor={backgroundColor} onBackgroundColorChange={setBackgroundColor} lightIntensity={lightIntensity} onLightIntensityChange={setLightIntensity} modelOpacity={modelOpacity} onModelOpacityChange={setModelOpacity} showEdges={showEdges} onShowEdgesChange={setShowEdges} preserveModelColors={preserveModelColors} onPreserveModelColorsChange={setPreserveModelColors} recentFiles={recentFiles} currentFilePath={effectiveFilePath} onRecentFileSelect={onFileSelect} />}
        {areaPanelOpen && <ThreeAreaSelector areas={areas} selectedId={selectedAreaId} placementShape={placementShape} filename={filename} filePath={effectiveFilePath} modelExtent={Math.max(...modelInfo.dimensions)} onPlacementShapeChange={setPlacementShape} onSelectedIdChange={setSelectedAreaId} onAreasChange={setAreas} onClose={() => { setAreaPanelOpen(false); setPlacementShape(null); }} />}
        <div className="stl-viewer-hint">{t('fileViewerModal.controlsHint')}</div>
        <ThreeAxisLegend />
      </>}
    </div>
  );
}
