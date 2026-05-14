import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

// Mock trigger-service before importing the router so the router resolves the
// stubbed module. Only the receiver-path methods need stubs; the rest of the
// service is irrelevant for these tests.
vi.mock('../services/trigger-service.js', () => ({
  getTrigger: vi.fn(),
  fireTrigger: vi.fn(),
}));

// cron-service is imported but not exercised by the webhook receiver path.
vi.mock('../services/cron-service.js', () => ({
  validate: vi.fn(),
  getNextFireTimes: vi.fn(),
}));

import * as triggerService from '../services/trigger-service.js';
import triggerRoutes from './trigger-routes.js';

// Spin up a minimal Express app once, exercise the receiver via real HTTP.
// This mirrors the production middleware order: webhook-scoped JSON parser
// (with rawBody capture) is mounted before the global parser, and the router
// is mounted at /api/triggers.
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  // Match app.ts exactly for the webhook scope so rawBody is captured. The
  // verify hook is a no-op for these tests (signature paths are off — secret
  // is unset on the fixtures), but mounting the parser is what makes the
  // route able to read req.body.
  app.use(
    '/api/triggers/webhook',
    express.json({
      limit: '10mb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/triggers', triggerRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
});

function makeTrigger(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    name: 'BB PR Reviewer',
    type: 'bitbucket',
    enabled: true,
    config: {},
    matchMode: 'structural',
    promptTemplate: 'Review {{pullrequest.id}}',
    agentId: 'agent-x',
    ...overrides,
  };
}

describe('POST /webhook/:triggerId — accepts type: bitbucket', () => {
  it('routes a Bitbucket trigger through to fireTrigger and returns 200 (was rejected as 400 before Path A)', async () => {
    vi.mocked(triggerService.getTrigger).mockReturnValue(makeTrigger() as never);
    vi.mocked(triggerService.fireTrigger).mockResolvedValue(undefined);

    const res = await fetch(`${baseUrl}/api/triggers/webhook/t1`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Event-Key': 'pullrequest:created',
        'X-Request-UUID': 'req-aaa',
      },
      body: JSON.stringify({
        pullrequest: { id: 42, title: 'Add feature' },
        actor: { nickname: 'mark', uuid: '{abc}' },
        repository: { full_name: 'tide/wind' },
      }),
    });

    expect(res.status).toBe(200);
    expect(triggerService.fireTrigger).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ 'trigger.name': 'BB PR Reviewer' }),
      expect.objectContaining({ rawPayload: expect.any(Object) }),
    );
  });

  it('still routes a legacy type: webhook trigger through (no regression)', async () => {
    vi.mocked(triggerService.getTrigger).mockReturnValue(
      makeTrigger({ type: 'webhook', name: 'Plain Webhook' }) as never,
    );
    vi.mocked(triggerService.fireTrigger).mockResolvedValue(undefined);

    const res = await fetch(`${baseUrl}/api/triggers/webhook/t1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'something' }),
    });

    expect(res.status).toBe(200);
    expect(triggerService.fireTrigger).toHaveBeenCalled();
  });

  it('still rejects non-webhook-receivable trigger types (cron) with 400', async () => {
    vi.mocked(triggerService.getTrigger).mockReturnValue(
      makeTrigger({ type: 'cron', name: 'Daily Job' }) as never,
    );
    vi.mocked(triggerService.fireTrigger).mockResolvedValue(undefined);

    const res = await fetch(`${baseUrl}/api/triggers/webhook/t1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Not a webhook-receivable trigger');
    expect(body.triggerType).toBe('cron');
    expect(triggerService.fireTrigger).not.toHaveBeenCalled();
  });

  it('respects author-loop guard for type: bitbucket — bot-authored events do NOT fire', async () => {
    // Confirms the helper still works type-agnostically; only the event-key
    // and BITBUCKET_BOT_USERNAME env determine guard behavior.
    process.env.BITBUCKET_BOT_USERNAME = 'review-bot';
    vi.mocked(triggerService.getTrigger).mockReturnValue(makeTrigger() as never);
    vi.mocked(triggerService.fireTrigger).mockResolvedValue(undefined);

    try {
      const res = await fetch(`${baseUrl}/api/triggers/webhook/t1`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Event-Key': 'pullrequest:approved',
          'X-Request-UUID': 'req-bbb',
        },
        body: JSON.stringify({ actor: { nickname: 'review-bot' } }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.skipped).toBe('author-loop-guard');
      expect(triggerService.fireTrigger).not.toHaveBeenCalled();
    } finally {
      delete process.env.BITBUCKET_BOT_USERNAME;
    }
  });

  it('respects dedupe for type: bitbucket — retried delivery returns 200 deduped:true and does not re-fire', async () => {
    vi.mocked(triggerService.getTrigger).mockReturnValue(
      makeTrigger({ id: 'dedupe-t' }) as never,
    );
    vi.mocked(triggerService.fireTrigger).mockResolvedValue(undefined);

    const url = `${baseUrl}/api/triggers/webhook/dedupe-t`;
    const headers = {
      'Content-Type': 'application/json',
      'X-Event-Key': 'pullrequest:created',
      'X-Request-UUID': 'shared-uuid-retried',
    };
    const body = JSON.stringify({ pullrequest: { id: 1 } });

    const first = await fetch(url, { method: 'POST', headers, body });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ fired: true });

    const second = await fetch(url, { method: 'POST', headers, body });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ deduped: true });

    expect(triggerService.fireTrigger).toHaveBeenCalledTimes(1);
  });
});
