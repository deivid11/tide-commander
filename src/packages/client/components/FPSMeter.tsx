/**
 * FPSMeter Component
 *
 * A floating overlay that shows real-time FPS and performance metrics.
 * Only visible in development mode.
 *
 * Usage:
 *   <FPSMeter visible={showFPS} />
 */

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { fpsTracker, memory, perf } from '../utils/profiling';
import { useAgentsArray } from '../store';

interface FPSMeterProps {
  visible?: boolean;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

// Only show in development
const isDev = import.meta.env.DEV;

export function FPSMeter({ visible = true, position = 'top-right' }: FPSMeterProps) {
  const [fps, setFps] = useState(0);
  const [fpsHistory, setFpsHistory] = useState<number[]>([]);
  const [memoryUsage, setMemoryUsage] = useState<{ usedMB: number; totalMB: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  const rafRef = useRef<number>(0);
  const lastUpdateRef = useRef(0);

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
      })).sort((a, b) => b.memoryMB - a.memoryMB), // Sort by memory usage desc
    };
  }, [agents]);

  useEffect(() => {
    if (!isDev || !visible) return;

    // Update display every second using setInterval (don't call tick - SceneManager does that)
    const intervalId = setInterval(() => {
      fpsTracker.update();
      const stats = fpsTracker.getStats();
      setFps(stats.current);
      setFpsHistory(prev => {
        const next = [...prev, stats.current];
        return next.slice(-60); // Keep last 60 seconds
      });

      // Update memory if available
      const mem = memory.getUsage();
      if (mem) {
        setMemoryUsage({ usedMB: mem.usedMB, totalMB: mem.totalMB });
      }
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [visible]);

  if (!isDev || !visible) return null;

  const getFpsColor = (fps: number) => {
    if (fps >= 55) return '#4aff9e'; // Green - good
    if (fps >= 30) return '#ffcc00'; // Yellow - acceptable
    return '#ff4a4a'; // Red - bad
  };

  const stats = fpsTracker.getStats();

  // On mobile (< 768px), move bottom positions above the agent bar (which is ~70px tall)
  const isMobile = windowWidth <= 768;
  const mobileBottomOffset = isMobile ? 80 : 10;

  const positionStyles: Record<string, React.CSSProperties> = {
    'top-left': { top: 10, left: 10 },
    'top-right': { top: 10, right: 10 },
    'bottom-left': { bottom: mobileBottomOffset, left: 10 },
    'bottom-right': { bottom: mobileBottomOffset, right: 10 },
  };

  return (
    <div
      style={{
        position: 'fixed',
        ...positionStyles[position],
        zIndex: 99999,
        fontFamily: 'monospace',
        fontSize: '11px',
        background: 'rgba(0, 0, 0, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: '4px',
        padding: '6px 10px',
        color: '#fff',
        cursor: 'pointer',
        userSelect: 'none',
        minWidth: expanded ? '180px' : '70px',
        transition: 'all 0.2s ease',
      }}
      onClick={() => setExpanded(!expanded)}
      title="Click to expand/collapse"
    >
      {/* Main FPS display */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ color: getFpsColor(fps), fontWeight: 'bold', fontSize: '14px' }}>
          {fps}
        </span>
        <span style={{ color: '#888' }}>FPS</span>
        {agentMemoryStats.totalMB > 0 && (
          <span style={{ color: '#4aff9e', marginLeft: '6px', fontWeight: 'bold' }}>
            {agentMemoryStats.totalMB}MB
          </span>
        )}
      </div>

      {/* Expanded view */}
      {expanded && (
        <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '8px' }}>
          {/* FPS Stats */}
          <div style={{ marginBottom: '6px' }}>
            <div style={{ color: '#888', marginBottom: '2px' }}>FPS Stats:</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px', fontSize: '10px' }}>
              <span>Min:</span>
              <span style={{ color: getFpsColor(stats.min) }}>{stats.min}</span>
              <span>Max:</span>
              <span style={{ color: getFpsColor(stats.max) }}>{stats.max}</span>
              <span>Avg:</span>
              <span style={{ color: getFpsColor(stats.avg) }}>{stats.avg}</span>
            </div>
          </div>

          {/* FPS Graph (simple ASCII-style) */}
          <div style={{ marginBottom: '6px' }}>
            <div style={{ color: '#888', marginBottom: '2px' }}>History:</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', height: '20px', gap: '1px' }}>
              {fpsHistory.slice(-30).map((f, i) => (
                <div
                  key={i}
                  style={{
                    width: '3px',
                    height: `${Math.min(100, (f / 60) * 100)}%`,
                    background: getFpsColor(f),
                    opacity: 0.7,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Agent RAM */}
          {agentMemoryStats.agentCount > 0 && (
            <div style={{ marginBottom: '6px' }}>
              <div style={{ color: '#888', marginBottom: '2px' }}>
                Agent RAM ({agentMemoryStats.agentCount} active):
              </div>
              <div style={{ fontSize: '10px' }}>
                <div style={{ color: '#4aff9e', fontWeight: 'bold', marginBottom: '4px' }}>
                  Total: {agentMemoryStats.totalMB}MB
                </div>
                <div style={{ maxHeight: '60px', overflowY: 'auto' }}>
                  {agentMemoryStats.agents.slice(0, 5).map((agent, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '8px',
                        marginBottom: '2px',
                      }}
                    >
                      <span style={{
                        color: agent.status === 'working' ? '#4aff9e' : '#888',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '100px',
                      }}>
                        {agent.name}
                      </span>
                      <span style={{ color: '#4a9eff' }}>{agent.memoryMB}MB</span>
                    </div>
                  ))}
                  {agentMemoryStats.agents.length > 5 && (
                    <div style={{ color: '#666', fontSize: '9px' }}>
                      +{agentMemoryStats.agents.length - 5} more...
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Browser Memory */}
          {memoryUsage && (
            <div style={{ marginBottom: '6px' }}>
              <div style={{ color: '#888', marginBottom: '2px' }}>Browser Heap:</div>
              <div style={{ fontSize: '10px' }}>
                {memoryUsage.usedMB}MB / {memoryUsage.totalMB}MB
                <div
                  style={{
                    height: '4px',
                    background: 'rgba(255,255,255,0.1)',
                    borderRadius: '2px',
                    marginTop: '2px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${(memoryUsage.usedMB / memoryUsage.totalMB) * 100}%`,
                      background: memoryUsage.usedMB / memoryUsage.totalMB > 0.8 ? '#ff4a4a' : '#4a9eff',
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                perf.report();
              }}
              style={{
                background: 'rgba(74, 158, 255, 0.3)',
                border: '1px solid rgba(74, 158, 255, 0.5)',
                color: '#4a9eff',
                padding: '2px 6px',
                borderRadius: '3px',
                fontSize: '10px',
                cursor: 'pointer',
              }}
            >
              Report
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                perf.clear();
                fpsTracker.reset();
                setFpsHistory([]);
              }}
              style={{
                background: 'rgba(255, 74, 74, 0.3)',
                border: '1px solid rgba(255, 74, 74, 0.5)',
                color: '#ff4a4a',
                padding: '2px 6px',
                borderRadius: '3px',
                fontSize: '10px',
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
