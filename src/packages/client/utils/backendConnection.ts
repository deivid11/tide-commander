export interface BackendValidationResult {
  ok: boolean;
  normalizedUrl: string;
  error?: string;
}

export interface BackendReachabilityResult {
  ok: boolean;
  error?: string;
}

/**
 * Validate backend URL input from user settings.
 * Empty string is valid and means auto-detect.
 */
export function validateBackendUrlInput(input: string): BackendValidationResult {
  const normalizedUrl = input.trim();
  if (!normalizedUrl) {
    return { ok: true, normalizedUrl: '' };
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return {
      ok: false,
      normalizedUrl: '',
      error: 'Invalid URL format. Use http://host:port',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      normalizedUrl: '',
      error: 'Unsupported protocol. Use http or https',
    };
  }

  return { ok: true, normalizedUrl };
}

/**
 * Reachability check for configured backend host.
 * Uses /api/health and a timeout to provide fast feedback before reconnect.
 */
export async function checkBackendReachability(
  normalizedUrl: string,
  timeoutMs: number = 5000,
  fetchImpl: typeof fetch = fetch,
): Promise<BackendReachabilityResult> {
  // Empty host means auto-detect mode. Let WebSocket connect flow decide.
  if (!normalizedUrl) {
    return { ok: true };
  }

  const baseUrl = normalizedUrl.replace(/\/$/, '');
  const healthUrl = `${baseUrl}/api/health`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(healthUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, error: `Host reachable but unhealthy (${response.status})` };
    }

    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: 'Connection timed out while checking host' };
    }
    return { ok: false, error: 'Host unreachable. Check URL, host, and port' };
  } finally {
    clearTimeout(timeout);
  }
}
