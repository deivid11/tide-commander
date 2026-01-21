/**
 * WebSocket Debugger - Captures and stores incoming/outgoing messages for debugging
 */

export interface DebugMessage {
  id: string;
  direction: 'incoming' | 'outgoing';
  type: string;
  payload: unknown;
  timestamp: number;
  size: number;
  raw: string;
}

const MAX_MESSAGES = 500;

class WebSocketDebugger {
  private messages: DebugMessage[] = [];
  private enabled = true; // Enabled by default for debugging
  private listeners: Set<() => void> = new Set();
  private idCounter = 0;

  /** Enable/disable message capture */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      console.log('[WS Debugger] Enabled - capturing messages');
    } else {
      console.log('[WS Debugger] Disabled');
    }
    this.notify();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Capture an incoming message from the server */
  captureIncoming(raw: string): void {
    if (!this.enabled) return;

    try {
      const parsed = JSON.parse(raw);
      this.addMessage({
        id: `msg-${++this.idCounter}`,
        direction: 'incoming',
        type: parsed.type || 'unknown',
        payload: parsed.payload,
        timestamp: Date.now(),
        size: raw.length,
        raw,
      });
    } catch {
      this.addMessage({
        id: `msg-${++this.idCounter}`,
        direction: 'incoming',
        type: 'parse_error',
        payload: null,
        timestamp: Date.now(),
        size: raw.length,
        raw,
      });
    }
  }

  /** Capture an outgoing message to the server */
  captureOutgoing(raw: string): void {
    if (!this.enabled) return;

    try {
      const parsed = JSON.parse(raw);
      this.addMessage({
        id: `msg-${++this.idCounter}`,
        direction: 'outgoing',
        type: parsed.type || 'unknown',
        payload: parsed.payload,
        timestamp: Date.now(),
        size: raw.length,
        raw,
      });
    } catch {
      this.addMessage({
        id: `msg-${++this.idCounter}`,
        direction: 'outgoing',
        type: 'parse_error',
        payload: null,
        timestamp: Date.now(),
        size: raw.length,
        raw,
      });
    }
  }

  private addMessage(msg: DebugMessage): void {
    this.messages.push(msg);
    // Keep only the last MAX_MESSAGES
    if (this.messages.length > MAX_MESSAGES) {
      this.messages = this.messages.slice(-MAX_MESSAGES);
    }
    this.notify();
  }

  /** Get all captured messages */
  getMessages(): DebugMessage[] {
    return this.messages;
  }

  /** Get messages filtered by type */
  getMessagesByType(type: string): DebugMessage[] {
    return this.messages.filter(m => m.type === type);
  }

  /** Get messages filtered by direction */
  getMessagesByDirection(direction: 'incoming' | 'outgoing'): DebugMessage[] {
    return this.messages.filter(m => m.direction === direction);
  }

  /** Clear all captured messages */
  clear(): void {
    this.messages = [];
    this.notify();
  }

  /** Subscribe to changes */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(l => l());
  }

  /** Get unique message types for filtering */
  getUniqueTypes(): string[] {
    const types = new Set(this.messages.map(m => m.type));
    return Array.from(types).sort();
  }

  /** Get stats */
  getStats(): { total: number; incoming: number; outgoing: number; types: number } {
    return {
      total: this.messages.length,
      incoming: this.messages.filter(m => m.direction === 'incoming').length,
      outgoing: this.messages.filter(m => m.direction === 'outgoing').length,
      types: this.getUniqueTypes().length,
    };
  }
}

// Singleton instance
export const wsDebugger = new WebSocketDebugger();

// Expose to window for console debugging
if (typeof window !== 'undefined') {
  (window as any).__wsDebugger = wsDebugger;
}
