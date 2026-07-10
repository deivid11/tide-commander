import { describe, expect, it } from 'vitest';
import { applyTodoWritePayload, resolveTodoWriteDisplay } from './todoMerge';

describe('todoMerge', () => {
  it('keeps full list on initial non-merge write', () => {
    const next = applyTodoWritePayload([], {
      merge: false,
      todos: [
        { id: '1', content: 'First', status: 'in_progress' },
        { id: '2', content: 'Second', status: 'pending' },
      ],
    });
    expect(next).toEqual([
      { id: '1', content: 'First', status: 'in_progress' },
      { id: '2', content: 'Second', status: 'pending' },
    ]);
  });

  it('fills content from prior snapshot on Grok merge:true status-only updates', () => {
    const prior = [
      { id: '1', content: 'Overhaul CSS', status: 'in_progress' as const },
      { id: '2', content: 'Restructure SpawnModal', status: 'pending' as const },
      { id: '3', content: 'Restructure EditModal', status: 'pending' as const },
      { id: '4', content: 'Mobile tweaks', status: 'pending' as const },
    ];
    const next = applyTodoWritePayload(prior, {
      merge: true,
      todos: [
        { id: '1', status: 'completed' },
        { id: '2', status: 'completed' },
        { id: '3', status: 'in_progress' },
      ],
    });
    expect(next).toEqual([
      { id: '1', content: 'Overhaul CSS', status: 'completed' },
      { id: '2', content: 'Restructure SpawnModal', status: 'completed' },
      { id: '3', content: 'Restructure EditModal', status: 'in_progress' },
      { id: '4', content: 'Mobile tweaks', status: 'pending' },
    ]);
  });

  it('does not return empty rows for status-only merge without prior', () => {
    const next = resolveTodoWriteDisplay(
      JSON.stringify({
        merge: true,
        todos: [
          { id: '3', status: 'completed' },
          { id: '4', status: 'completed' },
        ],
      }),
      []
    );
    expect(next.every((t) => t.content.length > 0)).toBe(true);
    expect(next.map((t) => t.content)).toEqual(['Task 3', 'Task 4']);
  });
});
