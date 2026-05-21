/**
 * Webhook signature verification for incoming HMAC-SHA256 webhooks.
 *
 * Detects provider by header presence:
 *   - GitHub-style:    `X-GitHub-Event`                 + `X-Hub-Signature-256`
 *   - Bitbucket Cloud: `X-Event-Key`                    + `X-Hub-Signature`
 *   - Jira (Cloud signed / Server signed plugins):
 *                      `X-Atlassian-Webhook-Identifier` + `X-Hub-Signature`
 *
 * All providers use the same algorithm (HMAC-SHA256, hex-encoded, with the
 * `sha256=` prefix); only the header name differs. The trigger's per-instance
 * secret is reused across all — the trigger config doesn't distinguish.
 *
 * Jira Cloud's classic admin webhooks don't sign payloads. For that case the
 * caller falls back to a `?secret=<shared>` query-string check rather than
 * HMAC; the helpers here cover the signed paths only.
 *
 * Body source: HMAC is computed over the *raw* request bytes captured by the
 * scoped `express.json({ verify })` middleware in app.ts. Re-serializing via
 * `JSON.stringify(req.body)` can change key ordering / whitespace and produce
 * a different digest, so the receiver must hash exactly what the provider
 * signed. `getWebhookHmacPayload` falls back to `JSON.stringify` only when
 * the raw buffer is missing (e.g. unit tests that bypass middleware) — the
 * caller logs a warning in that case.
 */

import * as crypto from 'crypto';

export type WebhookProvider = 'github' | 'bitbucket' | 'jira' | null;

export const GITHUB_SIGNATURE_HEADER = 'x-hub-signature-256';
export const BITBUCKET_SIGNATURE_HEADER = 'x-hub-signature';
export const JIRA_SIGNATURE_HEADER = 'x-hub-signature';
export const GITHUB_EVENT_HEADER = 'x-github-event';
export const BITBUCKET_EVENT_HEADER = 'x-event-key';
export const JIRA_WEBHOOK_ID_HEADER = 'x-atlassian-webhook-identifier';

/**
 * Detect provider by identifying header. Bitbucket sends `X-Event-Key`,
 * GitHub sends `X-GitHub-Event`, Jira sends `X-Atlassian-Webhook-Identifier`.
 * Headers arrive lowercased via Node's normalization. Bitbucket wins over
 * Jira when both are somehow present (Jira-from-Bitbucket is implausible;
 * either way the HMAC step still gates dispatch). Returns null when no
 * identifying header is present.
 */
export function detectWebhookProvider(headers: Record<string, unknown>): WebhookProvider {
  if (headers[BITBUCKET_EVENT_HEADER]) return 'bitbucket';
  if (headers[GITHUB_EVENT_HEADER]) return 'github';
  if (headers[JIRA_WEBHOOK_ID_HEADER]) return 'jira';
  return null;
}

/**
 * Constant-time HMAC-SHA256 verification with `sha256=<hex>` prefix.
 * Returns false on any length mismatch — `timingSafeEqual` throws on
 * mismatched buffer lengths, so we guard up front.
 *
 * `payload` may be a Buffer (preferred — the raw request bytes) or a string.
 * `crypto.Hmac.update` accepts both natively.
 */
export function verifyHmacSignature(
  secret: string,
  signatureHeader: string,
  payload: Buffer | string,
): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const expected = `sha256=${hmac.digest('hex')}`;
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Picks the bytes to feed into `verifyHmacSignature` from an Express request,
 * preferring the raw buffer captured by the webhook-scoped JSON parser. Falls
 * back to `JSON.stringify(req.body)` only when the raw buffer is absent — the
 * caller is expected to log a warning in that case, since the fallback can
 * silently mismatch a valid Bitbucket/GitHub signature on key reordering.
 */
export function getWebhookHmacPayload(
  req: { rawBody?: Buffer; body?: unknown },
): { payload: Buffer | string; usedFallback: boolean } {
  if (req.rawBody && Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0) {
    return { payload: req.rawBody, usedFallback: false };
  }
  return { payload: JSON.stringify(req.body ?? {}), usedFallback: true };
}
