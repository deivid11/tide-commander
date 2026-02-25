import { describe, expect, it, vi } from 'vitest';
import { checkBackendReachability, validateBackendUrlInput } from './backendConnection';

describe('validateBackendUrlInput', () => {
  it('accepts empty input for auto-detect', () => {
    expect(validateBackendUrlInput('')).toEqual({ ok: true, normalizedUrl: '' });
    expect(validateBackendUrlInput('   ')).toEqual({ ok: true, normalizedUrl: '' });
  });

  it('rejects invalid url format', () => {
    const result = validateBackendUrlInput('not a url');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid URL format');
  });

  it('rejects unsupported protocol', () => {
    const result = validateBackendUrlInput('ws://localhost:5174');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unsupported protocol');
  });

  it('accepts http/https urls', () => {
    expect(validateBackendUrlInput('http://127.0.0.1:5174').ok).toBe(true);
    expect(validateBackendUrlInput('https://example.com').ok).toBe(true);
  });
});

describe('checkBackendReachability', () => {
  it('returns ok for empty input (auto-detect)', async () => {
    const result = await checkBackendReachability('');
    expect(result).toEqual({ ok: true });
  });

  it('returns ok when health endpoint succeeds', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const result = await checkBackendReachability('http://localhost:5174', 500, mockFetch);
    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:5174/api/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns clear error when host is reachable but unhealthy', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    const result = await checkBackendReachability('http://localhost:5174', 500, mockFetch);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('503');
  });

  it('returns clear error for unreachable host', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network Error'));
    const result = await checkBackendReachability('http://192.0.2.1:5174', 500, mockFetch);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Host unreachable');
  });
});
