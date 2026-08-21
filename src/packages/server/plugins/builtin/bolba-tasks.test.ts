import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PluginManager } from '../manager.js';
import { bolbaTasksPlugin } from './bolba-tasks.js';

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
