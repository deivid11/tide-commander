/**
 * Performance Profiling Utilities
 *
 * Tools for measuring and monitoring performance in development.
 *
 * Usage:
 *   import { perf, FPSMeter } from './utils/profiling';
 *
 *   // Timing operations
 *   perf.start('myOperation');
 *   // ... do work ...
 *   perf.end('myOperation');
 *
 *   // Get metrics
 *   console.log(perf.getMetrics());
 */

// Only enable profiling in development
const isDev = import.meta.env.DEV;

// Store for timing data
interface TimingEntry {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
  samples: number[]; // Last N samples for calculating percentiles
}

const MAX_SAMPLES = 100;
const timings = new Map<string, TimingEntry>();
const activeTimers = new Map<string, number>();

/**
 * Performance measurement utilities.
 */
export const perf = {
  /**
   * Start timing an operation.
   */
  start(label: string): void {
    if (!isDev) return;
    activeTimers.set(label, performance.now());
  },

  /**
   * End timing an operation and record the result.
   */
  end(label: string): number | undefined {
    if (!isDev) return;

    const startTime = activeTimers.get(label);
    if (startTime === undefined) {
      console.warn(`[Perf] No active timer for: ${label}`);
      return;
    }

    const elapsed = performance.now() - startTime;
    activeTimers.delete(label);

    // Update or create entry
    let entry = timings.get(label);
    if (!entry) {
      entry = {
        count: 0,
        totalMs: 0,
        minMs: Infinity,
        maxMs: -Infinity,
        lastMs: 0,
        samples: [],
      };
      timings.set(label, entry);
    }

    entry.count++;
    entry.totalMs += elapsed;
    entry.minMs = Math.min(entry.minMs, elapsed);
    entry.maxMs = Math.max(entry.maxMs, elapsed);
    entry.lastMs = elapsed;
    entry.samples.push(elapsed);

    // Keep only last N samples
    if (entry.samples.length > MAX_SAMPLES) {
      entry.samples.shift();
    }

    // Log slow operations - skip scene:render and scene:frame as they're expected to vary
    // Only warn for non-render operations that exceed 50ms
    if (elapsed > 50 && !label.startsWith('scene:')) {
      console.warn(`[Perf] Slow operation: ${label} took ${elapsed.toFixed(2)}ms`);
    }

    return elapsed;
  },

  /**
   * Measure an async operation.
   */
  async measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
    this.start(label);
    try {
      return await fn();
    } finally {
      this.end(label);
    }
  },

  /**
   * Measure a sync operation.
   */
  measureSync<T>(label: string, fn: () => T): T {
    this.start(label);
    try {
      return fn();
    } finally {
      this.end(label);
    }
  },

  /**
   * Get metrics for a specific label or all labels.
   */
  getMetrics(label?: string): Record<string, {
    count: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
    lastMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
  }> {
    const result: Record<string, any> = {};

    const entries: Array<[string, TimingEntry]> = label
      ? (timings.has(label) ? [[label, timings.get(label)!]] : [])
      : Array.from(timings.entries());

    for (const [key, entry] of entries) {
      const sorted = [...entry.samples].sort((a, b) => a - b);
      const p50Idx = Math.floor(sorted.length * 0.5);
      const p95Idx = Math.floor(sorted.length * 0.95);
      const p99Idx = Math.floor(sorted.length * 0.99);

      result[key] = {
        count: entry.count,
        avgMs: entry.totalMs / entry.count,
        minMs: entry.minMs,
        maxMs: entry.maxMs,
        lastMs: entry.lastMs,
        p50Ms: sorted[p50Idx] || 0,
        p95Ms: sorted[p95Idx] || 0,
        p99Ms: sorted[p99Idx] || 0,
      };
    }

    return result;
  },

  /**
   * Clear all timing data.
   */
  clear(): void {
    timings.clear();
    activeTimers.clear();
  },

  /**
   * Print a formatted report to console.
   */
  report(): void {
    if (!isDev) return;

    const metrics = this.getMetrics();
    const entries = Object.entries(metrics).sort((a, b) => b[1].avgMs - a[1].avgMs);

    console.group('%c[Performance Report]', 'color: #4a9eff; font-weight: bold');
    console.table(entries.map(([label, m]) => ({
      Operation: label,
      Count: m.count,
      'Avg (ms)': m.avgMs.toFixed(2),
      'Min (ms)': m.minMs.toFixed(2),
      'Max (ms)': m.maxMs.toFixed(2),
      'P50 (ms)': m.p50Ms.toFixed(2),
      'P95 (ms)': m.p95Ms.toFixed(2),
    })));
    console.groupEnd();
  },
};

/**
 * FPS tracking for canvas rendering.
 */
