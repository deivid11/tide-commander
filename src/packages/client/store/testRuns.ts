/**
 * Test Runs Store Module
 *
 * State for streaming "Run Tests" executions started via /api/tests/run.
 * Console output streams over WebSocket (test_run_* messages) and the parsed
 * result tree arrives on completion. Keyed by runId.
 */

import type { TestRunResult, TestRunStatus, TestRunnerType } from '../../shared/types';
import type { StoreState, TestRun } from './types';

const MAX_OUTPUT_LINES = 2000;

export interface TestRunSeed {
  runId: string;
  runnerType: TestRunnerType;
  moduleRoot: string;
  targetPath: string;
  command: string;
  label: string;
  agentId?: string;
}

export interface TestRunActions {
  // Lifecycle (idempotent upserts so the initiating POST response and the
  // broadcast test_run_started can both seed without clobbering output).
  handleTestRunStarted(seed: TestRunSeed): void;
  handleTestRunOutput(runId: string, output: string, isError?: boolean, agentId?: string): void;
  handleTestRunProgress(runId: string, result: TestRunResult): void;
  handleTestRunCompleted(
    runId: string,
    status: TestRunStatus,
    exitCode: number | null,
    result: TestRunResult,
    error?: string,
    agentId?: string,
  ): void;

  // Getters
  getTestRun(runId: string): TestRun | undefined;

  // Control
  stopTestRun(runId: string): Promise<boolean>;
  removeTestRun(runId: string): void;
}

export function createTestRunActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void,
): TestRunActions {
  const ensureMap = (state: StoreState): Map<string, TestRun> => {
    if (!state.testRuns) state.testRuns = new Map();
    return state.testRuns;
  };

  return {
    handleTestRunStarted(seed: TestRunSeed): void {
      setState((state) => {
        const runs = ensureMap(state);
        const existing = runs.get(seed.runId);
        if (existing) {
          // Preserve any output already streamed before we seeded.
          runs.set(seed.runId, { ...existing, ...seed });
        } else {
          runs.set(seed.runId, {
            ...seed,
            status: 'running',
            output: [],
            startedAt: Date.now(),
          });
        }
        state.latestTestRunId = seed.runId;
      });
      notify();
    },

    handleTestRunProgress(runId: string, result: TestRunResult): void {
      setState((state) => {
        const run = state.testRuns?.get(runId);
        // Only apply partial results while still running; ignore once completed.
        if (!run || run.status !== 'running') return;
        state.testRuns!.set(runId, { ...run, result });
      });
      notify();
    },

    handleTestRunOutput(runId: string, output: string, isError?: boolean, agentId?: string): void {
      setState((state) => {
        const runs = ensureMap(state);
        const run = runs.get(runId);
        // Tolerate output arriving before the started seed.
        const base: TestRun =
          run ??
          ({
            runId,
            runnerType: 'maven',
            moduleRoot: '',
            targetPath: '',
            command: '',
            label: '',
            status: 'running',
            output: [],
            startedAt: Date.now(),
          } as TestRun);

        const newOutput = [...base.output];
        for (const line of output.split('\n')) {
          if (line.length > 0) newOutput.push(isError ? `[stderr] ${line}` : line);
        }
        if (newOutput.length > MAX_OUTPUT_LINES) {
          newOutput.splice(0, newOutput.length - MAX_OUTPUT_LINES);
        }
        // Backfill agentId so a client that loaded mid-run can still associate it.
        runs.set(runId, { ...base, output: newOutput, agentId: base.agentId ?? agentId });
      });
      notify();
    },

    handleTestRunCompleted(
      runId: string,
      status: TestRunStatus,
      exitCode: number | null,
      result: TestRunResult,
      error?: string,
      agentId?: string,
    ): void {
      setState((state) => {
        const runs = ensureMap(state);
        const run = runs.get(runId);
        if (!run) return;
        runs.set(runId, { ...run, status, exitCode, result, error, completedAt: Date.now(), agentId: run.agentId ?? agentId });
      });
      notify();
    },

    getTestRun(runId: string): TestRun | undefined {
      return getState().testRuns?.get(runId);
    },

    async stopTestRun(runId: string): Promise<boolean> {
      try {
        const { authFetch, apiUrl } = await import('../utils/storage');
        const res = await authFetch(apiUrl(`/api/tests/runs/${runId}`), { method: 'DELETE' });
        return res.ok;
      } catch (err) {
        console.error('Failed to stop test run:', err);
        return false;
      }
    },

    removeTestRun(runId: string): void {
      setState((state) => {
        state.testRuns?.delete(runId);
      });
      notify();
    },
  };
}
