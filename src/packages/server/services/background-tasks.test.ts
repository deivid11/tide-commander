import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearBackgroundTasks,
  completeBackgroundTask,
  getAgentIdsWithBackgroundTasks,
  getBackgroundTasksForAgent,
  noteToolStart,
  onBackgroundTasksChanged,
  parseBashBackgroundStub,
  registerBackgroundTask,
  resetBackgroundTaskStateForTests,
} from './background-tasks.js';

describe('parseBashBackgroundStub', () => {
  it('parses the explicit run_in_background stub', () => {
    const stub = 'Command running in background with ID: b05zppilq. Output is being written to: /tmp/claude-1000/-home-riven-d/abc-123/tasks/b05zppilq.output.';
    expect(parseBashBackgroundStub(stub)).toEqual({
      taskId: 'b05zppilq',
      outputFile: '/tmp/claude-1000/-home-riven-d/abc-123/tasks/b05zppilq.output',
    });
  });

  it('parses the timeout-promotion stub (any timeout value)', () => {
    const stub = 'Command did not complete within its 120s timeout and was moved to the background (ID: bag5rornr). Output is being written to: /tmp/claude-1000/-home-riven-d/abc-123/tasks/bag5rornr.output. You will be notified when it completes.';
    expect(parseBashBackgroundStub(stub)).toEqual({
      taskId: 'bag5rornr',
      outputFile: '/tmp/claude-1000/-home-riven-d/abc-123/tasks/bag5rornr.output',
    });
  });

  it('returns null for real Bash output', () => {
    expect(parseBashBackgroundStub('total 12\ndrwxr-xr-x 3 riven riven 4096 .')).toBeNull();
    expect(parseBashBackgroundStub(undefined)).toBeNull();
    expect(parseBashBackgroundStub('')).toBeNull();
  });
});

describe('background task registry', () => {
  beforeEach(() => {
    resetBackgroundTaskStateForTests();
  });

  it('registers from the stub and merges the later task_started by toolUseId', () => {
    noteToolStart({ type: 'tool_start', toolName: 'Bash', toolUseId: 'toolu_1', toolInput: { command: 'sleep 600', description: 'Long download' } });
    registerBackgroundTask('agent-1', { toolUseId: 'toolu_1', taskId: 'babc12345', outputFile: '/tmp/x/tasks/babc12345.output' });
    registerBackgroundTask('agent-1', { toolUseId: 'toolu_1', taskId: 'babc12345' });

    const tasks = getBackgroundTasksForAgent('agent-1');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      key: 'toolu_1',
      taskId: 'babc12345',
      toolName: 'Bash',
      command: 'sleep 600',
      description: 'Long download',
      outputFile: '/tmp/x/tasks/babc12345.output',
    });
  });

  it('completes by taskId even when registered under the toolUseId key', () => {
    registerBackgroundTask('agent-1', { toolUseId: 'toolu_1', taskId: 'babc12345' });
    expect(completeBackgroundTask('agent-1', { taskId: 'babc12345' })).toBe(true);
    expect(getBackgroundTasksForAgent('agent-1')).toHaveLength(0);
    expect(getAgentIdsWithBackgroundTasks()).toHaveLength(0);
  });

  it('a real tool_result for an untracked toolUseId is a no-op', () => {
    registerBackgroundTask('agent-1', { toolUseId: 'toolu_1' });
    expect(completeBackgroundTask('agent-1', { toolUseId: 'toolu_other' })).toBe(false);
    expect(getBackgroundTasksForAgent('agent-1')).toHaveLength(1);
  });

  it('clearBackgroundTasks drops the agent and notifies listeners', () => {
    const changed: string[] = [];
    onBackgroundTasksChanged((agentId) => changed.push(agentId));
    registerBackgroundTask('agent-1', { toolUseId: 'toolu_1' });
    clearBackgroundTasks('agent-1');
    expect(getBackgroundTasksForAgent('agent-1')).toHaveLength(0);
    expect(changed).toEqual(['agent-1', 'agent-1']);
    // Clearing an agent with nothing tracked must not notify again.
    clearBackgroundTasks('agent-1');
    expect(changed).toHaveLength(2);
  });

  it('keeps tasks of other agents independent', () => {
    registerBackgroundTask('agent-1', { toolUseId: 'toolu_1' });
    registerBackgroundTask('agent-2', { toolUseId: 'toolu_2' });
    completeBackgroundTask('agent-1', { toolUseId: 'toolu_1' });
    expect(getBackgroundTasksForAgent('agent-2')).toHaveLength(1);
  });
});
