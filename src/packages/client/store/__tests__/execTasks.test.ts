import { describe, expect, it, vi } from 'vitest';
import { createExecTaskActions } from '../execTasks';
import type { StoreState } from '../types';

function createMockStore() {
  const state = { execTasks: new Map() } as unknown as StoreState;
  const notify = vi.fn();
  const actions = createExecTaskActions(
    () => state,
    (updater) => updater(state),
    notify,
  );
  return { state, actions, notify };
}

describe('exec task store', () => {
  it('replaces a task object on completion so shallow selectors rerender streamed widgets', () => {
    const { state, actions, notify } = createMockStore();
    actions.handleExecTaskStarted('task-1', 'agent-1', 'Agent', '/deploy', '/tmp', false, 100);
    const running = state.execTasks!.get('task-1');

    actions.handleExecTaskCompleted('task-1', 'agent-1', 0, true, 200);
    const completed = state.execTasks!.get('task-1');

    expect(completed).not.toBe(running);
    expect(completed).toMatchObject({ status: 'completed', exitCode: 0, completedAt: 200 });
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
