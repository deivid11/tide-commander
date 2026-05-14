import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import {
  detectWebhookProvider,
  verifyHmacSignature,
  getWebhookHmacPayload,
} from './webhook-signatures.js';

function sign(secret: string, payload: Buffer | string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

describe('detectWebhookProvider', () => {
  it('identifies Bitbucket by X-Event-Key header', () => {
    expect(detectWebhookProvider({ 'x-event-key': 'pullrequest:created' })).toBe('bitbucket');
  });

  it('identifies GitHub by X-GitHub-Event header', () => {
    expect(detectWebhookProvider({ 'x-github-event': 'pull_request' })).toBe('github');
  });

  it('prefers Bitbucket when both headers are somehow present', () => {
    // Sanity: an attacker forging both wins as Bitbucket. Either way the
    // signature path will fail since they're hashed identically.
    expect(detectWebhookProvider({
      'x-event-key': 'pullrequest:created',
      'x-github-event': 'pull_request',
    })).toBe('bitbucket');
  });

  it('returns null when neither identifying header is present', () => {
    expect(detectWebhookProvider({})).toBeNull();
    expect(detectWebhookProvider({ 'x-webhook-secret': 'abc' })).toBeNull();
  });
});

describe('verifyHmacSignature', () => {
  const secret = 's3cr3t';
  const payload = JSON.stringify({ event: 'pullrequest:created', actor: { nickname: 'mark' } });

  it('accepts a correctly-signed string payload', () => {
    const sig = sign(secret, payload);
    expect(verifyHmacSignature(secret, sig, payload)).toBe(true);
  });

  it('accepts a correctly-signed Buffer payload (raw request bytes)', () => {
    const buf = Buffer.from(payload, 'utf-8');
    const sig = sign(secret, buf);
    expect(verifyHmacSignature(secret, sig, buf)).toBe(true);
  });

  it('produces the same digest from a Buffer and an equivalent string', () => {
    // Identical bytes => identical HMAC, regardless of input type. This is
    // the core property that makes the rawBody fix safe: the provider signs
    // bytes; we hash bytes; they match exactly.
    const buf = Buffer.from(payload, 'utf-8');
    const sigFromString = sign(secret, payload);
    const sigFromBuffer = sign(secret, buf);
    expect(sigFromString).toBe(sigFromBuffer);
    expect(verifyHmacSignature(secret, sigFromString, buf)).toBe(true);
    expect(verifyHmacSignature(secret, sigFromBuffer, payload)).toBe(true);
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const sig = sign(secret, payload);
    expect(verifyHmacSignature(secret, sig, payload + ' extra')).toBe(false);
  });

  it('rejects a signature computed with a different secret', () => {
    const sig = sign('wrong-secret', payload);
    expect(verifyHmacSignature(secret, sig, payload)).toBe(false);
  });

  it('rejects a signature with mismatched length without throwing', () => {
    // timingSafeEqual throws on length mismatch — verifyHmacSignature must guard.
    expect(verifyHmacSignature(secret, 'sha256=tooshort', payload)).toBe(false);
    expect(verifyHmacSignature(secret, '', payload)).toBe(false);
  });

  it('rejects a signature missing the sha256= prefix', () => {
    const sig = sign(secret, payload).replace(/^sha256=/, '');
    expect(verifyHmacSignature(secret, sig, payload)).toBe(false);
  });

  it('catches the JSON.stringify reordering risk: signing canonical bytes still verifies even when re-stringified body has different key order', () => {
    // Provider sends bytes with keys in this exact order:
    const providerBytes = Buffer.from('{"b":2,"a":1}', 'utf-8');
    const sig = sign(secret, providerBytes);

    // verifyHmacSignature against the raw bytes => MATCH.
    expect(verifyHmacSignature(secret, sig, providerBytes)).toBe(true);

    // But against a re-stringified version with reordered keys => MISMATCH.
    // This is exactly the failure mode the rawBody capture prevents.
    const reordered = JSON.stringify({ a: 1, b: 2 }); // -> '{"a":1,"b":2}'
    expect(verifyHmacSignature(secret, sig, reordered)).toBe(false);
  });
});

describe('getWebhookHmacPayload', () => {
  it('returns the raw buffer when present, marking usedFallback=false', () => {
    const buf = Buffer.from('{"x":1}', 'utf-8');
    const result = getWebhookHmacPayload({ rawBody: buf, body: { x: 1 } });
    expect(result.payload).toBe(buf);
    expect(result.usedFallback).toBe(false);
  });

  it('falls back to JSON.stringify(req.body) and marks usedFallback=true when rawBody is missing', () => {
    const result = getWebhookHmacPayload({ body: { x: 1 } });
    expect(result.payload).toBe('{"x":1}');
    expect(result.usedFallback).toBe(true);
  });

  it('falls back when rawBody is an empty buffer (treats as absent)', () => {
    const result = getWebhookHmacPayload({ rawBody: Buffer.alloc(0), body: { x: 1 } });
    expect(result.usedFallback).toBe(true);
    expect(result.payload).toBe('{"x":1}');
  });

  it('falls back when rawBody is set to a non-Buffer (defensive — any caller that mis-types it)', () => {
    const result = getWebhookHmacPayload({
      rawBody: 'oops-a-string' as unknown as Buffer,
      body: { x: 1 },
    });
    expect(result.usedFallback).toBe(true);
    expect(result.payload).toBe('{"x":1}');
  });

  it('produces "{}" fallback when both rawBody and body are missing', () => {
    const result = getWebhookHmacPayload({});
    expect(result.payload).toBe('{}');
    expect(result.usedFallback).toBe(true);
  });

  it('end-to-end: rawBody from middleware verifies the same signature the provider sent', () => {
    // Simulates the express.json verify hook stashing buf on req.
    const secret = 's3cr3t';
    const providerBytes = Buffer.from('{"event":"pullrequest:created","keep":"order"}', 'utf-8');
    const providerSig = sign(secret, providerBytes);

    // Express has parsed the body — but rawBody preserved by verify hook:
    const req = {
      rawBody: providerBytes,
      body: { event: 'pullrequest:created', keep: 'order' },
    };
    const { payload, usedFallback } = getWebhookHmacPayload(req);
    expect(usedFallback).toBe(false);
    expect(verifyHmacSignature(secret, providerSig, payload)).toBe(true);
  });
});
