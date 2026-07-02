/**
 * Test Runner API client
 *
 * Thin wrappers over /api/tests/* used by the file explorer's "Run Tests"
 * action and the results modal.
 */

import { apiUrl, authFetch } from '../utils/storage';
import type { DetectRunnerResult, TestRunnerType, TestRunSummary, StoredTestRun } from '../../shared/types';

export interface StartTestRunResponse {
  success: boolean;
  runId: string;
  runnerType: TestRunnerType;
  moduleRoot: string;
  command: string;
  label: string;
  targetPath: string;
}

/** Ask the server whether a folder can run tests. */
export async function detectRunner(path: string): Promise<DetectRunnerResult> {
  const res = await authFetch(apiUrl('/api/tests/detect'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) return { testable: false };
  return (await res.json()) as DetectRunnerResult;
}

/**
 * Start a test run for a folder or file. Resolves as soon as the run is spawned
 * with the runId; output and results arrive over WebSocket (test_run_* messages).
 * `testFilter` (optional, Maven `-Dtest=` syntax) scopes the run to specific
 * tests — used to re-run just the failed/errored ones. Throws with the server
 * error message on failure.
 */
export async function startTestRun(path: string, testFilter?: string): Promise<StartTestRunResponse> {
  const res = await authFetch(apiUrl('/api/tests/run'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testFilter ? { path, testFilter } : { path }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Failed to start test run');
  }
  return data as StartTestRunResponse;
}

/** List recent finished runs (newest first, no per-test detail). */
export async function fetchTestHistory(limit = 50): Promise<TestRunSummary[]> {
  const res = await authFetch(apiUrl(`/api/tests/history?limit=${limit}`));
  if (!res.ok) return [];
  const data = (await res.json()) as { runs?: TestRunSummary[] };
  return data.runs ?? [];
}

/** Fetch a single stored run (full detail) by id. */
export async function fetchTestRun(runId: string): Promise<StoredTestRun | null> {
  const res = await authFetch(apiUrl(`/api/tests/runs/${runId}`));
  if (!res.ok) return null;
  return (await res.json()) as StoredTestRun;
}

/** Stop a running test process. */
export async function stopTestRun(runId: string): Promise<boolean> {
  try {
    const res = await authFetch(apiUrl(`/api/tests/runs/${runId}`), { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}
