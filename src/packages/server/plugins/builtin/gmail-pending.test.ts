import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { EmailMessage } from '../../integrations/gmail/gmail-config.js';

vi.mock('../../integrations/gmail/gmail-client.js', () => ({
  getStatus: vi.fn(),
  getRecentMessages: vi.fn(),
  markMessageAsRead: vi.fn(),
}));

import * as gmailClient from '../../integrations/gmail/gmail-client.js';
import { PluginManager } from '../manager.js';
import { gmailPendingPlugin } from './gmail-pending.js';

let testRoot: string;

const unreadMessage: EmailMessage = {
  messageId: '18fabc123',
  threadId: '18fthread456',
  from: 'Ada Lovelace <ada@example.com>',
  to: ['Juanito <juanito@example.com>'],
  subject: 'Pending review',
  body: 'Please review the attached proposal.',
  date: Date.parse('2026-08-20T15:30:00Z'),
  labels: ['INBOX', 'UNREAD'],
  hasAttachments: true,
  attachmentNames: ['proposal.pdf'],
};

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gmail-plugin-'));
  vi.mocked(gmailClient.getStatus).mockReturnValue({
    configured: true,
    connected: true,
    authenticated: true,
    emailAddress: 'juanito@example.com',
    pollingActive: true,
    lastChecked: Date.now(),
  });
  vi.mocked(gmailClient.getRecentMessages).mockResolvedValue([unreadMessage]);
  vi.mocked(gmailClient.markMessageAsRead).mockResolvedValue(undefined);
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

function makeManager(): PluginManager {
  return new PluginManager({
    dataDir: path.join(testRoot, 'state'),
    builtins: [gmailPendingPlugin],
  });
}

describe('builtin Gmail Pending plugin', () => {
  it('renders unread inbox messages through /gmail with an optional limit', async () => {
    const manager = makeManager();
    await manager.initialize();

    const output = await manager.executeSlashCommand('agent-1', '/gmail 25');

    expect(gmailClient.getRecentMessages).toHaveBeenCalledWith({
      query: 'in:inbox is:unread',
      maxResults: 25,
    });
    expect(output).toMatchObject({
      pluginId: 'gmail-pending',
      rendererId: 'gmail-pending-list',
      data: {
        kind: 'gmail-pending-list',
        title: 'Correos pendientes',
        account: 'juanito@example.com',
        count: 1,
        limit: 25,
        mode: 'unread',
        query: 'in:inbox is:unread',
        items: [{
          id: '18fabc123',
          threadId: '18fthread456',
          from: 'Ada Lovelace <ada@example.com>',
          subject: 'Pending review',
          body: 'Please review the attached proposal.',
          isUnread: true,
          gmailUrl: 'https://mail.google.com/mail/u/0/#inbox/18fthread456',
        }],
        actions: {
          markRead: 'mark-read',
          refresh: 'refresh',
          showAll: 'show-all',
          showUnread: 'show-unread',
        },
      },
    });
    await manager.shutdown();
  });

  it('removes template indentation and excessive blank lines from displayed bodies', async () => {
    vi.mocked(gmailClient.getRecentMessages).mockResolvedValue([{
      ...unreadMessage,
      body: '\r\n      Hola,     equipo.\r\n   \r\n\r\n\r\n        Este correo tiene    espacios de plantilla.\u00a0  \r\n\r\n',
    }]);
    const manager = makeManager();
    await manager.initialize();

    const output = await manager.executeSlashCommand('agent-1', '/gmail');

    expect(output.data).toMatchObject({
      items: [{
        body: 'Hola, equipo.\n\nEste correo tiene espacios de plantilla.',
      }],
    });
    await manager.shutdown();
  });

  it('shows read and unread Inbox messages with /gmail all', async () => {
    const readMessage = {
      ...unreadMessage,
      messageId: '18fread789',
      labels: ['INBOX'],
    };
    vi.mocked(gmailClient.getRecentMessages).mockResolvedValue([unreadMessage, readMessage]);
    const manager = makeManager();
    await manager.initialize();

    const output = await manager.executeSlashCommand('agent-1', '/gmail all 20');

    expect(gmailClient.getRecentMessages).toHaveBeenCalledWith({
      query: 'in:inbox',
      maxResults: 20,
    });
    expect(output.data).toMatchObject({
      title: 'Todos los correos',
      mode: 'all',
      count: 2,
      items: [{ isUnread: true }, { id: '18fread789', isUnread: false }],
    });
    await manager.shutdown();
  });

  it('uses all-mail mode through the discoverable /gmail-all alias', async () => {
    const manager = makeManager();
    await manager.initialize();

    const output = await manager.executeSlashCommand('agent-1', '/gmail-all 5');

    expect(gmailClient.getRecentMessages).toHaveBeenCalledWith({ query: 'in:inbox', maxResults: 5 });
    expect(output.data).toMatchObject({ mode: 'all', limit: 5 });
    await manager.shutdown();
  });

  it('marks one message as read and refreshes the existing result', async () => {
    vi.mocked(gmailClient.getRecentMessages)
      .mockResolvedValueOnce([unreadMessage])
      .mockResolvedValueOnce([]);
    const manager = makeManager();
    await manager.initialize();

    const initial = await manager.executeSlashCommand('agent-1', '/gmail 20');
    const updated = await manager.executeAction('gmail-pending', 'mark-read', {
      instanceId: initial.instanceId,
      rendererId: initial.rendererId,
      itemId: unreadMessage.messageId,
      data: initial.data,
    });

    expect(gmailClient.markMessageAsRead).toHaveBeenCalledWith('18fabc123');
    expect(updated.instanceId).toBe(initial.instanceId);
    expect(updated.data).toMatchObject({ count: 0, limit: 20, mode: 'unread', items: [] });
    await manager.shutdown();
  });

  it('explains how to connect Gmail when the integration is unavailable', async () => {
    vi.mocked(gmailClient.getStatus).mockReturnValue({
      configured: false,
      connected: false,
      authenticated: false,
      pollingActive: false,
      lastChecked: Date.now(),
    });
    const manager = makeManager();
    await manager.initialize();

    await expect(manager.executeSlashCommand('agent-1', '/gmail'))
      .rejects.toThrow('configure it in Settings');
    expect(gmailClient.getRecentMessages).not.toHaveBeenCalled();
    await manager.shutdown();
  });

  it('rejects invalid limits and message ids', async () => {
    const manager = makeManager();
    await manager.initialize();

    await expect(manager.executeSlashCommand('agent-1', '/gmail 100'))
      .rejects.toThrow('between 1 and 50');
    await expect(manager.executeSlashCommand('agent-1', '/gmail all unread 10'))
      .rejects.toThrow('Usage: /gmail');
    await expect(manager.executeAction('gmail-pending', 'mark-read', { itemId: '../bad' }))
      .rejects.toThrow('valid message id');
    expect(gmailClient.markMessageAsRead).not.toHaveBeenCalled();
    await manager.shutdown();
  });
});
