import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import slackRoutes from './slack-routes.js';
import { SlackInstance, clearInstances, getInstance } from './slack-instance.js';

describe('Slack message deletion', () => {
  it('deletes through chat.delete and returns the deleted message identity', async () => {
    const slackDelete = vi.fn().mockResolvedValue({ ok: true, channel: 'C123', ts: '123.456' });
    const instance = new SlackInstance('test');
    (instance as unknown as { webClient: { chat: { delete: typeof slackDelete } } }).webClient = {
      chat: { delete: slackDelete },
    };

    await expect(instance.deleteMessage({ channel: 'C123', ts: '123.456' })).resolves.toEqual({
      channel: 'C123',
      ts: '123.456',
    });
    expect(slackDelete).toHaveBeenCalledWith({ channel: 'C123', ts: '123.456' });
  });

  it('rejects deletion while Slack is disconnected', async () => {
    const instance = new SlackInstance('test');
    await expect(instance.deleteMessage({ channel: 'C123', ts: '123.456' })).rejects.toThrow(
      'Slack not connected',
    );
  });
});

describe('DELETE /api/slack/messages', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/slack', slackRoutes);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    clearInstances();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('deletes through the selected Slack instance', async () => {
    const deleteMessage = vi.spyOn(getInstance(), 'deleteMessage').mockResolvedValue({
      channel: 'C123',
      ts: '123.456',
    });

    const response = await fetch(`${baseUrl}/api/slack/messages`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'C123', ts: '123.456' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      channel: 'C123',
      ts: '123.456',
      instanceId: 'default',
    });
    expect(deleteMessage).toHaveBeenCalledWith({ channel: 'C123', ts: '123.456' });
  });

  it('requires both the channel and message timestamp', async () => {
    const response = await fetch(`${baseUrl}/api/slack/messages`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'C123' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'channel and ts are required' });
  });
});
