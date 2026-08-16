/**
 * Live end-to-end test of background-task visibility.
 *
 * Drives a REAL Tide Commander server (and a real Claude CLI agent, spending a
 * couple of small turns): spawns a probe agent, asks it to launch a Bash
 * command with run_in_background, then validates the whole feature chain the
 * UI rail consumes:
 *
 *   1. GET  /api/agents/:id/background-tasks reports the running task,
 *   2. GET  .../background-tasks/:key/output tails the live output file,
 *   3. the background_tasks_update WS push fires (non-empty, then empty),
 *   4. the task disappears once its <task-notification> completes it.
 *
 * Gated behind TC_E2E=1 — a normal `npm test` run skips it (no server, no
 * tokens spent). Run it explicitly with:
 *
 *   TC_E2E=1 npx vitest run src/packages/server/services/background-tasks.e2e.test.ts
 *
 * Config (all optional): TC_E2E_URL (default http://localhost:5174),
 * TC_E2E_TOKEN (default abcd), TC_E2E_CWD (default os.tmpdir()).
 */

import * as os from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { AgentBackgroundTask } from '../../shared/types.js';

const E2E_ENABLED = process.env.TC_E2E === '1';
const BASE_URL = process.env.TC_E2E_URL || 'http://localhost:5174';
const TOKEN = process.env.TC_E2E_TOKEN || 'abcd';
const AGENT_CWD = process.env.TC_E2E_CWD || os.tmpdir();

// The probe command ticks once per second so the output file demonstrably
// grows while the task is alive, then prints a unique completion marker.
const TICK_COUNT = 60;
const PROBE_COMMAND = `for i in $(seq 1 ${TICK_COUNT}); do echo "tick $i"; sleep 1; done; echo BG_E2E_DONE`;

const PROBE_PROMPT = [
  'Eres parte de una prueba automatizada. Sigue estas instrucciones AL PIE DE LA LETRA:',
  '1. Usa el tool Bash EXACTAMENTE una vez, con run_in_background: true,',
  `   command: ${PROBE_COMMAND}`,
  '   y description: "BG E2E probe".',
  '2. No uses ningún otro tool (nada de TodoWrite, Read, etc).',
  '3. NO esperes el resultado del comando: en cuanto el tool devuelva el stub de background, responde exactamente "launched" y termina tu turno.',
  '4. Cuando más tarde recibas la notificación de que el comando terminó, responde exactamente "bg done".',
].join('\n');

interface TasksResponse {
  agentId: string;
  tasks: AgentBackgroundTask[];
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': TOKEN,
      ...(init?.headers || {}),
    },
  });
}

async function getTasks(agentId: string): Promise<AgentBackgroundTask[]> {
  const res = await api(`/api/agents/${agentId}/background-tasks`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as TasksResponse;
  return body.tasks;
}

async function pollUntil<T>(
  label: string,
  timeoutMs: number,
  intervalMs: number,
  probe: () => Promise<T | null>
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe();
    if (result !== null) return result;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe.skipIf(!E2E_ENABLED)('background tasks — live e2e', () => {
  let agentId: string | null = null;
  let ws: WebSocket | null = null;

  afterAll(async () => {
    ws?.close();
    if (agentId) {
      await api(`/api/agents/${agentId}`, { method: 'DELETE' }).catch(() => {});
    }
  });

  it('tracks a real backgrounded Bash command from launch to completion', { timeout: 360_000 }, async () => {
    // --- WS listener: collect background_tasks_update pushes (what the UI rail consumes)
    // NOTE: the main WSS only upgrades on the /ws path — any other path is
    // silently ignored (the socket just hangs), hence the connect timeout.
    const wsUpdates: TasksResponse[] = [];
    const wsUrl = `${BASE_URL.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(TOKEN)}`;
    ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`WS connect timeout: ${wsUrl}`)), 10_000);
      ws!.once('open', () => { clearTimeout(timer); resolve(); });
      ws!.once('error', (err) => { clearTimeout(timer); reject(err); });
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg.type === 'background_tasks_update' && msg.payload?.agentId === agentId) {
          wsUpdates.push(msg.payload as TasksResponse);
        }
      } catch { /* non-JSON frames are irrelevant */ }
    });

    // --- 1. Spawn the probe agent
    const createRes = await api('/api/agents', {
      method: 'POST',
      body: JSON.stringify({ name: 'BG E2E Probe', class: 'claude', cwd: AGENT_CWD }),
    });
    expect(createRes.status).toBe(201);
    const agent = await createRes.json();
    agentId = agent.id as string;
    expect(agentId).toBeTruthy();

    // Fresh agent starts with no background tasks.
    expect(await getTasks(agentId)).toHaveLength(0);

    // --- 2. Ask it to launch the background command
    const msgRes = await api(`/api/agents/${agentId}/message`, {
      method: 'POST',
      body: JSON.stringify({ message: PROBE_PROMPT }),
    });
    expect(msgRes.status).toBe(200);

    // --- 3. The task must appear in the registry (launch stub / task_started)
    const running = await pollUntil('background task to appear', 120_000, 2_000, async () => {
      const tasks = await getTasks(agentId!);
      return tasks.length > 0 ? tasks[0] : null;
    });
    expect(running.toolName).toBe('Bash');
    expect(running.taskId).toBeTruthy();
    expect(running.startedAt).toBeGreaterThan(0);
    // The CLI relays the command we dictated; anchor on its unique marker.
    expect(running.command || '').toContain('BG_E2E_DONE');

    // --- 4. Live output tail: content flows while the task runs
    const firstRead = await pollUntil('output file to have ticks', 60_000, 2_000, async () => {
      const res = await api(`/api/agents/${agentId}/background-tasks/${encodeURIComponent(running.key)}/output?tail=4096`);
      expect(res.status).toBe(200);
      const body = await res.json();
      return body.exists && typeof body.content === 'string' && body.content.includes('tick') ? body : null;
    });
    // ~4s later the file must have kept growing (it ticks once per second).
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    const secondRes = await api(`/api/agents/${agentId}/background-tasks/${encodeURIComponent(running.key)}/output?tail=4096`);
    expect(secondRes.status).toBe(200);
    const secondRead = await secondRes.json();
    expect(secondRead.exists).toBe(true);
    expect(secondRead.size).toBeGreaterThanOrEqual(firstRead.size);
    expect(secondRead.content).toContain('tick');

    // --- 5. Completion: the <task-notification> must clear the registry
    await pollUntil('background task to complete', 220_000, 3_000, async () => {
      const tasks = await getTasks(agentId!);
      return tasks.length === 0 ? true : null;
    });

    // --- 6. The WS push path the UI rail consumes saw both transitions
    expect(wsUpdates.some((u) => u.tasks.length > 0)).toBe(true);
    expect(wsUpdates.some((u) => u.tasks.length === 0)).toBe(true);
  });
});
