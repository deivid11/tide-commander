/**
 * HTTP Request Tests API client
 *
 * Thin wrappers over /api/http-requests/* used by the http-building browser
 * (IntelliJ-style .http file runner).
 */

import { apiUrl, authFetch } from '../utils/storage';
import type { HttpRequestsScanResult, HttpRunRequestBody, HttpRunResult, HttpRunSummary, StoredHttpRun } from '../../shared/types';

/** Parse every .http/.rest file under a folder. Throws with the server message on failure. */
export async function scanHttpRequests(path: string): Promise<HttpRequestsScanResult> {
  const res = await authFetch(apiUrl('/api/http-requests/scan'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Failed to scan .http files');
  }
  return data as HttpRequestsScanResult;
}

/**
 * Execute one request from a .http file; resolves when the response (or the
 * transport error) is in. Throws only on API-level failures (bad path, ...).
 */
export async function runHttpRequest(body: HttpRunRequestBody): Promise<HttpRunResult> {
  const res = await authFetch(apiUrl('/api/http-requests/run'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Failed to run request');
  }
  return data as HttpRunResult;
}

/** Recent executed requests for a folder (newest first, summaries only). */
export async function fetchHttpHistory(folder: string, limit = 50): Promise<HttpRunSummary[]> {
  const res = await authFetch(
    apiUrl(`/api/http-requests/history?folder=${encodeURIComponent(folder)}&limit=${limit}`),
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { runs?: HttpRunSummary[] };
  return data.runs ?? [];
}

/** Full stored run (request + response detail) by id. */
export async function fetchHttpRun(runId: string): Promise<StoredHttpRun | null> {
  const res = await authFetch(apiUrl(`/api/http-requests/runs/${runId}`));
  if (!res.ok) return null;
  return (await res.json()) as StoredHttpRun;
}
