import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getActiveSubagentByToolUseId,
  getActiveSubagentsForAgent,
  handleTaskToolResult,
  handleTaskToolStart,
  resetSubagentStateForTests,
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
});

