/**
 * TestsBuildingModal - Browser for a "tests" building.
 *
 * Scans the building's configured folder for every test class/method (static
 * source scan via POST /api/tests/scan), lets the user search them and run the
 * whole suite, a single class, or a single method. The launched run streams
 * live into the right-hand panel (same testRuns store slice the results modal
 * uses); "Full results" jumps to the global TestRunnerModal for deep-dive.
 *
 * Perf: while mvn streams, `run` is replaced on every output line. The left
 * browser tree is a memoized component that never receives `run` — only the
 * parsed `result` (ref-stable between progress ticks) — so per-line updates
 * re-render just the compact run panel, mirroring the TestRunInline approach.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Gherkin step keywords (EN + ES) highlighted in the inline steps view.
const GHERKIN_KEYWORD_RE = /^(Given|When|Then|And|But|Dado|Dada|Cuando|Entonces|Y|E|Pero)\b/;

/** Pretty-print a Gherkin block: section titles amber, step keywords blue. */
function GherkinBlock({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        if (/^(Background|Antecedentes|Scenario|Escenario|Examples|Ejemplos)\b/.test(line)) {
          return (
            <div key={i} className="tbm-step-line section">
              {line}
            </div>
          );
        }
        const kw = line.match(GHERKIN_KEYWORD_RE);
        return (
          <div key={i} className="tbm-step-line">
            {kw ? (
              <>
                <span className="kw">{kw[1]}</span>
                {line.slice(kw[1].length)}
              </>
            ) : (
              line
            )}
          </div>
        );
      })}
    </>
  );
}
import { ModalPortal } from './shared/ModalPortal';
import { Icon, type IconName } from './Icon';
import { store, useTestRun, useTestsBuildingId, useBuildings, useLatestTestRunId, isTestPathRelated } from '../store';
import { useModalStackRegistration } from '../hooks/useModalStack';
import { useSplitPane } from '../hooks/useSplitPane';
import { dockBuilding } from '../utils/buildingViewMode';
import { getStorageBoolean, setStorageBoolean, getStorageStringSet, setStorageStringSet } from '../utils/storage';
import { scanTests, fetchTestHistory } from '../api/test-runner';
import { ansiToHtml } from '../utils/ansiToHtml';
import type {
  Building,
  ScannedTestClass,
  ScannedTestMethod,
  TestCaseStatus,
  TestRunResult,
  TestRunStatus,
  TestRunSummary,
  TestScanResult,
  TestSuiteResult,
} from '../../shared/types';
import type { TestRun } from '../store';
import '../styles/components/tests-building-modal.scss';

const STATUS_META: Record<TestCaseStatus, { icon: IconName; color: string; label: string }> = {
  passed: { icon: 'success', color: '#5cb88a', label: 'Passed' },
  failed: { icon: 'failure', color: '#d45a5a', label: 'Failed' },
  error: { icon: 'warning-circle', color: '#d4a05a', label: 'Error' },
  skipped: { icon: 'minus', color: '#8a8a98', label: 'Skipped' },
};

const RUN_STATUS_META: Record<TestRunStatus, { color: string; label: string }> = {
  running: { color: '#5a8fd4', label: 'Running…' },
  passed: { color: '#5cb88a', label: 'Passed' },
  failed: { color: '#d45a5a', label: 'Failed' },
  error: { color: '#d4a05a', label: 'Error' },
};

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Match a scanned method to its reported testcase status. Tolerates the
 *  `method[1]` / `method(...)` names parameterized JUnit tests produce and the
 *  `describe chain > name` names vitest reports. */
function methodStatus(suite: TestSuiteResult | undefined, method: string): TestCaseStatus | undefined {
  if (!suite) return undefined;
  let worst: TestCaseStatus | undefined;
  const rank: Record<TestCaseStatus, number> = { passed: 0, skipped: 1, failed: 2, error: 3 };
  for (const tc of suite.testcases) {
    if (
      tc.name === method ||
      tc.name.startsWith(`${method}[`) ||
      tc.name.startsWith(`${method}(`) ||
      tc.name.startsWith(`${method} with data set`) ||
      tc.name.endsWith(` > ${method}`)
    ) {
      if (!worst || rank[tc.status] > rank[worst]) worst = tc.status;
    }
  }
  return worst;
}

