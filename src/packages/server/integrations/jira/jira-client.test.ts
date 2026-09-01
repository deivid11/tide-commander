import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationContext } from '../../../shared/integration-types.js';
import { JiraClient } from './jira-client.js';

describe('JiraClient request comments', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the JSM endpoint and preserves customer visibility', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'comment-42', public: false }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new JiraClient({} as IntegrationContext);
    client.configure('https://jira.example.test/', 'bot@example.test', 'secret');

    await expect(client.addRequestComment('OSPEI-2902', 'Nota interna', false)).resolves.toEqual({
      id: 'comment-42',
      public: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://jira.example.test/rest/servicedeskapi/request/OSPEI-2902/comment',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ body: 'Nota interna', public: false }),
      })
    );
  });

  it('uploads JSM temporary files and links them to a public customer comment', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ issueKey: 'OSPEI-2902', serviceDeskId: '17' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            temporaryAttachments: [
              { temporaryAttachmentId: 'temp-9', fileName: 'package.json' },
            ],
          }),
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            comment: { id: 'comment-88', public: true },
            attachments: [{ id: 'att-9', filename: 'package.json', size: 10 }],
          }),
          { status: 201 }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new JiraClient({} as IntegrationContext);
    client.configure('https://jira.example.test', 'bot@example.test', 'secret');
    const fixture = `${process.cwd()}/package.json`;

    await expect(
      client.addRequestCommentWithAttachments('OSPEI-2902', 'Evidencia adjunta', true, [fixture])
    ).resolves.toMatchObject({ id: 'comment-88', public: true });
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      '/rest/servicedeskapi/servicedesk/17/attachTemporaryFile'
    );
    expect(fetchMock.mock.calls[2]?.[0]).toContain(
      '/rest/servicedeskapi/request/OSPEI-2902/attachment'
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      temporaryAttachmentIds: ['temp-9'],
      additionalComment: { body: 'Evidencia adjunta' },
      public: true,
    });
  });

  it('maps author identity and proxies an external avatar without forwarding Jira auth', async () => {
    const avatar = new Uint8Array([137, 80, 78, 71]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            comments: [
              {
                id: '30364',
                author: {
                  displayName: 'César Beltrán',
                  accountId: 'account-7',
                  avatarUrls: { '48x48': 'https://avatar-cdn.example.test/cesar.png' },
                },
                body: { type: 'doc', content: [] },
                created: '2026-08-31T06:38:19.377Z',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(avatar, { status: 200, headers: { 'content-type': 'image/png' } })
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new JiraClient({} as IntegrationContext);
    client.configure('https://jira.example.test', 'bot@example.test', 'secret');

    await expect(client.fetchCommentAvatar('OSPEI-2902', '30364')).resolves.toMatchObject({
      contentType: 'image/png',
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { Accept: 'image/*' },
    });
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).not.toHaveProperty('Authorization');
  });
});
