import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { authFetch } from '../../utils/storage';
import type { GcodeLayerData, GcodePathKind, GcodeStats, GcodeWorkerOutput } from './gcodeTypes';
import { ThreeAxisLegend, ThreeViewShortcuts, type ThreeViewDirection } from './ThreeViewShortcuts';

interface GcodeViewerProps {
  url: string;
  filename: string;
}

const PATH_COLORS: Record<GcodePathKind, number> = {
  external: 0xff6b57,
  perimeter: 0xffa928,
  infill: 0x43a8ff,
  solid: 0xd96cff,
  support: 0x62d488,
  skirt: 0xaeb7c4,
  other: 0x47d6d0,
  travel: 0x637083,
};

function formatDuration(seconds?: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds!));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0 ? `${hours} h ${minutes} min ${remaining} s` : `${minutes} min ${remaining} s`;
}

function formatLength(mm: number): string {
  return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${mm.toFixed(1)} mm`;
}

/** Layer-aware toolpath preview and print statistics for slicer G-code. */
export function GcodeViewer({ url, filename }: GcodeViewerProps) {
  const { t } = useTranslation('terminal');
  const containerRef = useRef<HTMLDivElement>(null);
  const layerObjectsRef = useRef<Array<THREE.Group>>([]);
  const travelObjectsRef = useRef<Array<THREE.LineSegments>>([]);
  const renderRef = useRef<(() => void) | null>(null);
  const setViewRef = useRef<((view: ThreeViewDirection) => void) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<GcodeStats | null>(null);
  const [layerZs, setLayerZs] = useState<number[]>([]);
  const [layerBottom, setLayerBottom] = useState(0);
  const [layerTop, setLayerTop] = useState(0);
  const [showTravel, setShowTravel] = useState(false);
  const [statsOpen, setStatsOpen] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const abortController = new AbortController();
    const worker = new Worker(new URL('./gcode.worker.ts', import.meta.url), { type: 'module' });
    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let scene: THREE.Scene | null = null;
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.LineBasicMaterial[] = [];

    setLoading(true);
    setError(null);
    setStats(null);
    layerObjectsRef.current = [];
    travelObjectsRef.current = [];

    const fail = (message: string) => {
      if (disposed) return;
      setError(message);
      setLoading(false);
    };

    const createScene = (layers: GcodeLayerData[], parsedStats: GcodeStats) => {
      if (disposed || layers.length === 0) {
        if (!disposed) fail(t('fileViewerModal.emptyGcode'));
        return;
      }
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x10141b);
      const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100000);
      camera.up.set(0, 0, 1);
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
      } catch {
        fail(t('fileViewerModal.webglUnavailable'));
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.className = 'stl-viewer-canvas';
      renderer.domElement.setAttribute('aria-label', t('fileViewerModal.gcodePreviewLabel', { filename }));
      renderer.domElement.tabIndex = 0;
      container.appendChild(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.screenSpacePanning = true;
      controls.addEventListener('change', () => renderer?.render(scene!, camera));
      renderRef.current = () => renderer?.render(scene!, camera);

      const materialMap = new Map<GcodePathKind, THREE.LineBasicMaterial>();
      (Object.keys(PATH_COLORS) as GcodePathKind[]).forEach((kind) => {
        const material = new THREE.LineBasicMaterial({
          color: PATH_COLORS[kind],
          transparent: kind === 'travel',
          opacity: kind === 'travel' ? 0.3 : 0.94,
          depthWrite: kind !== 'travel',
        });
        materialMap.set(kind, material);
        materials.push(material);
      });

      for (const layerData of layers) {
        const layerGroup = new THREE.Group();
        for (const [kind, positions] of Object.entries(layerData.paths) as Array<[GcodePathKind, Float32Array]>) {
          if (!positions?.length) continue;
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          const lines = new THREE.LineSegments(geometry, materialMap.get(kind)!);
          lines.userData.pathKind = kind;
          if (kind === 'travel') travelObjectsRef.current.push(lines);
          layerGroup.add(lines);
          geometries.push(geometry);
        }
        scene.add(layerGroup);
        layerObjectsRef.current.push(layerGroup);
      }

      const min = new THREE.Vector3(...parsedStats.bounds.min);
      const max = new THREE.Vector3(...parsedStats.bounds.max);
      const center = min.clone().add(max).multiplyScalar(0.5);
      const size = max.clone().sub(min);
      const radius = Math.max(size.length() / 2, 1);
      const gridSize = Math.max(Math.ceil(Math.max(size.x, size.y) / 10) * 10, 10);
      const grid = new THREE.GridHelper(gridSize, 10, 0x4b5668, 0x27303d);
      grid.rotation.x = Math.PI / 2;
      grid.position.set(center.x, center.y, min.z - 0.01);
      scene.add(grid);
      const axes = new THREE.AxesHelper(Math.max(size.x, size.y, size.z, 1) * 0.22);
      axes.position.copy(min);
      scene.add(axes);

      const distance = Math.max(radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.18, 5);
      const setView = (view: ThreeViewDirection) => {
        const direction = view === 'x' ? new THREE.Vector3(1, 0, 0)
          : view === 'y' ? new THREE.Vector3(0, 1, 0)
            : view === 'z' ? new THREE.Vector3(0, 0, 1)
              : new THREE.Vector3(1, -1, 0.9).normalize();
        camera.up.set(0, view === 'z' ? 1 : 0, view === 'z' ? 0 : 1);
        camera.near = Math.max(distance / 5000, 0.001);
        camera.far = distance * 100;
        camera.position.copy(center).add(direction.multiplyScalar(distance));
        camera.updateProjectionMatrix();
        controls!.target.copy(center);
        controls!.minDistance = radius * 0.03;
        controls!.maxDistance = distance * 20;
        controls!.update();
        renderer!.render(scene!, camera);
      };
      setViewRef.current = setView;

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const key = event.key.toLowerCase();
        const view = key === 'x' || key === '1' ? 'x' : key === 'y' || key === '2' ? 'y'
          : key === 'z' || key === '3' ? 'z' : key === 'i' || key === '4' ? 'iso' : null;
        if (view) { event.preventDefault(); setView(view); }
      };
      renderer.domElement.addEventListener('pointerdown', () => renderer?.domElement.focus());
      renderer.domElement.addEventListener('keydown', onKeyDown);
      const resize = () => {
        if (!renderer) return;
        const width = Math.max(container.clientWidth, 1);
        const height = Math.max(container.clientHeight, 1);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        renderer.render(scene!, camera);
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
      resize();
      setView('iso');
      setStats(parsedStats);
      setLayerZs(layers.map((item) => item.z));
      setLayerBottom(0);
      setLayerTop(layers.length - 1);
      setLoading(false);
    };

    worker.onmessage = (event: MessageEvent<GcodeWorkerOutput>) => {
      if (event.data.type === 'error') fail(event.data.message);
      else createScene(event.data.layers, event.data.stats);
    };
    worker.onerror = () => fail(t('fileViewerModal.gcodeLoadError'));
    void authFetch(url, { signal: abortController.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load G-code (${response.status})`);
        return response.arrayBuffer();
      })
      .then((buffer) => { if (!disposed) worker.postMessage(buffer, [buffer]); })
      .catch((loadError) => {
        if (!abortController.signal.aborted) fail(loadError instanceof Error ? loadError.message : t('fileViewerModal.gcodeLoadError'));
      });

    return () => {
      disposed = true;
      abortController.abort();
      worker.terminate();
      resizeObserver?.disconnect();
      controls?.dispose();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderer?.dispose();
      renderer?.domElement.remove();
      layerObjectsRef.current = [];
      travelObjectsRef.current = [];
      renderRef.current = null;
      setViewRef.current = null;
    };
  }, [url, filename, t]);

  useEffect(() => {
    layerObjectsRef.current.forEach((object, index) => { object.visible = index >= layerBottom && index <= layerTop; });
    travelObjectsRef.current.forEach((object) => { object.visible = showTravel; });
    renderRef.current?.();
  }, [layerBottom, layerTop, showTravel, stats]);

  const setStandardView = useCallback((view: ThreeViewDirection) => setViewRef.current?.(view), []);
  const maxLayer = Math.max((stats?.layers ?? 1) - 1, 0);
  const currentLayer = Math.min(layerTop, maxLayer);

  return (
    <div className="stl-viewer gcode-viewer" ref={containerRef}>
      {loading && <div className="stl-viewer-status">{t('fileViewerModal.loadingGcode')}</div>}
      {error && <div className="stl-viewer-status stl-viewer-error">{error}</div>}
      {!loading && !error && stats && (
        <>
          <div className="stl-viewer-toolbar gcode-viewer-toolbar">
            <span className="stl-viewer-info">{t('fileViewerModal.gcodeLayerSummary', { current: currentLayer + 1, total: stats.layers, z: (layerZs[currentLayer] ?? 0).toFixed(2) })}</span>
            <ThreeViewShortcuts onView={setStandardView} />
            <button type="button" onClick={() => setStandardView('iso')}>{t('fileViewerModal.resetView')}</button>
            <button type="button" className={showTravel ? 'active' : undefined} onClick={() => setShowTravel((value) => !value)} aria-pressed={showTravel}>{t('fileViewerModal.showTravel')}</button>
            <button type="button" className={statsOpen ? 'active' : undefined} onClick={() => setStatsOpen((value) => !value)} aria-expanded={statsOpen}>{t('fileViewerModal.printStats')}</button>
          </div>
          <div className="gcode-layer-control">
            <span>{t('fileViewerModal.layerRange', { bottom: layerBottom + 1, top: layerTop + 1 })}</span>
            <div className="gcode-layer-slider" style={{ '--gcode-bottom': `${maxLayer ? layerBottom / maxLayer * 100 : 0}%`, '--gcode-top': `${maxLayer ? layerTop / maxLayer * 100 : 100}%` } as React.CSSProperties}>
              <span className="gcode-layer-track" aria-hidden="true" />
              <span className="gcode-layer-selection" aria-hidden="true" />
              <input type="range" min="0" max={maxLayer} value={layerBottom} onChange={(event) => setLayerBottom(Math.min(Number(event.target.value), layerTop))} aria-label={t('fileViewerModal.layerBottom')} />
              <input type="range" min="0" max={maxLayer} value={layerTop} onChange={(event) => setLayerTop(Math.max(Number(event.target.value), layerBottom))} aria-label={t('fileViewerModal.layerTop')} />
            </div>
          </div>
          {statsOpen && (
            <aside className="gcode-stats">
              <h3>{t('fileViewerModal.printStats')}</h3>
              <dl>
                <div><dt>{t('fileViewerModal.printTime')}</dt><dd>{formatDuration(stats.estimatedTimeSeconds)}</dd></div>
                {stats.firstLayerTimeSeconds !== undefined && <div><dt>{t('fileViewerModal.firstLayerTime')}</dt><dd>{formatDuration(stats.firstLayerTimeSeconds)}</dd></div>}
                <div><dt>{t('fileViewerModal.filament')}</dt><dd>{formatLength(stats.filamentMm)}{stats.filamentGrams !== undefined ? ` · ${stats.filamentGrams.toFixed(2)} g` : ''}</dd></div>
                {stats.filamentCm3 !== undefined && <div><dt>{t('fileViewerModal.filamentVolume')}</dt><dd>{stats.filamentCm3.toFixed(2)} cm³</dd></div>}
                {stats.material && <div><dt>{t('fileViewerModal.material')}</dt><dd>{stats.material}</dd></div>}
                <div><dt>{t('fileViewerModal.layerCount')}</dt><dd>{stats.layers.toLocaleString()}</dd></div>
                <div><dt>{t('fileViewerModal.printSize')}</dt><dd>{stats.bounds.max.map((value, index) => (value - stats.bounds.min[index]).toFixed(1)).join(' × ')} mm</dd></div>
                <div><dt>{t('fileViewerModal.toolpathDistance')}</dt><dd>{formatLength(stats.printDistanceMm)}</dd></div>
                {stats.nominalLayerHeight !== undefined && <div><dt>{t('fileViewerModal.layerHeight')}</dt><dd>{stats.nominalLayerHeight} mm</dd></div>}
                {stats.nozzleDiameter !== undefined && <div><dt>{t('fileViewerModal.nozzle')}</dt><dd>{stats.nozzleDiameter} mm</dd></div>}
                {stats.infill && <div><dt>{t('fileViewerModal.infill')}</dt><dd>{stats.infill}</dd></div>}
                {stats.filamentCost !== undefined && <div><dt>{t('fileViewerModal.cost')}</dt><dd>{stats.filamentCost.toFixed(2)}</dd></div>}
                {stats.printer && <div><dt>{t('fileViewerModal.printer')}</dt><dd title={stats.printer}>{stats.printer}</dd></div>}
                <div><dt>{t('fileViewerModal.slicer')}</dt><dd title={stats.slicer}>{stats.slicer}</dd></div>
              </dl>
              <div className="gcode-legend">
                {(Object.keys(PATH_COLORS) as GcodePathKind[]).filter((kind) => kind !== 'travel').map((kind) => <span key={kind}><i style={{ backgroundColor: `#${PATH_COLORS[kind].toString(16).padStart(6, '0')}` }} />{t(`fileViewerModal.gcodePath.${kind}`)}</span>)}
              </div>
            </aside>
          )}
          <div className="stl-viewer-hint">{t('fileViewerModal.controlsHint')}</div>
          <ThreeAxisLegend />
        </>
      )}
    </div>
  );
}