interface FilteredClass extends ScannedTestClass {
  // Methods narrowed to the search query (all methods when the class matched).
  visibleMethods: ScannedTestClass['methods'];
}

const STATUS_RANK: Record<TestCaseStatus, number> = { passed: 0, skipped: 1, failed: 2, error: 3 };

/** Aggregate a feature file's scenario statuses (worst wins) for its row. */
function featureAggregate(
  cls: ScannedTestClass,
  scenarioStatuses: Map<string, TestCaseStatus>,
): { status: TestCaseStatus; passed: number; failed: number } | null {
  let status: TestCaseStatus | undefined;
  let passed = 0;
  let failed = 0;
  for (const m of cls.methods) {
    const st = scenarioStatuses.get(m.name);
    if (!st) continue;
    if (st === 'passed') passed++;
    if (st === 'failed' || st === 'error') failed++;
    if (!status || STATUS_RANK[st] > STATUS_RANK[status]) status = st;
  }
  return status ? { status, passed, failed } : null;
}

// ============================================================================
// Left pane: scanned test browser (memoized — must NOT receive `run`)
// ============================================================================

interface TestBrowserProps {
  classes: FilteredClass[];
  searching: boolean;
  expanded: Set<string>;
  suitesByFq: Map<string, TestSuiteResult>;
  // Statuses keyed by Cucumber scenario name (cucumber-testng reports them
  // inside runScenario["…"] testcase names, not per feature-file suites).
  scenarioStatuses: Map<string, TestCaseStatus>;
  runBusy: boolean;
  onToggle: (fqName: string) => void;
  onRunClass: (cls: ScannedTestClass) => void;
  onRunMethod: (cls: ScannedTestClass, method: ScannedTestMethod) => void;
}

