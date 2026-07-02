/**
 * Test Runner Routes
 * REST API for detecting test projects and running their suites.
 *
 * Console output is streamed to clients over WebSocket (test_run_* messages);
 * parsed results are delivered on the completed message and via GET.
 */

import { Router, Request, Response } from 'express';
import { testRunnerService } from '../services/index.js';
import { createLogger, generateId } from '../utils/index.js';
import { saveTestRun, loadTestRun, loadTestRunSummaries } from '../data/index.js';
import type { ServerMessage, TestRunResult, StoredTestRun } from '../../shared/types.js';

const log = createLogger('TestsRoute');

const router = Router();

// Store for broadcasting via WebSocket (wired from the websocket handler).
let broadcastFn: ((message: ServerMessage) => void) | null = null;
export function setBroadcast(fn: (message: ServerMessage) => void): void {
  broadcastFn = fn;
}
function broadcast(message: ServerMessage): void {
  broadcastFn?.(message);
}

// Hot in-memory cache of recently-finished runs (disk is the source of truth).
const finishedRuns = new Map<string, StoredTestRun>();
function rememberRun(run: StoredTestRun): void {
  finishedRuns.set(run.runId, run);
  if (finishedRuns.size > 50) {
    const oldest = finishedRuns.keys().next().value;
    if (oldest) finishedRuns.delete(oldest);
  }
  saveTestRun(run); // persist so runs survive restarts + power the history list
}

/**
 * POST /api/tests/detect - Report whether a folder can run tests.
 * Body: { path: string }
 */
router.post('/detect', (req: Request, res: Response) => {
  const { path: targetPath } = req.body as { path?: string };
  if (!targetPath) {
    res.status(400).json({ error: 'Missing required field: path' });
    return;
  }
  res.json(testRunnerService.detectRunner(targetPath));
});

/**
 * POST /api/tests/run - Run the tests for a folder or file.
 * Body: { path: string, testFilter?: string }
 * `testFilter` (optional) scopes the run to specific tests (Maven `-Dtest=`
 * syntax, e.g. `ClassA#m1+m2,ClassB`) — used to re-run just failed/errored tests.
 * Responds immediately with the runId; output streams over WebSocket and the
 * parsed result arrives on the test_run_completed message.
 */
router.post('/run', (req: Request, res: Response) => {
  const { path: targetPath, testFilter: rawFilter, agentId } = req.body as {
    path?: string;
    testFilter?: string;
    agentId?: string;
  };
  if (!targetPath) {
    res.status(400).json({ error: 'Missing required field: path' });
    return;
  }

  const detection = testRunnerService.detectRunner(targetPath);
  if (!detection.testable || !detection.moduleRoot || !detection.runnerType) {
    res.status(400).json({ error: 'This folder does not contain a runnable test project.' });
    return;
  }

  if (!testRunnerService.isSafeModuleRoot(detection.moduleRoot)) {
    res.status(400).json({ error: 'Refusing to run tests outside your home directory.' });
    return;
  }

  const runId = generateId();
  const { moduleRoot, runnerType, label = '' } = detection;
  // An explicit body filter (re-run subset) overrides the path-derived one.
  // Restricted to the safe surefire `-Dtest` charset; it becomes a single argv
  // element (spawn is shell-less), so this only guards against odd input.
  const explicitFilter =
    rawFilter && /^[\w#+,.$*-]+$/.test(rawFilter) ? rawFilter : undefined;
  const testFilter = explicitFilter ?? detection.testFilter;
  const command = testFilter ? `mvn test -Dtest=${testFilter}` : detection.command ?? 'mvn test';

  const startAgentId = typeof agentId === 'string' && agentId ? agentId : undefined;

  // Broadcast + respond immediately so the UI can open the results panel.
  broadcast({
    type: 'test_run_started',
    payload: { runId, runnerType, moduleRoot, command, label, targetPath, agentId: startAgentId },
  } as ServerMessage);
  res.status(200).json({ success: true, runId, runnerType, moduleRoot, command, label, targetPath });

  try {
    testRunnerService.startMavenRun(
      runId,
      moduleRoot,
      {
      onOutput: (output, isError) => {
        broadcast({ type: 'test_run_output', payload: { runId, output, isError, agentId: startAgentId } } as ServerMessage);
      },
      onProgress: (result) => {
        broadcast({ type: 'test_run_progress', payload: { runId, result } } as ServerMessage);
      },
      onComplete: ({ status, exitCode, result, error }) => {
        log.log(
          `[${runId}] done status=${status} tests=${result.totals.tests} ` +
            `failures=${result.totals.failures} errors=${result.totals.errors}`,
        );
        rememberRun({ runId, status, exitCode, result, targetPath, moduleRoot, runnerType, command, error, finishedAt: Date.now(), agentId: startAgentId });
        broadcast({
          type: 'test_run_completed',
          payload: { runId, status, exitCode, result, error, agentId: startAgentId },
        } as ServerMessage);
      },
      },
      { testFilter },
    );
  } catch (err: any) {
    const message = err?.message || 'Failed to start test run';
    log.error(`[${runId}] ${message}`);
    const emptyResult: TestRunResult = {
      totals: { suites: 0, tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0, time: 0 },
      suites: [],
    };
    rememberRun({
      runId,
      status: 'error',
      exitCode: null,
      result: emptyResult,
      targetPath,
      moduleRoot,
      runnerType,
      command,
      error: message,
      finishedAt: Date.now(),
      agentId: startAgentId,
    });
    broadcast({
      type: 'test_run_completed',
      payload: { runId, status: 'error', exitCode: null, result: emptyResult, error: message },
    } as ServerMessage);
  }
});

/**
 * GET /api/tests/history - List recent finished runs (newest first, no per-test
 * detail). Query: ?limit=N (default 50, max 200).
 */
router.get('/history', (req: Request, res: Response) => {
  const raw = parseInt(req.query.limit as string, 10);
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 200) : 50;
  res.json({ runs: loadTestRunSummaries(limit) });
});

/**
 * GET /api/tests/runs/:runId - Fetch the stored result of a finished run.
 * Reads the in-memory cache first, then falls back to disk (survives restarts).
 */
router.get('/runs/:runId', (req: Request, res: Response) => {
  const runId = req.params.runId as string;
  const run = finishedRuns.get(runId) ?? loadTestRun(runId);
  if (!run) {
    res.status(404).json({ error: 'Run not found', active: testRunnerService.isRunActive(runId) });
    return;
  }
  res.json(run);
});

/**
 * DELETE /api/tests/runs/:runId - Stop a running test process.
 */
router.delete('/runs/:runId', (req: Request, res: Response) => {
  const killed = testRunnerService.killRun(req.params.runId as string);
  if (killed) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Run not active' });
  }
});

export default router;
