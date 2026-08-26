import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PluginManager } from '../manager.js';
import type { PluginRecommendedTasksData, PluginTaskItem } from '../../../shared/plugin-types.js';
import {
  bolbaTasksPlugin,
  buildAiTaskRecommendationPrompt,
  createBolbaTasksPlugin,
  validateAiTaskRecommendations,
} from './bolba-tasks.js';

let testRoot: string;
const originalUrl = process.env.BOLBA_TASKS_URL;
const originalToken = process.env.BOLBA_TASKS_TOKEN;

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-bolba-plugin-'));
  process.env.BOLBA_TASKS_URL = 'http://127.0.0.1:9876/';
  process.env.BOLBA_TASKS_TOKEN = 'test-token';
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  if (originalUrl === undefined) delete process.env.BOLBA_TASKS_URL;
  else process.env.BOLBA_TASKS_URL = originalUrl;
  if (originalToken === undefined) delete process.env.BOLBA_TASKS_TOKEN;
  else process.env.BOLBA_TASKS_TOKEN = originalToken;
  vi.unstubAllGlobals();
});

function taskListResponse() {
  return new Response(JSON.stringify({
    count: 2,
    tasks: [{
      id: 5301,
      proj: 'tide-commander',
      status: 'open',
      due: '2026-08-21',
      reg: '2026-08-20 10:30',
      title: 'Finish plugin runtime',
    }, {
      id: 5290,
      proj: 'tide-commander',
      status: 'done',
      title: 'Already finished',
    }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('builtin Bolba Tasks plugin', () => {
  it('builds a request for AI analysis and validates only real unique task IDs', () => {
    const tasks: PluginTaskItem[] = [
      { id: 1, title: 'Cambiar certificado', status: 'open', due: '2026-08-25' },
      { id: 2, title: 'Actualizar documentación', status: 'open' },
    ];
    const prompt = buildAiTaskRecommendationPrompt(
      'agent-1', 'request-1', 'output-1', tasks, 2,
      'http://localhost:5174', new Date(2026, 7, 25),
    );
    expect(prompt).toContain('[BOLBA_TASK_RECOMMENDATIONS_REQUEST]');
    expect(prompt).toContain('elige exactamente 2');
    expect(prompt).toContain('/api/plugins/bolba-tasks/actions/recommendations');
    expect(prompt).toContain('"requestId": "request-1"');
    expect(prompt).toContain('X-Auth-Token');

    const recommendations = [
      { id: 1, reason: 'Vence hoy y tiene impacto operativo.', urgency: 'critical', signals: ['vence hoy'] },
      { id: 2, reason: 'Permite desbloquear el siguiente trabajo.', urgency: 'medium', signals: ['desbloquea trabajo'] },
    ];
    expect(validateAiTaskRecommendations(recommendations, tasks, 2)).toMatchObject([
      { rank: 1, task: { id: 1 }, urgency: 'critical' },
      { rank: 2, task: { id: 2 }, urgency: 'medium' },
    ]);
    expect(() => validateAiTaskRecommendations([{ ...recommendations[0], id: 999 }, recommendations[1]], tasks, 2))
      .toThrow(/inexistente/);
  });

  it('always asks the selected agent AI before rendering recommendations', async () => {
    const fetchMock = vi.fn(async () => taskListResponse());
    const askAgent = vi.fn(async () => undefined);
    vi.stubGlobal('fetch', fetchMock);
    const manager = new PluginManager({
      dataDir: path.join(testRoot, 'state'),
      builtins: [createBolbaTasksPlugin({
        agentExists: (id) => id === 'agent-1',
        askAgent,
        baseUrl: () => 'http://localhost:5174',
        now: () => new Date(2026, 7, 25),
      })],
    });
    await manager.initialize();

    const output = await manager.executeSlashCommand('agent-1', '/tasks-recommended 5');
    expect(output).toMatchObject({
      pluginId: 'bolba-tasks',
      rendererId: 'recommended-task-list',
      data: {
        kind: 'bolba-recommended-tasks',
        agentId: 'agent-1',
        status: 'generating',
        count: 0,
        totalCandidates: 1,
        limit: 5,
        items: [],
      },
    });
    await vi.waitFor(() => expect(askAgent).toHaveBeenCalledWith('agent-1', expect.stringContaining(output.instanceId)));

    const generating = output.data as PluginRecommendedTasksData;
    const ready = await manager.executeAction('bolba-tasks', 'recommendations', {
      agentId: 'agent-1',
      instanceId: output.instanceId,
      rendererId: output.rendererId,
      requestId: generating.requestId,
      analysisSummary: 'Se priorizó vencimiento e impacto operativo.',
      recommendations: [{
        id: 5301,
        reason: 'Debe resolverse antes de continuar el runtime.',
        urgency: 'high',
        signals: ['vencida', 'impacto operativo'],
      }],
    });
    expect(ready.data).toMatchObject({
      status: 'ready',
      analysisSummary: 'Se priorizó vencimiento e impacto operativo.',
      count: 1,
      items: [{ rank: 1, task: { id: 5301 }, urgency: 'high' }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await manager.shutdown();
  });

  it('maps /tasks to task-list output using the configured local service', async () => {
    const fetchMock = vi.fn(async () => taskListResponse());
    vi.stubGlobal('fetch', fetchMock);
    const manager = new PluginManager({
      dataDir: path.join(testRoot, 'state'),
      builtins: [bolbaTasksPlugin],
    });
    await manager.initialize();

    const output = await manager.executeSlashCommand('agent-1', '/tasks');
    expect(output).toMatchObject({
      pluginId: 'bolba-tasks',
      rendererId: 'task-list',
      data: {
        kind: 'task-list',
        title: 'Bolba Tasks',
        count: 2,
        actions: {
          complete: 'complete',
          reopen: 'reopen',
          refresh: 'refresh',
          openDetails: 'openDetails',
        },
        items: [{
          id: 5301,
          title: 'Finish plugin runtime',
          project: 'tide-commander',
          status: 'open',
          registeredAt: '2026-08-20 10:30',
          due: '2026-08-21',
        }, {
          id: 5290,
          title: 'Already finished',
          project: 'tide-commander',
          status: 'done',
        }],
      },
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9876/tasks', expect.objectContaining({
      headers: expect.objectContaining({ 'X-Auth-Token': 'test-token' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9876/tasks?status=done&limit=8', expect.any(Object));
    await manager.shutdown();
  });

  it('completes and reopens tasks, then refreshes the existing output instance', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/tasks') || url.includes('/tasks?status=done')) return taskListResponse();
      return new Response(JSON.stringify({ task: { id: 5301, status: 'done', title: 'Finish plugin runtime' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const manager = new PluginManager({
      dataDir: path.join(testRoot, 'state'),
      builtins: [bolbaTasksPlugin],
    });
    await manager.initialize();

    const completed = await manager.executeAction('bolba-tasks', 'complete', {
      agentId: 'agent-1',
      instanceId: 'task-list-1',
      rendererId: 'task-list',
      itemId: 5301,
    });
    expect(completed.instanceId).toBe('task-list-1');
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:9876/tasks/5301/close', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ status: 'done' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:9876/tasks', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:9876/tasks?status=done&limit=8', expect.any(Object));

    await manager.executeAction('bolba-tasks', 'reopen', { item: { id: 5301 } });
    expect(fetchMock).toHaveBeenNthCalledWith(4, 'http://127.0.0.1:9876/tasks/5301/reopen', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(5, 'http://127.0.0.1:9876/tasks', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(6, 'http://127.0.0.1:9876/tasks?status=done&limit=8', expect.any(Object));
    await manager.shutdown();
  });

  it('completes a recommended task and recalculates the same renderer instance', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/tasks/5301/close')) {
        return new Response(JSON.stringify({ task: { id: 5301, status: 'done', title: 'Finish plugin runtime' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return taskListResponse();
    });
    vi.stubGlobal('fetch', fetchMock);
    const askAgent = vi.fn(async () => undefined);
    const manager = new PluginManager({
      dataDir: path.join(testRoot, 'state'),
      builtins: [createBolbaTasksPlugin({
        agentExists: (id) => id === 'agent-1',
        askAgent,
        baseUrl: () => 'http://localhost:5174',
        now: () => new Date(2026, 7, 25),
      })],
    });
    await manager.initialize();

    const output = await manager.executeAction('bolba-tasks', 'completeRecommended', {
      agentId: 'agent-1',
      instanceId: 'recommendations-1',
      rendererId: 'recommended-task-list',
      itemId: 5301,
      data: { limit: 4 },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:9876/tasks/5301/close', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:9876/tasks', expect.any(Object));
    expect(output).toMatchObject({
      instanceId: 'recommendations-1',
      rendererId: 'recommended-task-list',
      data: { kind: 'bolba-recommended-tasks', status: 'generating', limit: 4 },
    });
    await vi.waitFor(() => expect(askAgent).toHaveBeenCalledWith('agent-1', expect.stringContaining('recommendations-1')));
    await manager.shutdown();
  });

  it('loads a task detail with every timeline event', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: 5030,
      proj: 'MDO',
      type: 'incidente',
      status: 'open',
      title: 'Fix decryptions',
      timeline: ['2026-07-07 21:10 Created', '2026-07-29 22:20 Reopened'],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const manager = new PluginManager({
      dataDir: path.join(testRoot, 'state'),
      builtins: [bolbaTasksPlugin],
    });
    await manager.initialize();

    const output = await manager.executeAction('bolba-tasks', 'details', { itemId: 5030 });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9876/tasks/5030', expect.any(Object));
    expect(output.data).toMatchObject({
      kind: 'bolba-task-details',
      task: { id: 5030, title: 'Fix decryptions', project: 'MDO', status: 'open' },
      events: ['2026-07-07 21:10 Created', '2026-07-29 22:20 Reopened'],
    });
    await manager.shutdown();
  });

  it('rejects mutation actions without a numeric task id', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const manager = new PluginManager({
      dataDir: path.join(testRoot, 'state'),
      builtins: [bolbaTasksPlugin],
    });
    await manager.initialize();
    await expect(manager.executeAction('bolba-tasks', 'complete', { itemId: '../bad' }))
      .rejects.toThrow('requires a numeric itemId');
    await manager.shutdown();
  });
});