const TestBrowser = memo(function TestBrowser({
  classes,
  searching,
  expanded,
  suitesByFq,
  scenarioStatuses,
  runBusy,
  onToggle,
  onRunClass,
  onRunMethod,
}: TestBrowserProps) {
  // Scenario rows with their steps view open (Background + steps inline).
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set());
  const toggleSteps = useCallback((key: string) => {
    setOpenSteps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  // Group classes by package for readable browsing.
  const groups = useMemo(() => {
    const byPackage = new Map<string, FilteredClass[]>();
    for (const cls of classes) {
      const key = cls.packageName || '(default package)';
      const list = byPackage.get(key) ?? [];
      list.push(cls);
      byPackage.set(key, list);
    }
    return Array.from(byPackage.entries());
  }, [classes]);

  if (classes.length === 0) {
    return <div className="tbm-browser-empty">{searching ? 'No tests match your search.' : 'No tests found in this folder.'}</div>;
  }

  return (
    <div className="tbm-browser">
      {groups.map(([pkg, pkgClasses]) => (
        <div key={pkg} className="tbm-package">
          <div className="tbm-package-header" title={pkg}>
            <Icon name="package" size={11} />
            <span>{pkg}</span>
          </div>
          {pkgClasses.map((cls) => {
            const suite = suitesByFq.get(cls.fqName);
            // Cucumber feature files report under the runner's suite, so their
            // row status aggregates from the scenario-name statuses instead.
            const featAgg = cls.feature ? featureAggregate(cls, scenarioStatuses) : null;
            const rowStatus = featAgg?.status ?? suite?.status;
            const failedCount = featAgg ? featAgg.failed : suite ? suite.failures + suite.errors : 0;
            const passedCount = featAgg ? featAgg.passed : suite ? suite.passed : 0;
            const hasMethods = cls.methods.length > 0;
            const isExpanded = hasMethods && (searching || expanded.has(cls.fqName));
            const classTitle = cls.description ? `${cls.relFile}\n\n${cls.description}` : cls.relFile;
            return (
              <div key={cls.fqName} className="tbm-class">
                <div
                  className={`tbm-row tbm-class-row ${rowStatus ? `status-${rowStatus}` : ''}`}
                  onClick={() => hasMethods && onToggle(cls.fqName)}
                >
                  <span className={`tbm-caret ${hasMethods ? '' : 'hidden'}`}>
                    <Icon name={isExpanded ? 'caret-down' : 'caret-right'} size={10} />
                  </span>
                  {rowStatus ? (
                    <span className="tbm-status-icon" style={{ color: STATUS_META[rowStatus].color }} title={STATUS_META[rowStatus].label}>
                      <Icon name={STATUS_META[rowStatus].icon} size={13} />
                    </span>
                  ) : (
                    <span className="tbm-status-icon idle">
                      <Icon name="flask" size={12} />
                    </span>
                  )}
                  <span className="tbm-row-name" title={classTitle}>{cls.className}</span>
                  {(suite || featAgg) && (
                    <span className="tbm-class-counts">
                      {failedCount > 0 && <span className="badge failed">{failedCount}✗</span>}
                      <span className="badge passed">{passedCount}✓</span>
                    </span>
                  )}
                  {cls.runner ? (
                    <span className="tbm-runner-chip" title="Suite/runner class — runs as a whole (no individual methods)">runner</span>
                  ) : cls.feature ? (
                    <>
                      <span className="tbm-runner-chip feature" title="Gherkin feature file — scenarios run via the project's Cucumber runner">feature</span>
                      <span className="tbm-method-count">{cls.methods.length}</span>
                    </>
                  ) : (
                    <span className="tbm-method-count">{cls.methods.length}</span>
                  )}
                  <button
                    className="tbm-play"
                    disabled={runBusy}
                    title={runBusy ? 'A run is already in progress' : `Run ${cls.className}`}
                    onClick={(e) => { e.stopPropagation(); onRunClass(cls); }}
                  >
                    <Icon name="play" size={11} />
                  </button>
                </div>
                {isExpanded &&
                  cls.visibleMethods.map((m) => {
                    const st = cls.feature ? scenarioStatuses.get(m.name) : methodStatus(suite, m.name);
                    const label = cls.feature ? m.name : `${cls.className}#${m.name}`;
                    const hasSteps = !!(m.detail || (cls.feature && cls.background));
                    const stepsKey = `${cls.fqName}::${m.line}`;
                    const stepsOpen = hasSteps && openSteps.has(stepsKey);
                    return (
                      <React.Fragment key={`${m.name}:${m.line}`}>
                        <div
                          className={`tbm-row tbm-method-row ${st ? `status-${st}` : ''} ${hasSteps ? 'has-steps' : ''}`}
                          onClick={hasSteps ? () => toggleSteps(stepsKey) : undefined}
                        >
                          {hasSteps && (
                            <span className="tbm-caret">
                              <Icon name={stepsOpen ? 'caret-down' : 'caret-right'} size={9} />
                            </span>
                          )}
                          <span className="tbm-status-icon" style={st ? { color: STATUS_META[st].color } : undefined}>
                            <Icon name={st ? STATUS_META[st].icon : 'minus'} size={11} />
                          </span>
                          <span className="tbm-row-name" title={label}>
                            {m.name}
                          </span>
                          <button
                            className="tbm-play"
                            disabled={runBusy}
                            title={runBusy ? 'A run is already in progress' : `Run ${label}`}
                            onClick={(e) => { e.stopPropagation(); onRunMethod(cls, m); }}
                          >
                            <Icon name="play" size={10} />
                          </button>
                        </div>
                        {stepsOpen && (
                          <div className="tbm-steps">
                            {cls.feature && cls.background && (
                              <div className="tbm-steps-block background">
                                <GherkinBlock text={cls.background} />
                              </div>
                            )}
                            {m.detail && (
                              <div className="tbm-steps-block">
                                <GherkinBlock text={m.detail} />
                              </div>
                            )}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
});

// ============================================================================
// Right pane: live run panel (re-renders per output line — keep it lean)
// ============================================================================

// Failure tree memoized on `result` so it skips per-output-line reconciliation.
const RunFailures = memo(function RunFailures({ result }: { result: TestRunResult }) {
  const failing = result.suites.filter((s) => s.failures > 0 || s.errors > 0);
  if (failing.length === 0) return null;
  return (
    <div className="tbm-run-failures">
      {failing.map((suite) => (
        <div key={suite.name} className="tbm-failure-suite">
          <div className="tbm-failure-suite-name" title={suite.name}>
            <Icon name="failure" size={12} /> {suite.name.split('.').pop()}
          </div>
          {suite.testcases
            .filter((tc) => tc.status === 'failed' || tc.status === 'error')
            .map((tc) => (
              <div key={tc.name} className="tbm-failure-case">
                <span className="tbm-failure-case-name">{tc.name}</span>
                {tc.failureMessage && <span className="tbm-failure-case-msg" title={tc.failureMessage}>{tc.failureMessage}</span>}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
});

function RunPanel({ run, onStop, onRerun }: { run: TestRun; onStop: () => void; onRerun: () => void }) {
  const [showConsole, setShowConsole] = useState(false);
  const consoleRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);

  const isRunning = run.status === 'running';
  const meta = RUN_STATUS_META[run.status];
  const totals = run.result?.totals;
  const elapsed = ((run.completedAt ?? Date.now()) - run.startedAt) / 1000;

  // Tick the elapsed clock while running.
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);

  // Auto-scroll console while open.
  useEffect(() => {
    if (showConsole && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [run.output, showConsole]);

  // Only pay for console rendering when it's open.
  const consoleLines = useMemo(() => {
    if (!showConsole) return null;
    return run.output.map((line, i) => {
      const isStderr = line.startsWith('[stderr]');
      return (
        <div
          key={i}
          className={`tbm-console-line ${isStderr ? 'stderr' : ''}`}
          dangerouslySetInnerHTML={{ __html: ansiToHtml(line.replace(/^\[stderr\] /, '')) }}
        />
      );
    });
  }, [run.output, showConsole]);

  return (
    <div className="tbm-run">
      <div className="tbm-run-header">
        <span className="tbm-run-status" style={{ color: meta.color, borderColor: meta.color }}>
          {isRunning && <span className="tbm-spinner" />}
          {meta.label}
        </span>
        <span className="tbm-run-elapsed"><Icon name="hourglass" size={11} /> {formatDuration(elapsed)}</span>
        <span className="tbm-run-command" title={run.command}>{run.command}</span>
      </div>

      {totals ? (
        <div className="tbm-run-totals">
          <span className="chip total">{totals.tests} tests</span>
          <span className="chip passed"><Icon name="success" size={11} /> {totals.passed}</span>
          {totals.failures > 0 && <span className="chip failed"><Icon name="failure" size={11} /> {totals.failures}</span>}
          {totals.errors > 0 && <span className="chip error"><Icon name="warning-circle" size={11} /> {totals.errors}</span>}
          {totals.skipped > 0 && <span className="chip skipped"><Icon name="minus" size={11} /> {totals.skipped}</span>}
          <span className="chip suites">{totals.suites} suites</span>
        </div>
      ) : (
        <div className="tbm-run-totals">
          <span className="chip total">{isRunning ? 'Compiling / starting…' : 'No results'}</span>
        </div>
      )}

      {run.error && <div className="tbm-run-error"><Icon name="warning-circle" size={13} /> {run.error}</div>}

      <div className="tbm-run-body">
        {run.result && run.result.suites.length > 0 ? (
          run.result.totals.failures + run.result.totals.errors > 0 ? (
            <RunFailures result={run.result} />
          ) : (
            <div className="tbm-run-allgreen">
              <Icon name="success" size={26} />
              <span>{isRunning ? 'All green so far…' : 'All tests passed'}</span>
            </div>
          )
        ) : (
          <div className="tbm-run-waiting">{isRunning ? 'Waiting for the first suite…' : 'No suites were produced.'}</div>
        )}

        {showConsole && (
          <div className="tbm-console" ref={consoleRef}>
            {consoleLines && consoleLines.length > 0 ? consoleLines : <div className="tbm-run-waiting">No output yet.</div>}
          </div>
        )}
      </div>

      <div className="tbm-run-actions">
        <button className="tbm-btn" onClick={() => setShowConsole((v) => !v)}>
          <Icon name="terminal" size={12} /> {showConsole ? 'Hide console' : 'Console'}
        </button>
        {isRunning ? (
          <button className="tbm-btn danger" onClick={onStop}>
            <Icon name="stop" size={12} /> Stop
          </button>
        ) : (
          <button className="tbm-btn" onClick={onRerun}>
            <Icon name="refresh" size={12} /> Re-run
          </button>
        )}
        <button className="tbm-btn accent" onClick={() => store.openTestResultsForRun(run.runId)}>
          <Icon name="launch" size={12} /> Full results
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Previous runs (history) — persisted past runs scoped to this building's folder
// ============================================================================

// Memoized so the per-output-line re-renders of the modal don't reconcile the
// list: it only re-renders when its (referentially stable) props change.
const TbmHistory = memo(function TbmHistory({
  folderPath,
  currentRunId,
  reloadKey,
  onPick,
}: {
  folderPath: string;
  currentRunId: string | null;
  // Bumped by the modal whenever a run finishes so a freshly-completed run
  // shows up in the list without a manual refresh.
  reloadKey: number;
  onPick: (runId: string) => void;
}) {
  const [open, setOpen] = useState(() => getStorageBoolean(`tbm-history-open:${folderPath}`, true));
  const [rows, setRows] = useState<TestRunSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setStorageBoolean(`tbm-history-open:${folderPath}`, open);
  }, [folderPath, open]);

  useEffect(() => {
    if (!folderPath) return;
    let live = true;
    setLoading(true);
    fetchTestHistory(100)
      .then((all) => {
        if (!live) return;
        // Scope to runs whose module/target lives under (or above) this folder.
        setRows(all.filter((r) => isTestPathRelated(r.moduleRoot || r.targetPath, folderPath)));
      })
      .catch(() => live && setRows([]))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [folderPath, reloadKey]);

  const count = rows?.length ?? 0;

  return (
    <div className="tbm-history">
      <button className="tbm-history-toggle" onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'caret-down' : 'caret-right'} size={10} />
        <Icon name="hourglass" size={12} />
        <span className="tbm-history-title">Previous runs</span>
        {rows !== null && <span className="tbm-history-badge">{count}</span>}
        {loading && <span className="tbm-spinner" />}
      </button>
      {open && (
        <div className="tbm-history-list">
          {rows === null ? (
            <div className="tbm-history-empty">Loading history…</div>
          ) : count === 0 ? (
            <div className="tbm-history-empty">No past runs for this folder yet.</div>
          ) : (
            rows.map((r) => {
              const meta = RUN_STATUS_META[r.status];
              const failed = r.totals.failures + r.totals.errors;
              return (
                <button
                  key={r.runId}
                  className={`tbm-history-row status-${r.status} ${r.runId === currentRunId ? 'current' : ''}`}
                  onClick={() => onPick(r.runId)}
                  title={r.command || r.targetPath}
                >
                  <span className="tbm-history-status" style={{ color: meta.color }}>
                    {meta.label}
                  </span>
                  <span className="tbm-history-counts">
                    <span className="passed">{r.totals.passed}✓</span>
                    {failed > 0 && <span className="failed">{failed}✗</span>}
                    {r.totals.skipped > 0 && <span className="skipped">{r.totals.skipped}⊘</span>}
                    <span className="total">/ {r.totals.tests}</span>
                  </span>
                  <span className="tbm-history-cmd">{r.command}</span>
                  <span className="tbm-history-time">{formatRelativeTime(r.finishedAt)}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// Browser content — shared by the modal and the dockable bottom panels
// ============================================================================

/**
 * The whole tests browser (toolbar + class tree + run panel + history) without
 * any window chrome, so it can live either inside the full modal or docked as
 * a compact panel under the Guake/flat terminal input. Runs stream through the
 * store (useTestRun), so a run started in one host keeps streaming in the
 * other after docking/undocking.
 */
export function TestsBrowser({
  building,
  autoFocusSearch = true,
  onBusyChange,
}: {
  building: Building;
  /** Disable in panel mode so opening the dock doesn't steal the terminal input's focus. */
  autoFocusSearch?: boolean;
  /** Lets the host pulse its flask icon while a run is in flight. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const folderPath = building.folderPath ?? '';

  const [scan, setScan] = useState<TestScanResult | null>(null);
  const [scanning, setScanning] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Expanded classes survive close/reopen AND modal↔dock swaps (the swap
  // remounts this component).
  const expandedKey = `tests-building-expanded-${building.id}`;
  const [expanded, setExpanded] = useState<Set<string>>(() => getStorageStringSet(expandedKey));
  useEffect(() => {
    setStorageStringSet(expandedKey, expanded);
  }, [expandedKey, expanded]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  // Bumped whenever a run finishes so the "Previous runs" list refetches and
  // the freshly-completed run appears without a manual refresh.
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const lastCompletedRef = useRef<string>('');
  // Draggable list/run split, persisted per building (shared modal↔dock).
  const { leftPct: splitLeftPct, bodyRef: splitBodyRef, onSplitMouseDown } = useSplitPane(`tests-building-split-${building.id}`, 55);
  const searchRef = useRef<HTMLInputElement>(null);

  const run = useTestRun(activeRunId);
  const isRunBusy = run?.status === 'running';

  useEffect(() => {
    onBusyChange?.(!!isRunBusy);
  }, [isRunBusy, onBusyChange]);

  // When the panel's run reaches a terminal status, refresh the history list.
  useEffect(() => {
    if (!run || run.status === 'running') return;
    const sig = `${run.runId}:${run.completedAt ?? ''}`;
    if (sig === lastCompletedRef.current) return;
    lastCompletedRef.current = sig;
    setHistoryReloadKey((k) => k + 1);
  }, [run?.runId, run?.status, run?.completedAt]);

  const handlePickHistory = useCallback(async (runId: string) => {
    setRunError(null);
    try {
      const ok = await store.loadTestRunFromHistory(runId);
      if (ok) setActiveRunId(runId);
      else setRunError('That run could not be loaded (it may have been cleared).');
    } catch (err: any) {
      setRunError(err?.message || 'Failed to load the selected run.');
    }
  }, []);

  const doScan = useCallback(async () => {
    if (!folderPath) {
      setScanning(false);
      setScanError('This building has no tests folder configured. Edit the building to set one.');
      return;
    }
    setScanning(true);
    setScanError(null);
    try {
      const result = await scanTests(folderPath);
      if (!result.testable) {
        setScan(null);
        setScanError(result.error || 'No runnable test project found at this path.');
      } else {
        setScan(result);
      }
    } catch (err: any) {
      setScan(null);
      setScanError(err?.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  }, [folderPath]);

  // Scan on open + focus the search box.
  useEffect(() => {
    void doScan();
    if (!autoFocusSearch) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 150);
    return () => window.clearTimeout(t);
  }, [doScan, autoFocusSearch]);

  // Adopt the most recent run already related to this folder (e.g. still
  // streaming from a previous open, or started from the file explorer).
  useEffect(() => {
    const runs = store.getState().testRuns;
    if (!runs || !folderPath) return;
    let best: TestRun | null = null;
    for (const r of runs.values()) {
      const root = r.moduleRoot || r.targetPath;
      if (root && isTestPathRelated(root, folderPath)) {
        if (!best || r.startedAt > best.startedAt) best = r;
      }
    }
    if (best) setActiveRunId(best.runId);
  }, [folderPath]);

  // Live-adopt runs that START while the modal is open (an agent or the file
  // explorer launching tests for this same folder) so the panel follows them.
  const latestRunId = useLatestTestRunId();
  useEffect(() => {
    if (!latestRunId || !folderPath) return;
    const r = store.getState().testRuns?.get(latestRunId);
    const root = r ? r.moduleRoot || r.targetPath : '';
    if (root && isTestPathRelated(root, folderPath)) setActiveRunId(latestRunId);
  }, [latestRunId, folderPath]);

  // Filtered classes — a query matches class/package names (all methods shown)
  // or individual method names (only those shown).
  const filteredClasses = useMemo((): FilteredClass[] => {
    if (!scan) return [];
    const q = search.trim().toLowerCase();
    if (!q) return scan.classes.map((c) => ({ ...c, visibleMethods: c.methods }));
    const out: FilteredClass[] = [];
    for (const cls of scan.classes) {
      if (cls.fqName.toLowerCase().includes(q)) {
        out.push({ ...cls, visibleMethods: cls.methods });
        continue;
      }
      const matching = cls.methods.filter((m) => m.name.toLowerCase().includes(q));
      if (matching.length > 0) out.push({ ...cls, visibleMethods: matching });
    }
    return out;
  }, [scan, search]);

  const visibleMethodCount = useMemo(
    () => filteredClasses.reduce((acc, c) => acc + c.visibleMethods.length, 0),
    [filteredClasses],
  );

  // Suite results keyed by fully-qualified class name — ref-stable between
  // progress ticks, so the memoized browser skips per-output-line renders.
  const suitesByFq = useMemo(() => {
    const map = new Map<string, TestSuiteResult>();
    for (const suite of run?.result?.suites ?? []) map.set(suite.name, suite);
    return map;
  }, [run?.result]);

  // Cucumber scenario statuses by scenario name — cucumber-testng reports each
  // scenario as `runScenario["<scenario>", "<feature>"](N)` under the RUNNER's
  // suite, so feature rows can't match by suite name.
  const scenarioStatuses = useMemo(() => {
    const map = new Map<string, TestCaseStatus>();
    for (const suite of run?.result?.suites ?? []) {
      for (const tc of suite.testcases) {
        const m = tc.name.match(/^runScenario\["(.+?)", ".*"\]/);
        if (!m) continue;
        const prev = map.get(m[1]);
        if (!prev || STATUS_RANK[tc.status] > STATUS_RANK[prev]) map.set(m[1], tc.status);
      }
    }
    return map;
  }, [run?.result]);

  const launch = useCallback(
    async (testFilter?: string) => {
      if (!scan?.moduleRoot && !folderPath) return;
      setRunError(null);
      try {
        // Filtered runs target the module root (`-Dtest=` scopes them); the
        // full run keeps the folder path so history reads naturally.
        const target = testFilter ? scan?.moduleRoot ?? folderPath : folderPath;
        const runId = await store.runTestsQuiet(target, testFilter);
        setActiveRunId(runId);
      } catch (err: any) {
        setRunError(err?.message || 'Failed to start test run');
      }
    },
    [scan?.moduleRoot, folderPath],
  );

  // Filter syntax is runner-specific: Maven scopes by class/method via
  // `-Dtest=`; vitest and phpunit by file path (+ `::name` for a single test).
  const usesFileFilter = scan?.runnerType === 'vitest' || scan?.runnerType === 'phpunit';
  const lastLaunchRef = useRef<string | undefined>(undefined);
  const handleRunAll = useCallback(() => {
    lastLaunchRef.current = undefined;
    void launch();
  }, [launch]);
  const handleRunClass = useCallback(
    (cls: ScannedTestClass) => {
      // Feature/vitest/phpunit files run by path; JUnit classes via -Dtest.
      const filter = cls.feature || usesFileFilter ? cls.relFile : cls.className;
      lastLaunchRef.current = filter;
      void launch(filter);
    },
    [launch, usesFileFilter],
  );
  const handleRunMethod = useCallback(
    (cls: ScannedTestClass, method: ScannedTestMethod) => {
      // Cucumber scenarios run by file:line; vitest/phpunit by file::name;
      // JUnit by Class#method.
      const filter = cls.feature
        ? `${cls.relFile}:${method.line}`
        : usesFileFilter
          ? `${cls.relFile}::${method.name}`
          : `${cls.className}#${method.name}`;
      lastLaunchRef.current = filter;
      void launch(filter);
    },
    [launch, usesFileFilter],
  );
  const handleRerun = useCallback(() => {
    void launch(lastLaunchRef.current);
  }, [launch]);
  const handleStop = useCallback(() => {
    if (activeRunId) void store.stopTestRun(activeRunId);
  }, [activeRunId]);
  const handleToggle = useCallback((fqName: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fqName)) next.delete(fqName);
      else next.add(fqName);
      return next;
    });
  }, []);

  return (
    <>
      {/* Toolbar */}
      <div className="tbm-toolbar">
        <div className="tbm-search">
          <Icon name="search" size={13} />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search classes and methods…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="tbm-search-clear" onClick={() => setSearch('')} title="Clear search">
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
        <span className="tbm-scan-counts">
          {scan ? `${filteredClasses.length} classes · ${visibleMethodCount} tests` : ''}
        </span>
        {scan?.runnerType && <span className="tbm-runner-badge">{scan.runnerType}</span>}
        <button className="tbm-btn" onClick={() => void doScan()} disabled={scanning} title="Re-scan test sources">
          <Icon name="refresh" size={12} /> {scanning ? 'Scanning…' : 'Rescan'}
        </button>
        <button
          className="tbm-btn primary"
          onClick={handleRunAll}
          disabled={isRunBusy || scanning || !scan}
          title={isRunBusy ? 'A run is already in progress' : 'Run the whole suite'}
        >
          <Icon name="play" size={12} /> Run all
        </button>
      </div>

      {runError && <div className="tbm-run-error banner"><Icon name="warning-circle" size={13} /> {runError}</div>}

      {/* Body */}
      <div className="tbm-body" ref={splitBodyRef}>
        <div className="tbm-left" style={{ width: `${splitLeftPct}%` }}>
          {scanning ? (
            <div className="tbm-browser-empty">
              <span className="tbm-spinner large" /> Scanning test sources…
            </div>
          ) : scanError ? (
            <div className="tbm-browser-empty error">
              <Icon name="warning-circle" size={16} /> {scanError}
              <button className="tbm-btn" onClick={() => void doScan()}>
                <Icon name="refresh" size={12} /> Retry
              </button>
            </div>
          ) : (
            <TestBrowser
              classes={filteredClasses}
              searching={search.trim().length > 0}
              expanded={expanded}
              suitesByFq={suitesByFq}
              scenarioStatuses={scenarioStatuses}
              runBusy={!!isRunBusy}
              onToggle={handleToggle}
              onRunClass={handleRunClass}
              onRunMethod={handleRunMethod}
            />
          )}
        </div>

        <div
          className="tbm-split"
          onMouseDown={onSplitMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize test list"
        />

        <div className="tbm-right">
          {run ? (
            <RunPanel run={run} onStop={handleStop} onRerun={handleRerun} />
          ) : (
            <div className="tbm-run-empty">
              <Icon name="flask" size={30} />
              <span>No run yet</span>
              <p>Run the whole suite, or hover a class or method on the left and hit play.</p>
            </div>
          )}
          <TbmHistory
            folderPath={folderPath}
            currentRunId={activeRunId}
            reloadKey={historyReloadKey}
            onPick={handlePickHistory}
          />
        </div>
      </div>
    </>
  );
}

// ============================================================================
// Modal shell
// ============================================================================

function TestsBuildingModal({ building, onClose }: { building: Building; onClose: () => void }) {
  const folderPath = building.folderPath ?? '';
  const [busy, setBusy] = useState(false);
  return (
    <ModalPortal>
      <div className="modal-overlay visible" onClick={onClose}>
        <div
          className="tests-building-modal"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        >
          {/* Header */}
          <div className="modal-header">
            <div className="tbm-title">
              <span className={`tbm-title-flask ${busy ? 'working' : ''}`}>
                <Icon name="flask" size={16} />
              </span>
              <span className="tbm-title-text">{building.name}</span>
              <span className="tbm-title-path" title={folderPath}>{folderPath}</span>
            </div>
            <div className="tbm-header-actions">
              <button
                className="modal-close"
                onClick={() => {
                  dockBuilding(building.id, 'tests');
                  onClose();
                }}
                aria-label="Dock below the terminal input"
                title="Minimize — dock below the terminal input"
              >
                <Icon name="arrow-down" size={16} />
              </button>
              <button className="modal-close" onClick={onClose} aria-label="Close">
                <Icon name="close" size={16} />
              </button>
            </div>
          </div>
          <TestsBrowser building={building} onBusyChange={setBusy} />
        </div>
      </div>
    </ModalPortal>
  );
}

/**
 * App-wide mount, driven by the store (`testsBuildingId`). The `key` resets all
 * browser state when switching between different tests buildings.
 */
export function GlobalTestsBuildingModal() {
  const buildingId = useTestsBuildingId();
  const buildings = useBuildings();
  const building = buildingId ? buildings.get(buildingId) : undefined;
  // Register on the modal stack so Escape (and the mobile back gesture) closes
  // THIS modal via closeTopModal() instead of falling through to the global
  // handler that closes the guake terminal.
  useModalStackRegistration('tests-building-modal', !!(buildingId && building), () => store.closeTestsBuilding());
  if (!buildingId || !building) return null;
  return <TestsBuildingModal key={buildingId} building={building} onClose={() => store.closeTestsBuilding()} />;
}
