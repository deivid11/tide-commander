import { AsyncLocalStorage } from 'node:async_hooks';

interface LogContext {
  agentId?: string;
}

const als = new AsyncLocalStorage<LogContext>();

export function withAgentContext<T>(agentId: string | undefined, fn: () => T): T {
  if (!agentId) return fn();
  return als.run({ agentId }, fn);
}

export function getCurrentAgentId(): string | undefined {
  return als.getStore()?.agentId;
}
