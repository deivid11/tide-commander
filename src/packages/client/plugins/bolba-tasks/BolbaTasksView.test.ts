import { describe, expect, it } from 'vitest';
import type { PluginTaskItem } from '../types';
import {
  adjacentBolbaTask,
  resolveBolbaTaskDetailsModalData,
} from './bolbaTaskNavigation';
import { isRecommendedTasksData } from './RecommendedTasksCard';
import {
  bolbaRecommendationRequestPreview,
  parseBolbaRecommendationRequest,
} from './bolbaRecommendationRequest';

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

  it('recognizes and summarizes the internal AI recommendation request', () => {
    const prompt = '[BOLBA_TASK_RECOMMENDATIONS_REQUEST]\nAnaliza y elige exactamente 7 para completar hoy (2026-08-25).';
    expect(parseBolbaRecommendationRequest(prompt)).toEqual({ count: 7, day: '2026-08-25' });
    expect(bolbaRecommendationRequestPreview(prompt)).toBe('Bolba · IA analizando 7 recomendaciones…');
    expect(parseBolbaRecommendationRequest('Recomienda tareas')).toBeNull();
  });

  it('recognizes the custom recommendation payload', () => {
    expect(isRecommendedTasksData({
      kind: 'bolba-recommended-tasks',
      agentId: 'agent-1',
      requestId: 'request-1',
      status: 'ready',
      items: [{ task: tasks[0], rank: 1 }],
    })).toBe(true);
    expect(isRecommendedTasksData({ kind: 'task-list', items: [] })).toBe(false);
  });

  it('preserves recommendation completion context for the detail modal', () => {
    expect(resolveBolbaTaskDetailsModalData({
      task: tasks[0],
      tasks,
      completion: {
        agentId: 'agent-1',
        instanceId: 'output-1',
        rendererId: 'recommended-task-list',
        action: 'completeRecommended',
        data: { limit: 7 },
      },
    })?.completion).toEqual({
      agentId: 'agent-1',
      instanceId: 'output-1',
      rendererId: 'recommended-task-list',
      action: 'completeRecommended',
      data: { limit: 7 },
    });
  });

  it('returns previous and next tasks without wrapping at boundaries', () => {
    expect(adjacentBolbaTask(tasks, 2, -1)).toEqual(tasks[0]);
    expect(adjacentBolbaTask(tasks, '2', 1)).toEqual(tasks[2]);
    expect(adjacentBolbaTask(tasks, 1, -1)).toBeNull();
    expect(adjacentBolbaTask(tasks, 3, 1)).toBeNull();
  });
});
