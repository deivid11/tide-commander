import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPendingBackgroundTask,
  clearPendingBackgroundTasks,
  getActiveSubagentByToolUseId,
  getActiveSubagentsForAgent,
  handleTaskToolResult,
  handleTaskToolStart,
  hasPendingBackgroundTasks,
  resetSubagentStateForTests,
  resolvePendingBackgroundTask,
  resolvePendingBackgroundTaskByTaskId,
} from './runtime-subagents.js';

describe('runtime-subagents', () => {
  const log = { log: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    resetSubagentStateForTests();
  });

  it('tracks Task tool subagent start', () => {
    const event: any = {
      type: 'tool_start',
      toolName: 'Task',
      toolUseId: 'tu-1',
      subagentName: 'Researcher',
      subagentDescription: 'Does research',
      subagentType: 'research',
      subagentModel: 'claude-3-7',
    };

    const created = handleTaskToolStart('agent-1', event, log);

    expect(created).toBeTruthy();
    expect(created?.name).toBe('Researcher');
    expect(getActiveSubagentByToolUseId('tu-1')?.name).toBe('Researcher');
    expect(getActiveSubagentsForAgent('agent-1')).toHaveLength(1);
  });

  it('attaches subagentName and clears tracking on Task tool result', () => {
    const startEvent: any = {
      type: 'tool_start',
      toolName: 'Task',
      toolUseId: 'tu-2',
      subagentName: 'Builder',
    };
    handleTaskToolStart('agent-2', startEvent, log);

    const resultEvent: any = {
      type: 'tool_result',
      toolName: 'Task',
      toolUseId: 'tu-2',
    };
    handleTaskToolResult('agent-2', resultEvent, log);

    expect(resultEvent.subagentName).toBe('Builder');
    expect(getActiveSubagentByToolUseId('tu-2')).toBeUndefined();
    expect(getActiveSubagentsForAgent('agent-2')).toHaveLength(0);
  });

  describe('pending background tasks', () => {
    it('tracks and resolves pending tasks per agent', () => {
      expect(hasPendingBackgroundTasks('agent-1')).toBe(false);

      addPendingBackgroundTask('agent-1', 'tu-a');
      addPendingBackgroundTask('agent-1', 'tu-b');
      expect(hasPendingBackgroundTasks('agent-1')).toBe(true);
      expect(hasPendingBackgroundTasks('agent-2')).toBe(false);

      expect(resolvePendingBackgroundTask('agent-1', 'tu-a')).toBe(true);
      expect(hasPendingBackgroundTasks('agent-1')).toBe(true);

      expect(resolvePendingBackgroundTask('agent-1', 'tu-b')).toBe(true);
      expect(hasPendingBackgroundTasks('agent-1')).toBe(false);
    });

    it('resolve is idempotent and safe for unknown ids', () => {
      addPendingBackgroundTask('agent-1', 'tu-a');
      expect(resolvePendingBackgroundTask('agent-1', 'tu-a')).toBe(true);
      expect(resolvePendingBackgroundTask('agent-1', 'tu-a')).toBe(false);
      expect(resolvePendingBackgroundTask('agent-x', 'tu-y')).toBe(false);
    });

    it('clear drops all pending tasks for the agent', () => {
      addPendingBackgroundTask('agent-1', 'tu-a');
      addPendingBackgroundTask('agent-1', 'tu-b');
      clearPendingBackgroundTasks('agent-1');
      expect(hasPendingBackgroundTasks('agent-1')).toBe(false);
    });

    it('resolves by taskId when the notification lacks a toolUseId', () => {
      addPendingBackgroundTask('agent-1', 'tu-a', 'task-1');
      addPendingBackgroundTask('agent-1', 'tu-b', 'task-2');

      expect(resolvePendingBackgroundTaskByTaskId('agent-1', 'task-1')).toBe(true);
      expect(hasPendingBackgroundTasks('agent-1')).toBe(true);
      expect(resolvePendingBackgroundTaskByTaskId('agent-1', 'task-1')).toBe(false);
      expect(resolvePendingBackgroundTaskByTaskId('agent-1', 'task-unknown')).toBe(false);

      expect(resolvePendingBackgroundTaskByTaskId('agent-1', 'task-2')).toBe(true);
      expect(hasPendingBackgroundTasks('agent-1')).toBe(false);
    });
  });
});

