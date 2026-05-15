import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Building } from '../../shared/types.js';

// In-memory store stands in for ~/.local/share/tide-commander/buildings.json.
let memoryStore: Building[] = [];

vi.mock('../data/index.js', () => ({
  loadBuildings: vi.fn(() => memoryStore.map(b => ({ ...b }))),
  saveBuildings: vi.fn((next: Building[]) => {
    memoryStore = next.map(b => ({ ...b }));
  }),
  // Stubs for other things the data barrel exports — none should be hit in these tests.
  loadAreas: vi.fn(() => []),
  saveAreas: vi.fn(),
}));

// PM2 / Docker / Terminal / DB service stubs — keep the route layer from
// shelling out to real binaries. We only assert routing, not the runtime.
vi.mock('../services/pm2-service.js', () => ({
  getPM2Name: vi.fn((b: Building) => `tc-${b.id}`),
  getStatus: vi.fn(async () => null),
  getAllStatus: vi.fn(async () => new Map()),
  startProcess: vi.fn(async () => ({ success: true })),
  stopProcess: vi.fn(async () => ({ success: true })),
  restartProcess: vi.fn(async () => ({ success: true })),
  deleteProcess: vi.fn(async () => ({ success: true })),
  getLogs: vi.fn(async () => 'pm2 log line\n'),
}));

vi.mock('../services/docker-service.js', () => ({
  getContainerName: vi.fn((b: Building) => b.docker?.containerName || `tc-${b.id}`),
  getStatus: vi.fn(async () => null),
  getAllContainerStatus: vi.fn(async () => new Map()),
  startContainer: vi.fn(async () => ({ success: true })),
  stopContainer: vi.fn(async () => ({ success: true })),
  restartContainer: vi.fn(async () => ({ success: true })),
  removeContainer: vi.fn(async () => ({ success: true })),
  composeUp: vi.fn(async () => ({ success: true })),
  composeDown: vi.fn(async () => ({ success: true })),
  composeRestart: vi.fn(async () => ({ success: true })),
  getComposeStatus: vi.fn(async () => null),
  getLogs: vi.fn(async () => 'docker log line\n'),
  listAllContainers: vi.fn(async () => [
    { id: 'abc123def456', name: 'postgres18', image: 'postgres:18', status: 'running', ports: [], created: '', state: 'running' },
  ]),
  listComposeProjects: vi.fn(async () => []),
}));

vi.mock('../services/terminal-service.js', () => ({
  startTerminal: vi.fn(async () => ({ success: true })),
  stopTerminal: vi.fn(async () => ({ success: true })),
  restartTerminal: vi.fn(async () => ({ success: true })),
  getTerminalStatus: vi.fn(() => null),
  cleanupTerminal: vi.fn(async () => {}),
  cleanupAllTerminals: vi.fn(),
  onTerminalExit: vi.fn(),
  pollTerminalStatuses: vi.fn(() => new Map()),
  isTerminalRunning: vi.fn(() => false),
}));

vi.mock('../services/database-service.js', () => ({
  closeConnection: vi.fn(async () => {}),
}));

// The router pulls `broadcast` from the WS handler module. We stub the entire
// websocket/handler module to avoid spinning up a real WebSocketServer.
vi.mock('../websocket/handler.js', () => ({
  broadcast: vi.fn(),
}));

import buildingsRouter, { setBroadcast } from './buildings.js';

const broadcasts: any[] = [];
setBroadcast((msg) => {
  broadcasts.push(msg);
});

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/buildings', buildingsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  memoryStore = [];
  broadcasts.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

const validServerBody = {
  name: 'Test Service',
  type: 'server',
  position: { x: 1, z: 2 },
  pm2: { enabled: true, script: 'bun', args: 'run dev', interpreter: 'none' },
};

