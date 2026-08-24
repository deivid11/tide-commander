import { describe, expect, it } from 'vitest';
import type { PluginTaskItem } from '../types';
import {
  adjacentBolbaTask,
  resolveBolbaTaskDetailsModalData,
} from './bolbaTaskNavigation';

const tasks: PluginTaskItem[] = [
  { id: 1, title: 'First' },
  { id: 2, title: 'Second' },
  { id: 3, title: 'Third' },
];

describe('Bolba task detail navigation', () => {
  it('keeps direct task data backward compatible', () => {
    expect(resolveBolbaTaskDetailsModalData(tasks[0])).toEqual({
      task: tasks[0],
      tasks: [tasks[0]],
    });
  });

  it('deduplicates navigation context and includes the selected task', () => {
    const selected = { id: 9, title: 'Selected' };
    expect(resolveBolbaTaskDetailsModalData({
      task: selected,
      tasks: [tasks[0], tasks[0], tasks[1]],
    })).toEqual({
      task: selected,
      tasks: [selected, tasks[0], tasks[1]],
    });
  });

  it('returns previous and next tasks without wrapping at boundaries', () => {
    expect(adjacentBolbaTask(tasks, 2, -1)).toEqual(tasks[0]);
    expect(adjacentBolbaTask(tasks, '2', 1)).toEqual(tasks[2]);
    expect(adjacentBolbaTask(tasks, 1, -1)).toBeNull();
    expect(adjacentBolbaTask(tasks, 3, 1)).toBeNull();
  });
});
