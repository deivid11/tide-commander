/**
 * Agent Message Debugger Service
 *
 * Captures and stores agent-specific messages (sent to and received from server)
 * for debugging purposes. Integrates with the Guake Terminal UI.
 */

/**
 * Generate a UUID, with fallback for non-secure contexts where crypto.randomUUID is unavailable
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (HTTP)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface AgentDebugMessage {
  id: string;
  agentId: string;
  direction: 'sent' | 'received';
  type: string;
  payload: unknown;
  timestamp: number;
  size: number;
  raw: string;
}

export interface AgentDebugStats {
  total: number;
  sent: number;
  received: number;
  messageTypes: string[];
}

export interface DebugLog {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: unknown;
  timestamp: number;
  source?: string;
}

type DebugListener = (agentId: string) => void;
type LogListener = () => void;

class AgentDebuggerService {
  private messages: Map<string, AgentDebugMessage[]> = new Map();
  private logs: DebugLog[] = [];
  private maxMessagesPerAgent = 200;
  private maxLogs = 500;
  private enabled = false;
  private listeners: Set<DebugListener> = new Set();
  private logListeners: Set<LogListener> = new Set();

  /**
   * Enable or disable the debugger
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.notifyListeners('all');
  }

  /**
   * Check if debugger is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Capture a message sent to the server for a specific agent
   */
  captureSent(agentId: string, raw: string): void {
    if (!this.enabled) return;

    try {
      const parsed = JSON.parse(raw);
      console.log(`[AgentDebugger] SENT - agent: ${agentId.slice(0,4)}, type: ${parsed.type}, size: ${raw.length}B`);
      this.addMessage(agentId, {
        id: generateUUID(),
        agentId,
        direction: 'sent',
        type: parsed.type || 'unknown',
        payload: parsed.payload || parsed,
        timestamp: Date.now(),
        size: raw.length,
        raw,
      });
    } catch (_e) {
      console.error(`[AgentDebugger] Failed to parse SENT message:`, String(_e).slice(0, 80));
      this.addMessage(agentId, {
        id: generateUUID(),
        agentId,
        direction: 'sent',
        type: 'parse_error',
        payload: { error: String(_e) },
        timestamp: Date.now(),
        size: raw.length,
        raw,
      });
    }
  }

  /**
   * Capture a message received from the server for a specific agent
   */
  captureReceived(agentId: string, raw: string): void {
    if (!this.enabled) return;

    try {
      const parsed = JSON.parse(raw);
      console.log(`[AgentDebugger] RECEIVED - agent: ${agentId.slice(0,4)}, type: ${parsed.type}, size: ${raw.length}B`);
      this.addMessage(agentId, {
        id: generateUUID(),
        agentId,
        direction: 'received',
        type: parsed.type || 'unknown',
        payload: parsed.payload || parsed,
        timestamp: Date.now(),
        size: raw.length,
        raw,
      });
    } catch (_e) {
      console.error(`[AgentDebugger] Failed to parse RECEIVED message:`, String(_e).slice(0, 80));
      this.addMessage(agentId, {
        id: generateUUID(),
        agentId,
        direction: 'received',
        type: 'parse_error',
        payload: { error: String(_e) },
        timestamp: Date.now(),
        size: raw.length,
        raw,
      });
    }
  }

  /**
   * Add a message to the agent's message buffer
   */
  private addMessage(agentId: string, message: AgentDebugMessage): void {
    let agentMessages = this.messages.get(agentId);

    if (!agentMessages) {
      agentMessages = [];
      this.messages.set(agentId, agentMessages);
    }

    agentMessages.push(message);
    console.log(`[AgentDebugger] Added message for ${agentId}, total: ${agentMessages.length}, type: ${message.type}, direction: ${message.direction}`);

    // Keep only the latest N messages per agent
    if (agentMessages.length > this.maxMessagesPerAgent) {
      agentMessages.shift();
    }

    this.notifyListeners(agentId);
  }

  /**
   * Get all messages for a specific agent
   */
  getMessages(agentId: string): AgentDebugMessage[] {
    return this.messages.get(agentId) || [];
  }

  /**
   * Get stats for a specific agent
   */
  getStats(agentId: string): AgentDebugStats {
    const messages = this.getMessages(agentId);
    const sent = messages.filter(m => m.direction === 'sent').length;
    const received = messages.filter(m => m.direction === 'received').length;
    const types = [...new Set(messages.map(m => m.type))];

    return {
      total: messages.length,
      sent,
      received,
      messageTypes: types,
    };
  }

  /**
   * Clear all messages for a specific agent
   */
  clearMessages(agentId: string): void {
    this.messages.delete(agentId);
    this.notifyListeners(agentId);
  }

  /**
   * Clear all messages for all agents
   */
  clearAllMessages(): void {
    this.messages.clear();
    this.notifyListeners('all');
  }

  /**
   * Subscribe to message updates
   */
  subscribe(listener: DebugListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify listeners about message updates
   */
  private notifyListeners(agentId: string): void {
    this.listeners.forEach(listener => listener(agentId));
  }

  /**
   * Get all agent IDs that have messages
   */
  getAgentIds(): string[] {
    return Array.from(this.messages.keys());
  }

  // ============================================================================
  // LOGS SECTION
  // ============================================================================

  /**
   * Add a log entry
   */
  log(level: DebugLog['level'], message: string, data?: unknown, source?: string): void {
    const entry: DebugLog = {
      id: generateUUID(),
      level,
      message,
      data,
      timestamp: Date.now(),
      source,
    };

    this.logs.push(entry);

    // Keep only the latest N logs
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    this.notifyLogListeners();
  }

  /**
   * Convenience methods for different log levels
   */
  debug(message: string, data?: unknown, source?: string): void {
    this.log('debug', message, data, source);
  }

  info(message: string, data?: unknown, source?: string): void {
    this.log('info', message, data, source);
  }

  warn(message: string, data?: unknown, source?: string): void {
    this.log('warn', message, data, source);
  }

  error(message: string, data?: unknown, source?: string): void {
    this.log('error', message, data, source);
  }

  /**
   * Get all logs
   */
  getLogs(): DebugLog[] {
    return this.logs;
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = [];
    this.notifyLogListeners();
  }

  /**
   * Subscribe to log updates
   */
  subscribeLogs(listener: LogListener): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  /**
   * Notify log listeners
   */
  private notifyLogListeners(): void {
    this.logListeners.forEach(listener => listener());
  }
}

// Singleton instance
export const agentDebugger = new AgentDebuggerService();

// Global debug log function for easy access
export const debugLog = {
  debug: (message: string, data?: unknown, source?: string) => agentDebugger.debug(message, data, source),
  info: (message: string, data?: unknown, source?: string) => agentDebugger.info(message, data, source),
  warn: (message: string, data?: unknown, source?: string) => agentDebugger.warn(message, data, source),
  error: (message: string, data?: unknown, source?: string) => agentDebugger.error(message, data, source),
};
