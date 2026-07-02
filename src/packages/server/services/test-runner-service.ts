/**
 * Test Runner Service
 *
 * Detects test projects and runs their suites, streaming console output and
 * parsing framework result reports into a structured tree.
 *
 * Only Java/Maven (JUnit surefire) is implemented today, but detection is driven
 * by a registry of `RunnerDetector`s so additional runners (gradle, node, pytest…)
 * can be added without touching the routes, transport, or UI.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { createLogger } from '../utils/index.js';
import type {
  DetectRunnerResult,
  TestRunnerType,
  TestRunResult,
  TestSuiteResult,
  TestCaseResult,
  TestCaseStatus,
  TestRunStatus,
  TestRunTotals,
} from '../../shared/types.js';

const log = createLogger('TestRunner');

// ============================================================================
// Detection registry
// ============================================================================

interface RunnerMatch {
  runnerType: TestRunnerType;
  moduleRoot: string; // directory the runner is invoked in
  label: string;
  command: string;
}

interface FileScope {
  testFilter: string; // e.g. simple class name for Maven `-Dtest=`
  command: string; // display command
}

interface RunnerDetector {
  type: TestRunnerType;
  /** Return a match if `dirPath` (or an ancestor) is a runnable test project. */
  detect(dirPath: string): RunnerMatch | null;
  /** For a single file inside a matched project, scope the run to that one test
   *  class. Return null if the file is not a runnable test source. */
  fileFilter?(filePath: string, moduleRoot: string): FileScope | null;
}

/**
 * Heuristic gate (cheap, name-only) matching surefire's default test class
 * patterns, so the tree only probes plausible test files (avoids a filesystem
 * walk per source file).
 */
export function mightBeTestFile(fileName: string): boolean {
  if (!/\.(java|kt)$/.test(fileName)) return false;
  const base = fileName.replace(/\.(java|kt)$/, '');
  return /(Test|Tests|TestCase|IT|ITCase)$/.test(base) || /^(Test|IT)/.test(base);
}

/**
 * Walk up from `startDir` looking for the nearest directory that contains
 * `marker`, stopping at the filesystem root. Returns the directory or null.
 */
function findNearestDirWith(startDir: string, marker: string): string | null {
  let current = path.resolve(startDir);
  // Guard against symlink loops / pathological depth.
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(path.join(current, marker))) return current;
    const parent = path.dirname(current);
    if (parent === current) break; // reached filesystem root
    current = parent;
  }
  return null;
}