class FPSTracker {
  private frames: number[] = [];
  private lastFrameTime = 0;
  private frameCount = 0;
  private fps = 0;
  private minFps = Infinity;
  private maxFps = 0;
  private fpsHistory: number[] = [];
  private readonly maxHistorySize = 60; // 1 minute at 1 sample/sec

  /**
   * Call this at the start of each frame.
   * @param maxExpectedDelta - If delta exceeds this (ms), skip recording (frame was throttled)
   */
  tick(maxExpectedDelta = 200): void {
    const now = performance.now();

    if (this.lastFrameTime > 0) {
      const delta = now - this.lastFrameTime;
      // Only record if delta is reasonable (not a throttled/skipped frame gap)
      if (delta < maxExpectedDelta) {
        this.frames.push(delta);

        // Keep last 60 frames for rolling average
        if (this.frames.length > 60) {
          this.frames.shift();
        }
      }
    }

    this.lastFrameTime = now;
    this.frameCount++;
  }

  /**
   * Call this once per second to update FPS.
   */
  update(): void {
    if (this.frames.length === 0) return;

    const avgFrameTime = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
    this.fps = 1000 / avgFrameTime;

    this.minFps = Math.min(this.minFps, this.fps);
    this.maxFps = Math.max(this.maxFps, this.fps);

    this.fpsHistory.push(this.fps);
    if (this.fpsHistory.length > this.maxHistorySize) {
      this.fpsHistory.shift();
    }
  }

  /**
   * Get current FPS.
   */
  getFPS(): number {
    return Math.round(this.fps);
  }

  /**
   * Get FPS statistics.
   */
  getStats(): { current: number; min: number; max: number; avg: number } {
    const avg = this.fpsHistory.length > 0
      ? this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length
      : this.fps;

    return {
      current: Math.round(this.fps),
      min: Math.round(this.minFps === Infinity ? 0 : this.minFps),
      max: Math.round(this.maxFps),
      avg: Math.round(avg),
    };
  }

  /**
   * Reset statistics.
   */
  reset(): void {
    this.frames = [];
    this.lastFrameTime = 0;
    this.frameCount = 0;
    this.fps = 0;
    this.minFps = Infinity;
    this.maxFps = 0;
    this.fpsHistory = [];
  }
}

// Singleton FPS tracker
export const fpsTracker = new FPSTracker();

/**
 * Memory usage tracking with Three.js resource monitoring.
 */
interface MemorySnapshot {
  timestamp: number;
  heapUsedMB: number;
  heapTotalMB: number;
  heapLimitMB: number;
}

class MemoryMonitor {
  private snapshots: MemorySnapshot[] = [];
  private readonly maxSnapshots = 120; // 2 minutes at 1/sec
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private leakThresholdMB = 50; // Warn if memory grows by this much
  private baselineUsedMB = 0;

  /**
   * Get current memory usage in MB.
   */
  getUsage(): { usedMB: number; totalMB: number; limitMB: number } | null {
    // @ts-ignore - performance.memory is Chrome-specific
    const mem = performance.memory;
    if (!mem) return null;

    return {
      usedMB: Math.round(mem.usedJSHeapSize / 1024 / 1024),
      totalMB: Math.round(mem.totalJSHeapSize / 1024 / 1024),
      limitMB: Math.round(mem.jsHeapSizeLimit / 1024 / 1024),
    };
  }

  /**
   * Log memory usage.
   */
  log(): void {
    const usage = this.getUsage();
    if (usage) {
      console.log(`[Memory] Used: ${usage.usedMB}MB / ${usage.totalMB}MB (limit: ${usage.limitMB}MB)`);
    }
  }

  /**
   * Start continuous memory monitoring.
   */
  startMonitoring(intervalMs = 1000): void {
    if (this.intervalId) return;

    const usage = this.getUsage();
    if (usage) {
      this.baselineUsedMB = usage.usedMB;
    }

    this.intervalId = setInterval(() => {
      this.takeSnapshot();
    }, intervalMs);

    console.log('[Memory] Monitoring started. Use memory.report() to see analysis.');
  }

