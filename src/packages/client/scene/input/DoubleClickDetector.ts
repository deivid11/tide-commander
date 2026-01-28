/**
 * Generic double-click/double-tap detector.
 * Handles timing logic for detecting double interactions on entities.
 */
export class DoubleClickDetector<T = string> {
  private lastClickTime = 0;
  private lastClickId: T | null = null;
  private clickTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly threshold: number;

  constructor(threshold = 200) {
    this.threshold = threshold;
  }

  /**
   * Handle a click/tap on an entity.
   * Returns 'single' or 'double' based on timing.
   */
  handleClick(entityId: T): 'single' | 'double' {
    const now = performance.now();
    const timeSinceLast = now - this.lastClickTime;

    console.log('[DoubleClickDetector] handleClick - entityId:', entityId,
      'lastId:', this.lastClickId,
      'timeSinceLast:', timeSinceLast.toFixed(0),
      'threshold:', this.threshold);

    // Check for double-click
    if (
      this.lastClickTime > 0 &&
      this.lastClickId === entityId &&
      timeSinceLast < this.threshold
    ) {
      // Double-click detected
      console.log('[DoubleClickDetector] DOUBLE detected!');
      this.clearTimer();
      this.reset();
      return 'double';
    }

    // Single click - track for potential double-click
    this.lastClickId = entityId;
    this.lastClickTime = now;

    // Clear any existing timer
    this.clearTimer();

    // Set timer to reset state after threshold
    this.clickTimer = setTimeout(() => {
      this.clickTimer = null;
      this.lastClickId = null;
      this.lastClickTime = 0;
    }, this.threshold);

    return 'single';
  }

  /**
   * Reset the detector state.
   */
  reset(): void {
    this.clearTimer();
    this.lastClickId = null;
    this.lastClickTime = 0;
  }

  /**
   * Clear the timeout timer.
   */
  private clearTimer(): void {
    if (this.clickTimer) {
      clearTimeout(this.clickTimer);
      this.clickTimer = null;
    }
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.clearTimer();
  }
}