// --- Maven (Java / JUnit) ---------------------------------------------------
const mavenDetector: RunnerDetector = {
  type: 'maven',
  detect(dirPath: string): RunnerMatch | null {
    // The nearest pom.xml walking up IS the module root to run in — this
    // naturally scopes the run to the clicked submodule in a multi-module repo.
    const moduleRoot = findNearestDirWith(dirPath, 'pom.xml');
    if (!moduleRoot) return null;
    // Require a JUnit test source directory so we don't offer "Run Tests" on
    // projects that have no tests at all.
    if (!fs.existsSync(path.join(moduleRoot, 'src', 'test'))) return null;
    return { runnerType: 'maven', moduleRoot, label: 'Maven', command: 'mvn test' };
  },
  fileFilter(filePath: string, moduleRoot: string): FileScope | null {
    const fileName = path.basename(filePath);
    if (!mightBeTestFile(fileName)) return null;
    // Must live under the module's src/test tree.
    const testRoot = path.join(moduleRoot, 'src', 'test');
    const rel = path.relative(testRoot, filePath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    const className = fileName.replace(/\.(java|kt)$/, '');
    return { testFilter: className, command: `mvn test -Dtest=${className}` };
  },
};

const DETECTORS: RunnerDetector[] = [mavenDetector];

/**
 * Detect whether `dirPath` can run tests. Returns the first matching runner.
 * Files (non-directories) are treated by their containing directory upstream.
 */
export function detectRunner(targetPath: string): DetectRunnerResult {
  try {
    if (!targetPath || !fs.existsSync(targetPath)) return { testable: false };
    const stat = fs.statSync(targetPath);
    const isDir = stat.isDirectory();
    const dir = isDir ? targetPath : path.dirname(targetPath);
    for (const detector of DETECTORS) {
      const match = detector.detect(dir);
      if (!match) continue;
      if (isDir) {
        return {
          testable: true,
          runnerType: match.runnerType,
          moduleRoot: match.moduleRoot,
          label: match.label,
          command: match.command,
        };
      }
      // A single file: only testable if it maps to a runnable test class.
      const scope = detector.fileFilter?.(targetPath, match.moduleRoot);
      if (!scope) return { testable: false };
      return {
        testable: true,
        runnerType: match.runnerType,
        moduleRoot: match.moduleRoot,
        label: match.label,
        command: scope.command,
        testFilter: scope.testFilter,
      };
    }
  } catch (err) {
    log.error('detectRunner failed:', err);
  }
  return { testable: false };
}

/**
 * Lightweight runner-type probe used to annotate file-tree directory nodes.
 * Returns the runner type (e.g. 'maven') or undefined. Accepts an optional memo
 * to avoid repeated upward walks while enriching a whole tree.
 */
export function detectRunnerType(
  dirPath: string,
  memo?: Map<string, TestRunnerType | undefined>,
): TestRunnerType | undefined {
  if (memo && memo.has(dirPath)) return memo.get(dirPath);
  const result = detectRunner(dirPath);
  const type = result.testable ? result.runnerType : undefined;
  memo?.set(dirPath, type);
  return type;
}

// ============================================================================
// Path safety
// ============================================================================

/**
 * Only allow running tests inside the user's home directory or the server's cwd.
 * Prevents a crafted path from launching a build in an arbitrary system dir.
 */
export function isSafeModuleRoot(moduleRoot: string): boolean {
  try {
    const real = fs.realpathSync(moduleRoot);
    const roots = [process.cwd(), os.homedir()].filter(Boolean).map((r) => {
      try {
        return fs.realpathSync(r);
      } catch {
        return path.resolve(r);
      }
    });
    return roots.some((root) => {
      const rel = path.relative(root, real);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
  } catch {
    return false;
  }
}

// ============================================================================
// Command resolution (system mvn preferred, project wrapper as fallback)
// ============================================================================

function resolveExecutableOnPath(name: string): string | null {
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

interface Invocation {
  cmd: string;
  args: string[];
}

/** Pick how to invoke Maven: system `mvn`, else the project's `./mvnw` wrapper. */
function resolveMavenInvocation(moduleRoot: string, testFilter?: string): Invocation | null {
  const args = ['test', '-B']; // -B batch mode: no ANSI/progress spam
  if (testFilter) args.push(`-Dtest=${testFilter}`); // scope to a single class
  const systemMvn = resolveExecutableOnPath('mvn');
  if (systemMvn) return { cmd: systemMvn, args };
  const wrapper = path.join(moduleRoot, 'mvnw');
  if (fs.existsSync(wrapper)) return { cmd: wrapper, args };
  return null;
}

// ============================================================================
// Surefire XML parsing (dependency-free)
// ============================================================================

const XML_ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&', // must be applied last-ish; handled by ordering below
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m)
    .replace(/&amp;/g, '&');
}

/**
 * Decode an XML element body. CDATA sections are taken verbatim (raw stacktrace
 * text); non-CDATA text is entity-decoded.
 */
function decodeBody(raw: string): string {
  if (!raw) return '';
  const hasCData = /<!\[CDATA\[/.test(raw);
  if (hasCData) {
    // Concatenate the raw contents of all CDATA sections.
    let out = '';
    const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) out += m[1];
    return out.trim();
  }
  return decodeEntities(raw).trim();
}

function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrString)) !== null) {
    attrs[m[1]] = decodeEntities(m[2]);
  }
  return attrs;
}