async function postJson(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchJson(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/buildings — validation', () => {
  it('rejects missing name with 400', async () => {
    const res = await postJson('/api/buildings', {
      type: 'server',
      position: { x: 0, z: 0 },
      pm2: { enabled: true, script: 'bun' },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors).toEqual(expect.arrayContaining([expect.stringMatching(/name is required/)]));
  });

  it('rejects unknown type with 400', async () => {
    const res = await postJson('/api/buildings', { name: 'X', type: 'invalid', position: { x: 0, z: 0 } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors).toEqual(expect.arrayContaining([expect.stringMatching(/type must be one of/)]));
  });

  it('rejects pm2.enabled without script', async () => {
    const res = await postJson('/api/buildings', {
      name: 'X', type: 'server', position: { x: 0, z: 0 },
      pm2: { enabled: true },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors).toEqual(expect.arrayContaining([expect.stringMatching(/pm2\.script/)]));
  });

  it('rejects docker mode container without image', async () => {
    const res = await postJson('/api/buildings', {
      name: 'X', type: 'docker', position: { x: 0, z: 0 },
      docker: { enabled: true, mode: 'container' },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors).toEqual(expect.arrayContaining([expect.stringMatching(/docker\.image/)]));
  });

  it('rejects database type without connections', async () => {
    const res = await postJson('/api/buildings', {
      name: 'DB', type: 'database', position: { x: 0, z: 0 },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors).toEqual(expect.arrayContaining([expect.stringMatching(/database\.connections/)]));
  });

  it('rejects boss subordinates that do not exist', async () => {
    const res = await postJson('/api/buildings', {
      name: 'Boss', type: 'boss', position: { x: 0, z: 0 },
      subordinateBuildingIds: ['nope_123'],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors[0]).toMatch(/subordinateBuildingIds reference unknown/);
  });
});

describe('POST /api/buildings — happy path', () => {
  it('creates a server building, assigns id and createdAt, returns 201', async () => {
    const res = await postJson('/api/buildings', validServerBody);
    expect(res.status).toBe(201);
    const building = await res.json();
    expect(building.id).toMatch(/^building_\d+_test_service$/);
    expect(building.createdAt).toBeTypeOf('number');
    expect(building.status).toBe('stopped');
    expect(building.style).toBe('server-rack'); // type-default

    // Broadcast happened
    expect(broadcasts.some(m => m.type === 'building_created' && m.payload.id === building.id)).toBe(true);

    // Server stripped any client-supplied id even if provided
    const res2 = await postJson('/api/buildings', { ...validServerBody, id: 'i-pick-this' });
    const b2 = await res2.json();
    expect(b2.id).not.toBe('i-pick-this');
  });

  it('strips client-provided createdAt', async () => {
    const res = await postJson('/api/buildings', { ...validServerBody, createdAt: 12345 });
    const b = await res.json();
    expect(b.createdAt).not.toBe(12345);
  });
});

describe('GET /api/buildings', () => {
  it('lists buildings and redacts database passwords', async () => {
    await postJson('/api/buildings', {
      name: 'DB',
      type: 'database',
      position: { x: 0, z: 0 },
      database: {
        connections: [{
          id: 'c1', name: 'Prod', engine: 'mysql',
          host: 'localhost', port: 3306,
          username: 'root', password: 'super-secret',
        }],
      },
    });

    const res = await fetch(`${baseUrl}/api/buildings`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.buildings).toHaveLength(1);
    const conn = body.buildings[0].database.connections[0];
    expect(conn.password).toBeUndefined();
    expect(conn.hasPassword).toBe(true);
  });
});

describe('GET /api/buildings/:id', () => {
  it('returns 404 for missing buildings', async () => {
    const res = await fetch(`${baseUrl}/api/buildings/nope`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/buildings/:id', () => {
  it('merges partial updates and rejects validation failures', async () => {
    const created = await (await postJson('/api/buildings', validServerBody)).json();

    const ok = await patchJson(`/api/buildings/${created.id}`, { position: { x: 9, z: 9 } });
    expect(ok.status).toBe(200);
    const merged = await ok.json();
    expect(merged.position).toEqual({ x: 9, z: 9 });
    expect(merged.pm2.script).toBe('bun'); // unchanged

    // Sending a patch that breaks the schema must 400.
    const bad = await patchJson(`/api/buildings/${created.id}`, { pm2: { enabled: true } });
    expect(bad.status).toBe(400);
  });

  it('ignores client attempts to change id or createdAt', async () => {
    const created = await (await postJson('/api/buildings', validServerBody)).json();
    const res = await patchJson(`/api/buildings/${created.id}`, {
      id: 'hijacked',
      createdAt: 1,
    });
    const merged = await res.json();
    expect(merged.id).toBe(created.id);
    expect(merged.createdAt).toBe(created.createdAt);
  });
});

describe('DELETE /api/buildings/:id', () => {
  it('removes the building and broadcasts building_deleted', async () => {
    const created = await (await postJson('/api/buildings', validServerBody)).json();
    const res = await fetch(`${baseUrl}/api/buildings/${created.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);

    expect(broadcasts.some(m => m.type === 'building_deleted' && m.payload.id === created.id)).toBe(true);

    const after = await fetch(`${baseUrl}/api/buildings/${created.id}`);
    expect(after.status).toBe(404);
  });

  it('drops subordinate references from any boss building', async () => {
    const sub = await (await postJson('/api/buildings', validServerBody)).json();
    await postJson('/api/buildings', {
      name: 'Boss',
      type: 'boss',
      position: { x: 0, z: 0 },
      subordinateBuildingIds: [sub.id],
    });

    await fetch(`${baseUrl}/api/buildings/${sub.id}`, { method: 'DELETE' });

    const all = await (await fetch(`${baseUrl}/api/buildings`)).json();
    const boss = all.buildings.find((b: any) => b.type === 'boss');
    expect(boss.subordinateBuildingIds).toEqual([]);
  });
});

describe('POST /api/buildings/:id/command', () => {
  it('rejects unknown commands', async () => {
    const created = await (await postJson('/api/buildings', validServerBody)).json();
    const res = await postJson(`/api/buildings/${created.id}/command`, { command: 'frobulate' });
    expect(res.status).toBe(400);
  });

  it('routes start through to pm2-service for PM2 buildings', async () => {
    const created = await (await postJson('/api/buildings', validServerBody)).json();
    const pm2 = await import('../services/pm2-service.js');

    const res = await postJson(`/api/buildings/${created.id}/command`, { command: 'start' });
    expect(res.status).toBe(200);
    expect(pm2.startProcess).toHaveBeenCalled();
  });
});

describe('POST /api/buildings/boss/:id/command', () => {
  it('rejects unknown boss commands', async () => {
    const sub = await (await postJson('/api/buildings', validServerBody)).json();
    const boss = await (await postJson('/api/buildings', {
      name: 'Boss', type: 'boss', position: { x: 0, z: 0 },
      subordinateBuildingIds: [sub.id],
    })).json();

    const res = await postJson(`/api/buildings/boss/${boss.id}/command`, { command: 'nope' });
    expect(res.status).toBe(400);
  });

  it('propagates start_all to all subordinates', async () => {
    const sub = await (await postJson('/api/buildings', validServerBody)).json();
    const boss = await (await postJson('/api/buildings', {
      name: 'Boss', type: 'boss', position: { x: 0, z: 0 },
      subordinateBuildingIds: [sub.id],
    })).json();

    const pm2 = await import('../services/pm2-service.js');
    vi.mocked(pm2.startProcess).mockClear();

    const res = await postJson(`/api/buildings/boss/${boss.id}/command`, { command: 'start_all' });
    expect(res.status).toBe(200);
    expect(pm2.startProcess).toHaveBeenCalled();
  });
});

describe('POST /api/buildings/:id/subordinates', () => {
  it('rejects when target is not a boss building', async () => {
    const sub = await (await postJson('/api/buildings', validServerBody)).json();
    const res = await postJson(`/api/buildings/${sub.id}/subordinates`, {
      subordinateBuildingIds: [],
    });
    expect(res.status).toBe(400);
  });

  it('rejects dangling subordinate IDs', async () => {
    const sub = await (await postJson('/api/buildings', validServerBody)).json();
    const boss = await (await postJson('/api/buildings', {
      name: 'Boss', type: 'boss', position: { x: 0, z: 0 },
      subordinateBuildingIds: [sub.id],
    })).json();

    const res = await postJson(`/api/buildings/${boss.id}/subordinates`, {
      subordinateBuildingIds: ['ghost_id'],
    });
    expect(res.status).toBe(400);
  });

  it('updates the subordinate list when valid', async () => {
    const sub1 = await (await postJson('/api/buildings', validServerBody)).json();
    const sub2 = await (await postJson('/api/buildings', { ...validServerBody, name: 'B' })).json();
    const boss = await (await postJson('/api/buildings', {
      name: 'Boss', type: 'boss', position: { x: 0, z: 0 },
      subordinateBuildingIds: [sub1.id],
    })).json();

    const res = await postJson(`/api/buildings/${boss.id}/subordinates`, {
      subordinateBuildingIds: [sub1.id, sub2.id],
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.subordinateBuildingIds).toEqual([sub1.id, sub2.id]);
  });
});

describe('GET /api/buildings/:id/logs', () => {
  it('returns PM2 logs for a PM2 building', async () => {
    const created = await (await postJson('/api/buildings', validServerBody)).json();
    const res = await fetch(`${baseUrl}/api/buildings/${created.id}/logs?lines=50`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('pm2');
    expect(body.logs).toContain('pm2 log line');
  });

  it('returns Docker logs for a Docker building', async () => {
    const created = await (await postJson('/api/buildings', {
      name: 'Postgres',
      type: 'docker',
      position: { x: 0, z: 0 },
      docker: { enabled: true, mode: 'existing', containerName: 'postgres18' },
    })).json();

    const res = await fetch(`${baseUrl}/api/buildings/${created.id}/logs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('docker');
    expect(body.logs).toContain('docker log line');
  });

  it('returns source "none" when no logs source is configured', async () => {
    const created = await (await postJson('/api/buildings', {
      name: 'Folder',
      type: 'folder',
      position: { x: 0, z: 0 },
      folderPath: '/tmp',
    })).json();
    const res = await fetch(`${baseUrl}/api/buildings/${created.id}/logs`);
    const body = await res.json();
    expect(body.source).toBe('none');
  });

  it('caps lines at 5000', async () => {
    const created = await (await postJson('/api/buildings', validServerBody)).json();
    const pm2 = await import('../services/pm2-service.js');
    vi.mocked(pm2.getLogs).mockClear();
    await fetch(`${baseUrl}/api/buildings/${created.id}/logs?lines=99999`);
    expect(pm2.getLogs).toHaveBeenCalledWith(expect.anything(), 5000);
  });
});

describe('GET /api/buildings/docker/containers', () => {
  it('lists adoptable containers without colliding with the /:id route', async () => {
    const res = await fetch(`${baseUrl}/api/buildings/docker/containers`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.containers).toHaveLength(1);
    expect(body.containers[0].name).toBe('postgres18');
  });
});
