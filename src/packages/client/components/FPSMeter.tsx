/**
 * Performance Monitor Component
 *
 * A floating overlay that shows real-time FPS, memory, and Three.js metrics.
 * Helps identify memory leaks and performance issues.
 * Only visible in development mode.
 *
 * Usage:
 *   <FPSMeter visible={showFPS} />
 */

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { fpsTracker, memory, perf } from '../utils/profiling';
import { useAgentsArray } from '../store';

interface FPSMeterProps {
  visible?: boolean;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

interface ThreeJsStats {
  geometries: number;
  textures: number;
  programs: number;
}

interface DomStats {
  nodeCount: number;
  listenerCount: number;
  canvasCount: number;
  imageCount: number;
  videoCount: number;
}

interface TextureMemoryEstimate {
  count: number;
  estimatedMB: number;
}

interface MemoryHistory {
  timestamp: number;
  heapMB: number;
  geometries: number;
  textures: number;
}

// Only show in development
const isDev = import.meta.env.DEV;

export function FPSMeter({ visible = true, position = 'top-right' }: FPSMeterProps) {
  const [fps, setFps] = useState(0);
  const [fpsHistory, setFpsHistory] = useState<number[]>([]);
  const [memoryUsage, setMemoryUsage] = useState<{ usedMB: number; totalMB: number; limitMB: number } | null>(null);
  const [memoryHistory, setMemoryHistory] = useState<MemoryHistory[]>([]);
  const [threeJsStats, setThreeJsStats] = useState<ThreeJsStats | null>(null);
  const [growthRate, setGrowthRate] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'fps' | 'memory' | 'threejs' | 'dom'>('fps');
  const [domStats, setDomStats] = useState<DomStats | null>(null);
  const [textureMemory, setTextureMemory] = useState<TextureMemoryEstimate | null>(null);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  const [baselineMemory, setBaselineMemory] = useState<number | null>(null);

  // Track window resize for responsive positioning
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Get agents for RAM tracking
  const agents = useAgentsArray();

  // Calculate total agent RAM usage
  const agentMemoryStats = useMemo(() => {
    const agentsWithMemory = agents.filter(a => (a as any).memoryUsageMB !== undefined && (a as any).memoryUsageMB > 0);
    const totalMB = agentsWithMemory.reduce((sum, a) => sum + ((a as any).memoryUsageMB || 0), 0);
    return {
      totalMB,
      agentCount: agentsWithMemory.length,
      agents: agentsWithMemory.map(a => ({
        name: a.name,
        memoryMB: (a as any).memoryUsageMB || 0,
        status: a.status,
      })).sort((a, b) => b.memoryMB - a.memoryMB),
    };
  }, [agents]);

  // Use refs for values accessed in the interval to avoid recreating it
  const memoryHistoryRef = useRef<MemoryHistory[]>([]);
  const threeJsStatsRef = useRef<ThreeJsStats | null>(null);

  // Keep refs in sync with state
  useEffect(() => {
    memoryHistoryRef.current = memoryHistory;
  }, [memoryHistory]);

  useEffect(() => {
    threeJsStatsRef.current = threeJsStats;
  }, [threeJsStats]);

  useEffect(() => {
    if (!isDev || !visible) return;

    // Set baseline on mount
    const mem = memory.getUsage();
    if (mem && baselineMemory === null) {
      setBaselineMemory(mem.usedMB);
    }

    const intervalId = setInterval(() => {
      // FPS update
      fpsTracker.update();
      const stats = fpsTracker.getStats();
      setFps(stats.current);
      setFpsHistory(prev => {
        const next = [...prev, stats.current];
        return next.slice(-60);
      });

      // Memory update
      const memUsage = memory.getUsage();
      if (memUsage) {
        setMemoryUsage(memUsage);
      }

      // Three.js stats from scene manager
      const scene = (window as any).__tideScene;
      if (scene) {
        const diag = scene.getMemoryDiagnostics?.();
        if (diag?.threeJs) {
          setThreeJsStats(diag.threeJs);
        }
        // Estimate texture memory from Three.js renderer
        const renderer = scene.renderer;
        if (renderer?.info?.memory) {
          const texCount = renderer.info.memory.textures || 0;
          // Rough estimate: assume average texture is 512x512 RGBA = 1MB
          // This is very approximate since we don't have actual dimensions
          const estimatedMB = Math.round(texCount * 1);
          setTextureMemory({ count: texCount, estimatedMB });
        }
      }

      // DOM stats
      const allElements = document.getElementsByTagName('*');
      const canvases = document.getElementsByTagName('canvas');
      const images = document.getElementsByTagName('img');
      const videos = document.getElementsByTagName('video');

      // Count event listeners (rough estimate via getEventListeners if available in devtools)
      // In production, we can only estimate based on common patterns
      let listenerEstimate = 0;
      // Count elements with onclick, onmouse*, etc attributes
      for (let i = 0; i < Math.min(allElements.length, 500); i++) {
        const el = allElements[i];
        if ((el as any).onclick) listenerEstimate++;
        if ((el as any).onmousedown) listenerEstimate++;
        if ((el as any).onkeydown) listenerEstimate++;
      }
      // Add rough estimate for React synthetic events (React uses event delegation)
      listenerEstimate += 10; // Base React listeners on document

      setDomStats({
        nodeCount: allElements.length,
        listenerCount: listenerEstimate,
        canvasCount: canvases.length,
        imageCount: images.length,
        videoCount: videos.length,
      });

      // Memory history for graph (use ref for current threeJs stats)
      if (memUsage) {
        setMemoryHistory(prev => {
          const currentThreeJs = threeJsStatsRef.current;
          const entry: MemoryHistory = {
            timestamp: Date.now(),
            heapMB: memUsage.usedMB,
            geometries: currentThreeJs?.geometries ?? 0,
            textures: currentThreeJs?.textures ?? 0,
          };
          const next = [...prev, entry];
          return next.slice(-120); // Keep 2 minutes of history
        });
      }

      // Calculate growth rate (use ref for current history)
      const currentHistory = memoryHistoryRef.current;
      if (currentHistory.length >= 10) {
        const first = currentHistory[0];
        const last = currentHistory[currentHistory.length - 1];
        const durationMin = (last.timestamp - first.timestamp) / 1000 / 60;
        if (durationMin > 0.1) {
          setGrowthRate((last.heapMB - first.heapMB) / durationMin);
        }
      }
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [visible, baselineMemory]);

  if (!isDev || !visible) return null;

  const getFpsColor = (fps: number) => {
    if (fps >= 55) return '#4aff9e';
    if (fps >= 30) return '#ffcc00';
    return '#ff4a4a';
  };

  const getMemoryColor = (usedMB: number, totalMB: number) => {
    const ratio = usedMB / totalMB;
    if (ratio < 0.5) return '#4aff9e';
    if (ratio < 0.8) return '#ffcc00';
    return '#ff4a4a';
  };

  const getGrowthColor = (rate: number | null) => {
    if (rate === null) return '#888';
    if (rate < 1) return '#4aff9e';
    if (rate < 5) return '#ffcc00';
    return '#ff4a4a';
  };

  const fpsStats = fpsTracker.getStats();
  const isMobile = windowWidth <= 768;
  const mobileBottomOffset = isMobile ? 80 : 10;

  const positionStyles: Record<string, React.CSSProperties> = {
    'top-left': { top: 10, left: 10 },
    'top-right': { top: 10, right: 10 },
    'bottom-left': { bottom: mobileBottomOffset, left: 10 },
    'bottom-right': { bottom: mobileBottomOffset, right: 10 },
  };

  const memoryGrowth = baselineMemory && memoryUsage
    ? memoryUsage.usedMB - baselineMemory
    : 0;

  const tabStyle = (tab: string) => ({
    padding: '2px 8px',
    fontSize: '9px',
    border: 'none',
    background: activeTab === tab ? 'rgba(74, 158, 255, 0.4)' : 'rgba(255, 255, 255, 0.1)',
    color: activeTab === tab ? '#4a9eff' : '#888',
    borderRadius: '3px',
    cursor: 'pointer',
  });

  return (
    <div
      style={{
        position: 'fixed',
        ...positionStyles[position],
        zIndex: 99999,
        fontFamily: 'monospace',
        fontSize: '11px',
        background: 'rgba(0, 0, 0, 0.9)',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: '4px',
        padding: '6px 10px',
        color: '#fff',
        userSelect: 'none',
        minWidth: expanded ? '220px' : '120px',
        transition: 'all 0.2s ease',
      }}
    >
      {/* Compact header - always visible */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ color: getFpsColor(fps), fontWeight: 'bold', fontSize: '14px' }}>
          {fps}
        </span>
        <span style={{ color: '#666', fontSize: '10px' }}>FPS</span>

        {memoryUsage && (
          <>
            <span style={{ color: '#444' }}>|</span>
            <span style={{ color: getMemoryColor(memoryUsage.usedMB, memoryUsage.totalMB), fontWeight: 'bold' }}>
              {memoryUsage.usedMB}
            </span>
            <span style={{ color: '#666', fontSize: '10px' }}>MB</span>
          </>
        )}

        {growthRate !== null && Math.abs(growthRate) > 0.5 && (
          <span style={{
            color: getGrowthColor(growthRate),
            fontSize: '10px',
            marginLeft: '4px',
          }}>
            {growthRate > 0 ? '+' : ''}{growthRate.toFixed(1)}/m
          </span>
        )}

        <span style={{ color: '#444', marginLeft: 'auto', fontSize: '10px' }}>
          {expanded ? '▼' : '▶'}
        </span>
      </div>

      {/* Expanded view */}
      {expanded && (
        <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '8px' }}>
          {/* Tab buttons */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
            <button style={tabStyle('fps')} onClick={() => setActiveTab('fps')}>FPS</button>
            <button style={tabStyle('memory')} onClick={() => setActiveTab('memory')}>Memory</button>
            <button style={tabStyle('threejs')} onClick={() => setActiveTab('threejs')}>3D</button>
            <button style={tabStyle('dom')} onClick={() => setActiveTab('dom')}>DOM</button>
          </div>

          {/* FPS Tab */}
          {activeTab === 'fps' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px', fontSize: '10px', marginBottom: '8px' }}>
                <span style={{ color: '#888' }}>Current:</span>
                <span style={{ color: getFpsColor(fpsStats.current) }}>{fpsStats.current}</span>
                <span style={{ color: '#888' }}>Min:</span>
                <span style={{ color: getFpsColor(fpsStats.min) }}>{fpsStats.min}</span>
                <span style={{ color: '#888' }}>Max:</span>
                <span style={{ color: getFpsColor(fpsStats.max) }}>{fpsStats.max}</span>
                <span style={{ color: '#888' }}>Avg:</span>
                <span style={{ color: getFpsColor(fpsStats.avg) }}>{fpsStats.avg}</span>
              </div>

              {/* FPS Graph */}
              <div style={{ marginBottom: '8px' }}>
                <div style={{ color: '#666', fontSize: '9px', marginBottom: '2px' }}>60s History:</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', height: '30px', gap: '1px', background: 'rgba(0,0,0,0.3)', padding: '2px', borderRadius: '2px' }}>
                  {fpsHistory.slice(-60).map((f, i) => (
                    <div
                      key={i}
                      style={{
                        width: '3px',
                        height: `${Math.min(100, (f / 60) * 100)}%`,
                        background: getFpsColor(f),
                        opacity: 0.8,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Memory Tab */}
          {activeTab === 'memory' && memoryUsage && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px', fontSize: '10px', marginBottom: '8px' }}>
                <span style={{ color: '#888' }}>Used:</span>
                <span style={{ color: getMemoryColor(memoryUsage.usedMB, memoryUsage.totalMB) }}>
                  {memoryUsage.usedMB} MB
                </span>
                <span style={{ color: '#888' }}>Total:</span>
                <span>{memoryUsage.totalMB} MB</span>
                <span style={{ color: '#888' }}>Limit:</span>
                <span>{memoryUsage.limitMB} MB</span>
                <span style={{ color: '#888' }}>Baseline:</span>
                <span>{baselineMemory ?? '—'} MB</span>
                <span style={{ color: '#888' }}>Growth:</span>
                <span style={{ color: memoryGrowth > 50 ? '#ff4a4a' : memoryGrowth > 20 ? '#ffcc00' : '#4aff9e' }}>
                  {memoryGrowth > 0 ? '+' : ''}{memoryGrowth} MB
                </span>
                <span style={{ color: '#888' }}>Rate:</span>
                <span style={{ color: getGrowthColor(growthRate) }}>
                  {growthRate !== null ? `${growthRate.toFixed(2)} MB/min` : '—'}
                </span>
              </div>

              {/* Memory bar */}
              <div style={{ marginBottom: '8px' }}>
                <div style={{ height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${(memoryUsage.usedMB / memoryUsage.limitMB) * 100}%`,
                      background: getMemoryColor(memoryUsage.usedMB, memoryUsage.totalMB),
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>

              {/* Memory History Graph */}
              {memoryHistory.length > 1 && (
                <div>
                  <div style={{ color: '#666', fontSize: '9px', marginBottom: '2px' }}>Memory History:</div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', height: '40px', gap: '1px', background: 'rgba(0,0,0,0.3)', padding: '2px', borderRadius: '2px' }}>
                    {memoryHistory.slice(-60).map((entry, i) => {
                      const minMem = Math.min(...memoryHistory.map(e => e.heapMB));
                      const maxMem = Math.max(...memoryHistory.map(e => e.heapMB));
                      const range = maxMem - minMem || 1;
                      const height = ((entry.heapMB - minMem) / range) * 100;
                      return (
                        <div
                          key={i}
                          style={{
                            width: '3px',
                            height: `${Math.max(5, height)}%`,
                            background: entry.heapMB > (baselineMemory ?? 0) + 50 ? '#ff4a4a' : '#4a9eff',
                            opacity: 0.8,
                          }}
                          title={`${entry.heapMB}MB`}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Agent Memory */}
              {agentMemoryStats.agentCount > 0 && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ color: '#666', fontSize: '9px', marginBottom: '2px' }}>
                    Agent Memory ({agentMemoryStats.agentCount}):
                  </div>
                  <div style={{ fontSize: '10px' }}>
                    <div style={{ color: '#4aff9e', fontWeight: 'bold', marginBottom: '2px' }}>
                      Total: {agentMemoryStats.totalMB}MB
                    </div>
                    <div style={{ maxHeight: '50px', overflowY: 'auto' }}>
                      {agentMemoryStats.agents.slice(0, 4).map((agent, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1px' }}>
                          <span style={{ color: agent.status === 'working' ? '#4aff9e' : '#666', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {agent.name}
                          </span>
                          <span style={{ color: '#4a9eff' }}>{agent.memoryMB}MB</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Memory Breakdown */}
              <div style={{ marginTop: '8px', padding: '6px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px' }}>
                <div style={{ color: '#888', fontSize: '9px', marginBottom: '4px' }}>Memory Breakdown (estimated):</div>
                <div style={{ fontSize: '9px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span style={{ color: '#4a9eff' }}>JS Heap</span>
                    <span style={{ color: '#4a9eff' }}>{memoryUsage.usedMB} MB</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span style={{ color: '#ff9e4a' }}>GPU/Textures</span>
                    <span style={{ color: '#ff9e4a' }}>~{textureMemory?.estimatedMB ?? 0} MB</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span style={{ color: '#9e4aff' }}>DOM ({domStats?.nodeCount.toLocaleString() ?? 0} nodes)</span>
                    <span style={{ color: '#9e4aff' }}>~{Math.round(((domStats?.nodeCount ?? 0) * 0.5) / 1024)} MB</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '4px', marginTop: '4px' }}>
                    <span style={{ color: '#fff', fontWeight: 'bold' }}>Est. Total</span>
                    <span style={{ color: '#fff', fontWeight: 'bold' }}>
                      ~{memoryUsage.usedMB + (textureMemory?.estimatedMB ?? 0) + Math.round(((domStats?.nodeCount ?? 0) * 0.5) / 1024)} MB
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Three.js Tab */}
          {activeTab === 'threejs' && (
            <div>
              {threeJsStats ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px', fontSize: '10px', marginBottom: '8px' }}>
                    <span style={{ color: '#888' }}>Geometries:</span>
                    <span style={{ color: '#4aff9e' }}>{threeJsStats.geometries}</span>
                    <span style={{ color: '#888' }}>Textures:</span>
                    <span style={{ color: '#ff9e4a' }}>{threeJsStats.textures}</span>
                    <span style={{ color: '#888' }}>Programs:</span>
                    <span style={{ color: '#9e4aff' }}>{threeJsStats.programs}</span>
                  </div>

                  {/* Texture/Geometry history */}
                  {memoryHistory.length > 1 && (
                    <div>
                      <div style={{ color: '#666', fontSize: '9px', marginBottom: '2px' }}>Resource History:</div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', height: '40px', gap: '1px', background: 'rgba(0,0,0,0.3)', padding: '2px', borderRadius: '2px' }}>
                        {memoryHistory.slice(-60).map((entry, i) => {
                          const maxTex = Math.max(...memoryHistory.map(e => e.textures)) || 1;
                          return (
                            <div
                              key={i}
                              style={{
                                width: '3px',
                                height: `${(entry.textures / maxTex) * 100}%`,
                                background: '#ff9e4a',
                                opacity: 0.8,
                              }}
                              title={`${entry.textures} textures`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div style={{ color: '#666', fontSize: '9px', marginTop: '8px' }}>
                    Tip: Watch textures count. If it keeps increasing, there's a leak.
                  </div>
                </>
              ) : (
                <div style={{ color: '#666', fontSize: '10px' }}>
                  Three.js stats unavailable.
                  <br />
                  SceneManager not exposed.
                </div>
              )}
            </div>
          )}

          {/* DOM Tab */}
          {activeTab === 'dom' && (
            <div>
              {domStats ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px', fontSize: '10px', marginBottom: '8px' }}>
                    <span style={{ color: '#888' }}>DOM Nodes:</span>
                    <span style={{ color: domStats.nodeCount > 5000 ? '#ff4a4a' : domStats.nodeCount > 2000 ? '#ffcc00' : '#4aff9e' }}>
                      {domStats.nodeCount.toLocaleString()}
                    </span>
                    <span style={{ color: '#888' }}>Canvases:</span>
                    <span style={{ color: '#4a9eff' }}>{domStats.canvasCount}</span>
                    <span style={{ color: '#888' }}>Images:</span>
                    <span style={{ color: '#ff9e4a' }}>{domStats.imageCount}</span>
                    <span style={{ color: '#888' }}>Videos:</span>
                    <span style={{ color: '#9e4aff' }}>{domStats.videoCount}</span>
                  </div>

                  {textureMemory && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px', fontSize: '10px', marginBottom: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '6px' }}>
                      <span style={{ color: '#888' }}>GPU Textures:</span>
                      <span style={{ color: '#ff9e4a' }}>{textureMemory.count}</span>
                      <span style={{ color: '#888' }}>Est. VRAM:</span>
                      <span style={{ color: textureMemory.estimatedMB > 100 ? '#ff4a4a' : '#4aff9e' }}>
                        ~{textureMemory.estimatedMB} MB
                      </span>
                    </div>
                  )}

                  <div style={{ marginTop: '8px', padding: '6px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px' }}>
                    <div style={{ color: '#888', fontSize: '9px', marginBottom: '4px' }}>Memory Breakdown (estimated):</div>
                    <div style={{ fontSize: '9px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                        <span style={{ color: '#4a9eff' }}>JS Heap</span>
                        <span style={{ color: '#4a9eff' }}>{memoryUsage?.usedMB ?? 0} MB</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                        <span style={{ color: '#ff9e4a' }}>GPU/Textures</span>
                        <span style={{ color: '#ff9e4a' }}>~{textureMemory?.estimatedMB ?? 0} MB</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                        <span style={{ color: '#9e4aff' }}>DOM (~0.5KB/node)</span>
                        <span style={{ color: '#9e4aff' }}>~{Math.round((domStats.nodeCount * 0.5) / 1024)} MB</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '4px', marginTop: '4px' }}>
                        <span style={{ color: '#fff', fontWeight: 'bold' }}>Est. Total</span>
                        <span style={{ color: '#fff', fontWeight: 'bold' }}>
                          ~{(memoryUsage?.usedMB ?? 0) + (textureMemory?.estimatedMB ?? 0) + Math.round((domStats.nodeCount * 0.5) / 1024)} MB
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ color: '#666', fontSize: '9px', marginTop: '8px' }}>
                    Note: Task Manager shows more due to browser overhead, decoded images, and WebGL buffers.
                  </div>
                </>
              ) : (
                <div style={{ color: '#666', fontSize: '10px' }}>
                  Loading DOM stats...
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '4px', marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                // Build stats text
                const lines: string[] = [
                  '=== Tide Commander Performance Stats ===',
                  `Timestamp: ${new Date().toISOString()}`,
                  '',
                  '--- FPS ---',
                  `Current: ${fpsStats.current}`,
                  `Min: ${fpsStats.min}`,
                  `Max: ${fpsStats.max}`,
                  `Avg: ${fpsStats.avg}`,
                ];

                if (memoryUsage) {
                  lines.push(
                    '',
                    '--- Memory ---',
                    `Heap Used: ${memoryUsage.usedMB} MB`,
                    `Heap Total: ${memoryUsage.totalMB} MB`,
                    `Heap Limit: ${memoryUsage.limitMB} MB`,
                    `Baseline: ${baselineMemory ?? 'N/A'} MB`,
                    `Growth: ${memoryGrowth > 0 ? '+' : ''}${memoryGrowth} MB`,
                    `Growth Rate: ${growthRate !== null ? `${growthRate.toFixed(2)} MB/min` : 'N/A'}`,
                  );
                }

                if (threeJsStats) {
                  lines.push(
                    '',
                    '--- Three.js ---',
                    `Geometries: ${threeJsStats.geometries}`,
                    `Textures: ${threeJsStats.textures}`,
                    `Programs: ${threeJsStats.programs}`,
                  );
                }

                if (agentMemoryStats.agentCount > 0) {
                  lines.push(
                    '',
                    '--- Agent Memory ---',
                    `Total: ${agentMemoryStats.totalMB} MB`,
                    `Agents: ${agentMemoryStats.agentCount}`,
                  );
                  agentMemoryStats.agents.slice(0, 5).forEach(a => {
                    lines.push(`  ${a.name}: ${a.memoryMB} MB (${a.status})`);
                  });
                }

                if (domStats) {
                  lines.push(
                    '',
                    '--- DOM ---',
                    `DOM Nodes: ${domStats.nodeCount.toLocaleString()}`,
                    `Canvases: ${domStats.canvasCount}`,
                    `Images: ${domStats.imageCount}`,
                    `Videos: ${domStats.videoCount}`,
                  );
                }

                if (textureMemory) {
                  lines.push(
                    '',
                    '--- Estimated Memory ---',
                    `GPU Textures: ${textureMemory.count}`,
                    `Est. VRAM: ~${textureMemory.estimatedMB} MB`,
                    `Est. DOM: ~${Math.round((domStats?.nodeCount ?? 0) * 0.5 / 1024)} MB`,
                    `Est. Total: ~${(memoryUsage?.usedMB ?? 0) + textureMemory.estimatedMB + Math.round((domStats?.nodeCount ?? 0) * 0.5 / 1024)} MB`,
                  );
                }

                const statsText = lines.join('\n');
                navigator.clipboard.writeText(statsText).then(() => {
                  // Brief visual feedback
                  const btn = e.currentTarget;
                  const original = btn.textContent;
                  btn.textContent = 'Copied!';
                  setTimeout(() => { btn.textContent = original; }, 1000);
                });
              }}
              style={{
                flex: 1,
                background: 'rgba(74, 255, 158, 0.3)',
                border: '1px solid rgba(74, 255, 158, 0.5)',
                color: '#4aff9e',
                padding: '4px 6px',
                borderRadius: '3px',
                fontSize: '9px',
                cursor: 'pointer',
              }}
            >
              Copy Stats
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                perf.report();
                memory.report();
                const scene = (window as any).__tideScene;
                if (scene?.logMemoryDiagnostics) {
                  scene.logMemoryDiagnostics();
                }
              }}
              style={{
                flex: 1,
                background: 'rgba(74, 158, 255, 0.3)',
                border: '1px solid rgba(74, 158, 255, 0.5)',
                color: '#4a9eff',
                padding: '4px 6px',
                borderRadius: '3px',
                fontSize: '9px',
                cursor: 'pointer',
              }}
            >
              Console
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                perf.clear();
                fpsTracker.reset();
                memory.reset();
                setFpsHistory([]);
                setMemoryHistory([]);
                const mem = memory.getUsage();
                if (mem) setBaselineMemory(mem.usedMB);
              }}
              style={{
                flex: 1,
                background: 'rgba(255, 74, 74, 0.3)',
                border: '1px solid rgba(255, 74, 74, 0.5)',
                color: '#ff4a4a',
                padding: '4px 6px',
                borderRadius: '3px',
                fontSize: '9px',
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default FPSMeter;