  /**
   * Stop continuous monitoring.
   */
  stopMonitoring(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[Memory] Monitoring stopped.');
    }
  }

  /**
   * Take a memory snapshot.
   */
  private takeSnapshot(): void {
    const usage = this.getUsage();
    if (!usage) return;

    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsedMB: usage.usedMB,
      heapTotalMB: usage.totalMB,
      heapLimitMB: usage.limitMB,
    };

    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    // Check for potential leak
    const growth = usage.usedMB - this.baselineUsedMB;
    if (growth > this.leakThresholdMB) {
      console.warn(`[Memory] Warning: Heap grew by ${growth}MB since monitoring started (baseline: ${this.baselineUsedMB}MB, current: ${usage.usedMB}MB)`);
    }
  }

  /**
   * Get memory growth rate (MB/minute).
   */
  getGrowthRate(): number | null {
    if (this.snapshots.length < 10) return null;

    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];
    const durationMin = (last.timestamp - first.timestamp) / 1000 / 60;

    if (durationMin < 0.1) return null;

    return (last.heapUsedMB - first.heapUsedMB) / durationMin;
  }

  /**
   * Generate a memory analysis report.
   */
  report(): void {
    const usage = this.getUsage();
    if (!usage) {
      console.log('[Memory] Memory API not available (Chrome only)');
      return;
    }

    console.group('%c[Memory Report]', 'color: #ff6600; font-weight: bold');

    console.log(`Current: ${usage.usedMB}MB / ${usage.totalMB}MB (limit: ${usage.limitMB}MB)`);
    console.log(`Baseline: ${this.baselineUsedMB}MB`);
    console.log(`Growth: ${usage.usedMB - this.baselineUsedMB}MB since monitoring started`);

    const growthRate = this.getGrowthRate();
    if (growthRate !== null) {
      console.log(`Growth Rate: ${growthRate.toFixed(2)}MB/min`);
      if (growthRate > 5) {
        console.warn('POTENTIAL MEMORY LEAK: Growth rate exceeds 5MB/min');
      }
    }

    if (this.snapshots.length > 1) {
      const min = Math.min(...this.snapshots.map(s => s.heapUsedMB));
      const max = Math.max(...this.snapshots.map(s => s.heapUsedMB));
      console.log(`Range: ${min}MB - ${max}MB (${max - min}MB variance)`);
    }

    console.groupEnd();
  }

  /**
   * Get Three.js renderer info if available.
   */
  getThreeJsInfo(renderer: any): { geometries: number; textures: number } | null {
    if (!renderer?.info?.memory) return null;
    return {
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    };
  }

  /**
   * Reset baseline and clear snapshots.
   */
  reset(): void {
    this.snapshots = [];
    const usage = this.getUsage();
    if (usage) {
      this.baselineUsedMB = usage.usedMB;
    }
    console.log('[Memory] Reset. New baseline:', this.baselineUsedMB, 'MB');
  }
}

export const memory = new MemoryMonitor();

/**
 * React Profiler callback for measuring render times.
 * Use with <React.Profiler id="ComponentName" onRender={profileRender}>
 */
export function profileRender(
  id: string,
  phase: 'mount' | 'update' | 'nested-update',
  actualDuration: number,
  baseDuration: number,
  _startTime: number,
  _commitTime: number
): void {
  if (!isDev) return;

  const label = `React:${id}:${phase}`;

  // Record in our timing system
  let entry = timings.get(label);
  if (!entry) {
    entry = {
      count: 0,
      totalMs: 0,
      minMs: Infinity,
      maxMs: -Infinity,
      lastMs: 0,
      samples: [],
    };
    timings.set(label, entry);
  }

  entry.count++;
  entry.totalMs += actualDuration;
  entry.minMs = Math.min(entry.minMs, actualDuration);
  entry.maxMs = Math.max(entry.maxMs, actualDuration);
  entry.lastMs = actualDuration;
  entry.samples.push(actualDuration);

  if (entry.samples.length > MAX_SAMPLES) {
    entry.samples.shift();
  }

  // Warn about slow renders (>16ms)
  if (actualDuration > 16) {
    console.warn(
      `[Profiler] Slow ${phase} of ${id}: ${actualDuration.toFixed(2)}ms (base: ${baseDuration.toFixed(2)}ms)`
    );
  }
}

/**
 * Create a performance mark (visible in DevTools Performance tab).
 */
export function mark(name: string): void {
  if (!isDev) return;
  performance.mark(`tide:${name}`);
}

/**
 * Create a performance measure between two marks.
 */
export function measure(name: string, startMark: string, endMark?: string): void {
  if (!isDev) return;
  try {
    performance.measure(
      `tide:${name}`,
      `tide:${startMark}`,
      endMark ? `tide:${endMark}` : undefined
    );
  } catch {
    // Marks may not exist
  }
}

// Expose to window for debugging
if (isDev && typeof window !== 'undefined') {
  (window as any).__tidePerf = {
    perf,
    fpsTracker,
    memory,
    report: () => perf.report(),
    clear: () => perf.clear(),
    // Memory debugging helpers
    startMemoryMonitor: () => memory.startMonitoring(),
    stopMemoryMonitor: () => memory.stopMonitoring(),
    memoryReport: () => memory.report(),
    memoryReset: () => memory.reset(),
  };
  // Enable memory debug flag
  (window as any).__TIDE_MEMORY_DEBUG__ = false;
  console.log('[Profiling] Performance tools available at window.__tidePerf');
  console.log('[Profiling] Set window.__TIDE_MEMORY_DEBUG__ = true for verbose memory logging');
}
