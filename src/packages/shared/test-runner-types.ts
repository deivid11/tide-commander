/**
 * Test Runner Types
 *
 * Shared types for the "Run Tests" feature. A folder in the file explorer can be
 * detected as belonging to a test project (currently Java/Maven). The server runs
 * the suite, streams console output, and parses the framework's result reports
 * (JUnit surefire XML for Maven) into a structured tree the UI renders.
 *
 * The design is runner-agnostic: `TestRunnerType` can grow (gradle, node, pytest,
 * …) without changing the transport or the UI, which key off these shared shapes.
 */

// Supported test runner kinds. Only 'maven' is implemented today; the detector
// registry is structured so more can be added later.
export type TestRunnerType = 'maven';

// Per-test outcome. Mirrors JUnit semantics (failure = assertion, error = thrown).
export type TestCaseStatus = 'passed' | 'failed' | 'error' | 'skipped';

// Overall status of a run (or a suite): 'running' while in flight, then the
// worst outcome observed. 'error' covers build/compile failures with no results.
export type TestRunStatus = 'running' | 'passed' | 'failed' | 'error';

export interface TestCaseResult {
  name: string;
  classname: string;
  status: TestCaseStatus;
  time: number; // seconds
  // Populated for failed/error cases.
  failureMessage?: string;
  failureType?: string;
  failureDetail?: string; // stacktrace / body text
}

export interface TestSuiteResult {
  name: string; // fully-qualified test class, e.g. opm.mx.pagamento.util.ClabeUtilTest
  file?: string; // report file basename (TEST-*.xml)
  status: TestCaseStatus;
  time: number; // seconds
  tests: number;
  passed: number;
  failures: number;
  errors: number;
  skipped: number;
  testcases: TestCaseResult[];
}

export interface TestRunTotals {
  suites: number;
  tests: number;
  passed: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number; // seconds (sum of suite times)
}

export interface TestRunResult {
  totals: TestRunTotals;
  suites: TestSuiteResult[];
}

// A completed run persisted to disk (and returned by GET /api/tests/runs/:id).
export interface StoredTestRun {
  runId: string;
  status: TestRunStatus;
  exitCode: number | null;
  result: TestRunResult;
  targetPath: string;
  moduleRoot: string;
  runnerType: TestRunnerType | string;
  command?: string;
  error?: string;
  startedAt?: number;
  finishedAt: number; // ms epoch when the run completed
  agentId?: string; // agent that started the run, if any
}

// Lightweight run entry for the history list (no per-test detail).
export interface TestRunSummary {
  runId: string;
  status: TestRunStatus;
  exitCode: number | null;
  targetPath: string;
  moduleRoot: string;
  runnerType: TestRunnerType | string;
  command?: string;
  totals: TestRunTotals;
  error?: string;
  finishedAt: number;
}

// Result of detecting whether a folder (or a single test file) can run tests.
export interface DetectRunnerResult {
  testable: boolean;
  runnerType?: TestRunnerType;
  moduleRoot?: string; // directory the runner is invoked in
  label?: string; // human label, e.g. "Maven"
  command?: string; // display command, e.g. "mvn test" or "mvn test -Dtest=FooTest"
  // Set when scoping to a single test class (right-click on a test file);
  // for Maven this is the simple class name passed to `-Dtest=`.
  testFilter?: string;
}
