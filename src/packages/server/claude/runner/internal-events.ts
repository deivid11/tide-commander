import type { ActiveProcess, StandardEvent } from '../types.js';

export type RunnerInternalEvent =
  | { type: 'runner.activity'; agentId: string; timestamp: number }
  | { type: 'runner.session_id'; agentId: string; sessionId: string }
  | { type: 'runner.process_spawned'; agentId: string; pid: number | undefined }
  | { type: 'runner.process_spawn_error'; agentId: string; error: Error }
  | {
      type: 'runner.process_closed';
      agentId: string;
      pid: number | undefined;
      code: number | null;
      signal: NodeJS.Signals | null;
    }
  | {
      type: 'runner.watchdog_missing_process';
      agentId: string;
      pid: number;
      activeProcess: ActiveProcess;
    }
  | { type: 'runner.event'; agentId: string; event: StandardEvent };

type EventType = RunnerInternalEvent['type'];
type EventHandler<T extends EventType> = (event: Extract<RunnerInternalEvent, { type: T }>) => void;

export class RunnerInternalEventBus {
  private handlers: Map<EventType, Set<(event: RunnerInternalEvent) => void>> = new Map();

  on<T extends EventType>(type: T, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }

    const wrapped = handler as unknown as (event: RunnerInternalEvent) => void;
    this.handlers.get(type)!.add(wrapped);

    return () => {
      this.handlers.get(type)?.delete(wrapped);
    };
  }

  emit(event: RunnerInternalEvent): void {
    const handlers = this.handlers.get(event.type);
    if (!handlers || handlers.size === 0) {
      return;
    }
    for (const handler of handlers) {
      handler(event);
    }
  }
}