function toNumber(value: string | undefined, fallback = 0): number {
  if (value == null) return fallback;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse a single surefire TEST-*.xml file into a suite result.
 */
export function parseSurefireXml(xml: string, file?: string): TestSuiteResult | null {
  const suiteMatch = xml.match(/<testsuite\b([^>]*)>/);
  if (!suiteMatch) return null;
  const suiteAttrs = parseAttrs(suiteMatch[1]);

  const testcases: TestCaseResult[] = [];
  // Each testcase is either self-closed (<testcase .../>) or has a body.
  const caseRe = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let cm: RegExpExecArray | null;
  while ((cm = caseRe.exec(xml)) !== null) {
    const attrs = parseAttrs(cm[1]);
    const body = cm[3] ?? '';

    let status: TestCaseStatus = 'passed';
    let failureMessage: string | undefined;
    let failureType: string | undefined;
    let failureDetail: string | undefined;

    const problem = body.match(/<(failure|error)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/);
    if (problem) {
      status = problem[1] === 'error' ? 'error' : 'failed';
      const pAttrs = parseAttrs(problem[2]);
      failureMessage = pAttrs.message;
      failureType = pAttrs.type;
      failureDetail = decodeBody(problem[4] ?? '');
    } else if (/<skipped\b/.test(body)) {
      status = 'skipped';
      const sk = body.match(/<skipped\b([^>]*?)(\/>|>([\s\S]*?)<\/skipped>)/);
      if (sk) failureMessage = parseAttrs(sk[1]).message;
    }

    testcases.push({
      name: attrs.name || '(unknown)',
      classname: attrs.classname || suiteAttrs.name || '',
      status,
      time: toNumber(attrs.time),
      failureMessage,
      failureType,
      failureDetail,
    });
  }

  const failures = testcases.filter((t) => t.status === 'failed').length;
  const errors = testcases.filter((t) => t.status === 'error').length;
  const skipped = testcases.filter((t) => t.status === 'skipped').length;
  const passed = testcases.filter((t) => t.status === 'passed').length;
  const suiteStatus: TestCaseStatus =
    failures > 0 ? 'failed' : errors > 0 ? 'error' : skipped > 0 && passed === 0 ? 'skipped' : 'passed';

  return {
    name: suiteAttrs.name || file || '(suite)',
    file,
    status: suiteStatus,
    time: toNumber(suiteAttrs.time),
    tests: testcases.length,
    passed,
    failures,
    errors,
    skipped,
    testcases,
  };
}

/**
 * Parse all surefire reports in `moduleRoot/target/surefire-reports` that were
 * (re)written during this run (mtime >= `sinceMs`). The mtime filter excludes
 * stale reports from earlier runs when only a subset of classes was executed.
 */
export function parseSurefireReports(moduleRoot: string, sinceMs: number): TestRunResult {
  const reportsDir = path.join(moduleRoot, 'target', 'surefire-reports');
  const suites: TestSuiteResult[] = [];
  try {
    if (fs.existsSync(reportsDir)) {
      const files = fs
        .readdirSync(reportsDir)
        .filter((f) => f.startsWith('TEST-') && f.endsWith('.xml'));
      for (const f of files) {
        const full = path.join(reportsDir, f);
        try {
          const stat = fs.statSync(full);
          // Small slack for filesystem timestamp granularity.
          if (stat.mtimeMs < sinceMs - 3000) continue;
          const suite = parseSurefireXml(fs.readFileSync(full, 'utf8'), f);
          if (suite) suites.push(suite);
        } catch (err) {
          log.error(`Failed to parse report ${f}:`, err);
        }
      }
    }
  } catch (err) {
    log.error('Failed to read surefire reports:', err);
  }

  suites.sort((a, b) => a.name.localeCompare(b.name));

  const totals: TestRunTotals = suites.reduce(
    (acc, s) => {
      acc.suites += 1;
      acc.tests += s.tests;
      acc.passed += s.passed;
      acc.failures += s.failures;
      acc.errors += s.errors;
      acc.skipped += s.skipped;
      acc.time += s.time;
      return acc;
    },
    { suites: 0, tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0, time: 0 } as TestRunTotals,
  );

  return { totals, suites };
}

export function deriveStatus(result: TestRunResult, exitCode: number | null): TestRunStatus {
  const { totals } = result;
  if (totals.failures > 0) return 'failed';
  if (totals.errors > 0) return 'error';
  if (totals.tests === 0 && exitCode !== 0) return 'error'; // build/compile failure
  if (exitCode !== 0) return 'failed';
  return 'passed';
}

// ============================================================================
// Run lifecycle
// ============================================================================

export interface RunCallbacks {
  onOutput: (output: string, isError: boolean) => void;
  // Partial results emitted while the run is in flight (each time a new suite
  // report appears in target/surefire-reports).
  onProgress?: (result: TestRunResult) => void;
  onComplete: (payload: {
    status: TestRunStatus;
    exitCode: number | null;
    result: TestRunResult;
    error?: string;
  }) => void;
}

export interface RunOptions {
  testFilter?: string; // scope to a single test class (Maven `-Dtest=`)
}

const runningProcesses = new Map<string, ChildProcess>();

/**
 * Start a Maven test run in `moduleRoot`, streaming output and reporting the
 * parsed result on completion. Returns immediately; the run proceeds async.
 * Throws synchronously only if Maven cannot be located.
 */
export function startMavenRun(
  runId: string,
  moduleRoot: string,
  cb: RunCallbacks,
  opts: RunOptions = {},
): void {
  const invocation = resolveMavenInvocation(moduleRoot, opts.testFilter);
  if (!invocation) {
    throw new Error('Maven not found. Install `mvn` or add a Maven wrapper (mvnw) to the project.');
  }

  const startedAt = Date.now();
  log.log(`[${runId}] ${invocation.cmd} ${invocation.args.join(' ')} (cwd=${moduleRoot})`);

  const child = spawn(invocation.cmd, invocation.args, {
    cwd: moduleRoot,
    env: { ...process.env },
    shell: false,
  });
  runningProcesses.set(runId, child);

  child.stdout?.on('data', (data: Buffer) => cb.onOutput(data.toString(), false));
  child.stderr?.on('data', (data: Buffer) => cb.onOutput(data.toString(), true));

  // Poll the surefire reports dir so results stream in suite-by-suite as each
  // test class finishes, rather than all at once on completion. Only re-emit
  // when a new suite report has appeared (avoids spamming identical results).
  let lastSuiteCount = -1;
  const progressTimer = setInterval(() => {
    if (!cb.onProgress) return;
    try {
      const partial = parseSurefireReports(moduleRoot, startedAt);
      if (partial.suites.length > 0 && partial.suites.length !== lastSuiteCount) {
        lastSuiteCount = partial.suites.length;
        cb.onProgress(partial);
      }
    } catch {
      // ignore transient read/parse errors mid-write
    }
  }, 1500);

  const finish = (exitCode: number | null, spawnError?: string) => {
    clearInterval(progressTimer);
    runningProcesses.delete(runId);
    const result = parseSurefireReports(moduleRoot, startedAt);
    const status = deriveStatus(result, exitCode);
    cb.onComplete({
      status,
      exitCode,
      result,
      error:
        spawnError ||
        (result.totals.tests === 0 && exitCode !== 0
          ? 'The build failed before any tests ran. See console output for details.'
          : undefined),
    });
  };

  child.on('close', (code) => finish(code));
  child.on('error', (err) => {
    log.error(`[${runId}] process error:`, err);
    cb.onOutput(`\n[runner error] ${err.message}\n`, true);
    finish(null, err.message);
  });
}

/** Kill a running test process (Stop / used before Re-run). */
export function killRun(runId: string): boolean {
  const child = runningProcesses.get(runId);
  if (!child) return false;
  try {
    child.kill('SIGTERM');
    return true;
  } catch (err) {
    log.error(`Failed to kill run ${runId}:`, err);
    return false;
  }
}

export function isRunActive(runId: string): boolean {
  return runningProcesses.has(runId);
}
