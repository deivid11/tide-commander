/**
 * TestRunnerModal - Results panel for the file explorer's "Run Tests" action.
 *
 * Shows a live console while the suite runs, then a tree of suites/tests with
 * pass/fail/skip status icons and per-test durations, a summary header, and the
 * failure message + stacktrace for a selected failed test. Includes Re-run/Stop.
 *
 * Data is driven entirely by the `testRuns` store slice (fed by WebSocket
 * test_run_* messages); this component only reads it via useTestRun(runId).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ModalPortal } from './shared/ModalPortal';
import { Icon, type IconName } from './Icon';
import { store, useTestRun } from '../store';
import { ansiToHtml } from '../utils/ansiToHtml';
import { fetchTestHistory } from '../api/test-runner';
import type {
  TestCaseResult,
  TestCaseStatus,
  TestSuiteResult,
  TestRunStatus,
  TestRunSummary,
} from '../../shared/types';
import '../styles/components/test-runner-modal.scss';

export interface TestRunnerModalProps {
  isOpen: boolean;
  runId: string | null;
  targetName: string; // folder name shown in the title
  onClose: () => void;
  // Re-run: no arg = repeat the whole run; a Maven `-Dtest=` filter = subset.
  onRerun: (testFilter?: string) => void;
}

const STATUS_META: Record<TestCaseStatus | 'running', { icon: IconName; color: string; label: string }> = {
  passed: { icon: 'success', color: '#5cb88a', label: 'Passed' },
  failed: { icon: 'failure', color: '#d45a5a', label: 'Failed' },
  error: { icon: 'warning-circle', color: '#d4a05a', label: 'Error' },
  skipped: { icon: 'minus', color: '#8a8a98', label: 'Skipped' },
  running: { icon: 'hourglass', color: '#5a8fd4', label: 'Running' },
};

const RUN_STATUS_META: Record<TestRunStatus, { color: string; label: string }> = {
  running: { color: '#5a8fd4', label: 'Running…' },
  passed: { color: '#5cb88a', label: 'Passed' },
  failed: { color: '#d45a5a', label: 'Failed' },
  error: { color: '#d4a05a', label: 'Error' },
};

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

// Short leaf name for a test method / suite class.
function shortName(fqName: string): string {
  const parts = fqName.split('.');
  return parts[parts.length - 1] || fqName;
}

// Build a Maven `-Dtest=` filter targeting exactly the given testcases, e.g.
// "ClassA#m1+m2,ClassB". Falls back to whole-class scope for a class when any
// of its selected methods has a non-identifier name (parameterized tests etc.).
function buildTestFilter(suites: TestSuiteResult[]): string {
  const methodsByClass = new Map<string, { methods: string[]; wholeClass: boolean }>();
  for (const suite of suites) {
    for (const tc of suite.testcases) {
      const simpleClass = (tc.classname || suite.name).split('.').pop() || suite.name;
      const entry = methodsByClass.get(simpleClass) ?? { methods: [], wholeClass: false };
      if (/^[A-Za-z0-9_]+$/.test(tc.name)) entry.methods.push(tc.name);
      else entry.wholeClass = true; // odd/parameterized name → run the class
      methodsByClass.set(simpleClass, entry);
    }
  }
  const entries: string[] = [];
  for (const [cls, { methods, wholeClass }] of methodsByClass) {
    if (wholeClass || methods.length === 0) entries.push(cls);
    else entries.push(`${cls}#${methods.join('+')}`);
  }
  return entries.join(',');
}

// Collect the failed + errored testcases across all suites.
function collectFailing(suites: TestSuiteResult[]): (TestCaseResult & { suiteName: string })[] {
  const out: (TestCaseResult & { suiteName: string })[] = [];
  for (const suite of suites) {
    for (const tc of suite.testcases) {
      if (tc.status === 'failed' || tc.status === 'error') out.push({ ...tc, suiteName: suite.name });
    }
  }
  return out;
}

// Build a plain-text report of the failing tests for the clipboard.
function buildFailureReport(
  failing: (TestCaseResult & { suiteName: string })[],
  displayName: string,
  command?: string,
): string {
  const lines: string[] = [
    `${failing.length} failing test${failing.length === 1 ? '' : 's'}${displayName ? ` — ${displayName}` : ''}`,
  ];
  if (command) lines.push(command);
  lines.push('');
  for (const tc of failing) {
    lines.push(`✗ ${tc.classname || tc.suiteName}#${tc.name}`);
    const head = [tc.failureType, tc.failureMessage].filter(Boolean).join(': ');
    if (head) lines.push(`  ${head}`);
    if (tc.failureDetail) {
      lines.push(tc.failureDetail.split('\n').map((l) => `    ${l}`).join('\n'));
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

// Render streamed console lines ([stderr]-prefixed lines styled as errors).
function renderConsoleLines(output: string[]): React.ReactNode {
  return output.map((line, i) => {
    const isStderr = line.startsWith('[stderr]');
    const clean = line.replace(/^\[stderr\] /, '');
    return (
      <div
        key={i}
        className={`trm-console-line ${isStderr ? 'stderr' : ''}`}
        dangerouslySetInnerHTML={{ __html: ansiToHtml(clean) }}
      />
    );
  });
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

/** Run history browser — lists persisted past runs; clicking one loads it. */
function TestRunHistoryPanel({
  currentRunId,
  onClose,
}: {
  currentRunId: string | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<TestRunSummary[] | null>(null);

  useEffect(() => {
    let live = true;
    fetchTestHistory(100)
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, []);

  const pick = (runId: string) => {
    void store.openTestRunFromHistory(runId);
    onClose();
  };

  return (
    <div className="trm-history">
      {rows === null ? (
        <div className="trm-console-empty">Loading history…</div>
      ) : rows.length === 0 ? (
        <div className="trm-console-empty">No past runs recorded yet.</div>
      ) : (
        rows.map((r) => {
          const meta = RUN_STATUS_META[r.status];
          const name = r.targetPath.split('/').pop() || r.targetPath;
          return (
            <button
              key={r.runId}
              className={`trm-history-row status-${r.status} ${r.runId === currentRunId ? 'current' : ''}`}
              onClick={() => pick(r.runId)}
              title={r.command || r.targetPath}
            >
              <span className="trm-history-status" style={{ color: meta.color }}>
                {meta.label}
              </span>
              <span className="trm-history-name">{name}</span>
              <span className="trm-history-counts">
                <span className="passed">{r.totals.passed}✓</span>
                {r.totals.failures + r.totals.errors > 0 && (
                  <span className="failed">{r.totals.failures + r.totals.errors}✗</span>
                )}
                {r.totals.skipped > 0 && <span className="skipped">{r.totals.skipped}⊘</span>}
                <span className="total">/ {r.totals.tests}</span>
              </span>
              <span className="trm-history-cmd">{r.command}</span>
              <span className="trm-history-time">{formatRelativeTime(r.finishedAt)}</span>
            </button>
          );
        })
      )}
    </div>
  );
}

export function TestRunnerModal({ isOpen, runId, targetName, onClose, onRerun }: TestRunnerModalProps) {
  const run = useTestRun(runId);
  const outputRef = useRef<HTMLDivElement>(null);
  const [rightTab, setRightTab] = useState<'console' | 'detail'>('console');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expandedSuites, setExpandedSuites] = useState<Set<string>>(new Set());
  // Filter the tree to a single status (null = show everything).
  const [statusFilter, setStatusFilter] = useState<TestCaseStatus | null>(null);
  const [stopping, setStopping] = useState(false);
  const [copiedFailed, setCopiedFailed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Ticking clock so the elapsed timer advances while running.
  const [, setNow] = useState(0);

  const status = run?.status ?? 'running';
  const isRunning = status === 'running';
  const result = run?.result;

  // Advance the elapsed timer while running.
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => setNow((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);

  // Auto-scroll the console as output streams (only while viewing console).
  useEffect(() => {
    if (rightTab === 'console' && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [run?.output, rightTab]);

  // Once the run finishes, auto-expand suites with failures/errors (union with
  // whatever the user already expanded). Skipped while running so live-streaming
  // suites don't repeatedly fight the user's manual expand/collapse.
  useEffect(() => {
    if (isRunning || !result) return;
    setExpandedSuites((prev) => {
      const next = new Set(prev);
      for (const suite of result.suites) {
        if (suite.failures > 0 || suite.errors > 0) next.add(suite.name);
      }
      return next;
    });
  }, [isRunning, result]);

  // Reset transient view state whenever the modal switches to a different run.
  useEffect(() => {
    setRightTab('console');
    setSelectedKey(null);
    setExpandedSuites(new Set());
    setStatusFilter(null);
  }, [runId]);

  const elapsedSeconds = run
    ? ((run.completedAt ?? Date.now()) - run.startedAt) / 1000
    : 0;

  const totals = result?.totals;
  // Prefer the live run's target (survives reopen); fall back to the prop.
  const displayName = targetName || (run?.targetPath ? run.targetPath.split('/').pop() ?? '' : '');

  const selectedCase = useMemo((): (TestCaseResult & { suiteName: string }) | null => {
    if (!selectedKey || !result) return null;
    for (const suite of result.suites) {
      for (const tc of suite.testcases) {
        if (`${suite.name}#${tc.name}` === selectedKey) return { ...tc, suiteName: suite.name };
      }
    }
    return null;
  }, [selectedKey, result]);

  // Suites shown in the tree — filtered to a single status when one is active.
  const visibleSuites = useMemo((): TestSuiteResult[] => {
    if (!result) return [];
    if (!statusFilter) return result.suites;
    return result.suites
      .map((s) => ({ ...s, testcases: s.testcases.filter((tc) => tc.status === statusFilter) }))
      .filter((s) => s.testcases.length > 0);
  }, [result, statusFilter]);

  if (!isOpen) return null;

  // Opened with no run yet (e.g. via the Ctrl+T shortcut before running anything).
  if (!run) {
    return (
      <ModalPortal>
        <div className="modal-overlay visible" onClick={onClose}>
          <div
            className={`test-runner-modal ${showHistory ? '' : 'is-empty'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="trm-title">
                <Icon name="flask" size={16} />
                <span className="trm-title-text">Test Results</span>
              </div>
              <div className="trm-header-actions">
                <button
                  className={`trm-header-btn ${showHistory ? 'active' : ''}`}
                  onClick={() => setShowHistory((v) => !v)}
                  title="Run history"
                >
                  <Icon name="hourglass" size={13} /> History
                </button>
                <button className="modal-close" onClick={onClose} aria-label="Close">
                  <Icon name="close" size={16} />
                </button>
              </div>
            </div>
            {showHistory ? (
              <TestRunHistoryPanel currentRunId={null} onClose={() => setShowHistory(false)} />
            ) : (
              <div className="trm-empty-state">
                No test run yet. Right-click a folder or a test file in the file explorer and
                choose <strong>Run Tests</strong>. Past runs (if any) are under{' '}
                <strong>History</strong>.
              </div>
            )}
          </div>
        </div>
      </ModalPortal>
    );
  }

  const handleToggleSuite = (name: string) => {
    setExpandedSuites((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Toggle a status filter; clicking the active one clears it.
  const toggleFilter = (status: TestCaseStatus) => {
    setStatusFilter((prev) => (prev === status ? null : status));
  };

  // Copy the failed + errored tests (identifiers, messages, stacktraces) to the
  // clipboard, with a legacy execCommand fallback for non-secure contexts.
  const handleCopyFailed = async () => {
    const failing = collectFailing(result?.suites ?? []);
    if (failing.length === 0) return;
    const text = buildFailureReport(failing, displayName, run?.command);
    const flash = () => {
      setCopiedFailed(true);
      window.setTimeout(() => setCopiedFailed(false), 1500);
    };
    try {
      await navigator.clipboard.writeText(text);
      flash();
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        flash();
      } catch {
        /* clipboard unavailable */
      }
      document.body.removeChild(ta);
    }
  };

  const handleSelectCase = (suite: TestSuiteResult, tc: TestCaseResult) => {
    const key = `${suite.name}#${tc.name}`;
    setSelectedKey(key);
    // Failed/errored tests open their detail; passing tests just highlight.
    if (tc.status === 'failed' || tc.status === 'error') setRightTab('detail');
  };

  const handleStop = async () => {
    if (!runId || stopping) return;
    setStopping(true);
    await store.stopTestRun(runId);
    setStopping(false);
  };

  const runMeta = RUN_STATUS_META[status];

  return (
    <ModalPortal>
      <div className="modal-overlay visible" onClick={onClose}>
        <div
          className="test-runner-modal"
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
            <div className="trm-title">
              <Icon name="flask" size={16} />
              <span className="trm-title-text">Test Results</span>
              <span className="trm-target" title={run?.targetPath || displayName}>
                {displayName}
              </span>
            </div>
            <div className="trm-header-actions">
              <button
                className={`trm-header-btn ${showHistory ? 'active' : ''}`}
                onClick={() => setShowHistory((v) => !v)}
                title="Run history"
              >
                <Icon name="hourglass" size={13} /> History
              </button>
              <button className="modal-close" onClick={onClose} aria-label="Close">
                <Icon name="close" size={16} />
              </button>
            </div>
          </div>

          {showHistory ? (
            <TestRunHistoryPanel currentRunId={runId} onClose={() => setShowHistory(false)} />
          ) : (
          <>
          {/* Summary bar */}
          <div className="trm-summary">
            <span className="trm-status-pill" style={{ color: runMeta.color, borderColor: runMeta.color }}>
              {isRunning && <span className="trm-spinner" />}
              {runMeta.label}
            </span>

            {totals ? (
              <div className="trm-counts">
                <button
                  className={`trm-count total ${statusFilter === null ? 'active' : ''}`}
                  onClick={() => setStatusFilter(null)}
                  title="Show all tests"
                >
                  {totals.tests} tests
                </button>
                <button
                  className={`trm-count passed ${statusFilter === 'passed' ? 'active' : ''}`}
                  onClick={() => toggleFilter('passed')}
                  disabled={totals.passed === 0}
                  title="Show only passed"
                >
                  <Icon name="success" size={12} /> {totals.passed}
                </button>
                <button
                  className={`trm-count failed ${statusFilter === 'failed' ? 'active' : ''}`}
                  onClick={() => toggleFilter('failed')}
                  disabled={totals.failures === 0}
                  title="Show only failed"
                >
                  <Icon name="failure" size={12} /> {totals.failures}
                </button>
                <button
                  className={`trm-count error ${statusFilter === 'error' ? 'active' : ''}`}
                  onClick={() => toggleFilter('error')}
                  disabled={totals.errors === 0}
                  title="Show only errored"
                >
                  <Icon name="warning-circle" size={12} /> {totals.errors} errors
                </button>
                <button
                  className={`trm-count skipped ${statusFilter === 'skipped' ? 'active' : ''}`}
                  onClick={() => toggleFilter('skipped')}
                  disabled={totals.skipped === 0}
                  title="Show only skipped"
                >
                  <Icon name="minus" size={12} /> {totals.skipped}
                </button>
                <span className="trm-count suites">{totals.suites} suites</span>
              </div>
            ) : (
              <div className="trm-counts">
                <span className="trm-count total">{isRunning ? 'Running Maven…' : 'No results'}</span>
              </div>
            )}

            <span className="trm-elapsed">
              <Icon name="hourglass" size={12} /> {formatDuration(elapsedSeconds)}
            </span>

            <span className="trm-command" title={run?.command}>
              {run?.command}
            </span>
          </div>

          {run?.error && (
            <div className="trm-error-banner">
              <Icon name="warning-circle" size={14} /> {run.error}
            </div>
          )}

          {/* Body: tree (left) + console/detail (right) */}
          <div className="trm-body">
            <div className="trm-tree">
              {!result || result.suites.length === 0 ? (
                <div className="trm-tree-empty">
                  {isRunning ? 'Waiting for results…' : 'No test results were produced.'}
                </div>
              ) : visibleSuites.length === 0 ? (
                <div className="trm-tree-empty">No {statusFilter} tests.</div>
              ) : (
                visibleSuites.map((suite) => {
                  // A filter drills into matching tests, so keep those suites open.
                  const expanded = statusFilter !== null || expandedSuites.has(suite.name);
                  const sMeta = STATUS_META[suite.status];
                  return (
                    <div key={suite.name} className="trm-suite">
                      <div
                        className={`trm-row trm-suite-row status-${suite.status}`}
                        onClick={() => handleToggleSuite(suite.name)}
                      >
                        <span className="trm-caret">
                          <Icon name={expanded ? 'caret-down' : 'caret-right'} size={10} />
                        </span>
                        <span className="trm-status-icon" style={{ color: sMeta.color }}>
                          <Icon name={sMeta.icon} size={13} />
                        </span>
                        <span className="trm-row-name" title={suite.name}>
                          {shortName(suite.name)}
                        </span>
                        <span className="trm-suite-counts">
                          {suite.failures + suite.errors > 0 && (
                            <span className="trm-badge failed">{suite.failures + suite.errors}</span>
                          )}
                          {suite.skipped > 0 && <span className="trm-badge skipped">{suite.skipped}</span>}
                          <span className="trm-badge passed">{suite.passed}</span>
                        </span>
                        <span className="trm-row-time">{formatDuration(suite.time)}</span>
                      </div>
                      {expanded &&
                        suite.testcases.map((tc) => {
                          const key = `${suite.name}#${tc.name}`;
                          const tMeta = STATUS_META[tc.status];
                          return (
                            <div
                              key={key}
                              className={`trm-row trm-case-row status-${tc.status} ${
                                selectedKey === key ? 'selected' : ''
                              }`}
                              onClick={() => handleSelectCase(suite, tc)}
                            >
                              <span className="trm-status-icon" style={{ color: tMeta.color }}>
                                <Icon name={tMeta.icon} size={12} />
                              </span>
                              <span className="trm-row-name" title={tc.name}>
                                {tc.name}
                              </span>
                              <span className="trm-row-time">{formatDuration(tc.time)}</span>
                            </div>
                          );
                        })}
                    </div>
                  );
                })
              )}
            </div>

            <div className="trm-right">
              <div className="trm-tabs">
                <button
                  className={`trm-tab ${rightTab === 'console' ? 'active' : ''}`}
                  onClick={() => setRightTab('console')}
                >
                  Console
                </button>
                <button
                  className={`trm-tab ${rightTab === 'detail' ? 'active' : ''}`}
                  onClick={() => setRightTab('detail')}
                  disabled={!selectedCase}
                >
                  Test Detail
                </button>
              </div>

              {rightTab === 'console' ? (
                <div className="trm-console" ref={outputRef}>
                  {run && run.output.length > 0 ? (
                    renderConsoleLines(run.output)
                  ) : (
                    <div className="trm-console-empty">{isRunning ? 'Starting…' : 'No output.'}</div>
                  )}
                </div>
              ) : (
                <div className="trm-detail">
                  {selectedCase ? (
                    <>
                      <div className="trm-detail-head">
                        <span
                          className="trm-status-icon"
                          style={{ color: STATUS_META[selectedCase.status].color }}
                        >
                          <Icon name={STATUS_META[selectedCase.status].icon} size={14} />
                        </span>
                        <span className="trm-detail-name">{selectedCase.name}</span>
                      </div>
                      <div className="trm-detail-suite">{selectedCase.suiteName}</div>
                      {selectedCase.status === 'passed' || selectedCase.status === 'skipped' ? (
                        <div className="trm-detail-ok">
                          {STATUS_META[selectedCase.status].label}
                          {selectedCase.failureMessage ? ` — ${selectedCase.failureMessage}` : ''}
                        </div>
                      ) : (
                        <>
                          {selectedCase.failureType && (
                            <div className="trm-detail-type">{selectedCase.failureType}</div>
                          )}
                          {selectedCase.failureMessage && (
                            <div className="trm-detail-message">{selectedCase.failureMessage}</div>
                          )}
                          {selectedCase.failureDetail && (
                            <pre className="trm-detail-stack">{selectedCase.failureDetail}</pre>
                          )}
                        </>
                      )}

                      {/* Full run console, inline under the selected test's detail. */}
                      <div className="trm-detail-console-section">
                        <div className="trm-detail-console-header">
                          <Icon name="desktop" size={13} /> Full console output
                        </div>
                        <div className="trm-detail-console">
                          {run && run.output.length > 0 ? (
                            renderConsoleLines(run.output)
                          ) : (
                            <div className="trm-console-empty">No output.</div>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="trm-console-empty">Select a test to see details.</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="modal-footer">
            <div className="trm-footer-left">
              {isRunning && (
                <button className="btn btn-danger" onClick={() => void handleStop()} disabled={stopping}>
                  <Icon name="stop" size={13} /> {stopping ? 'Stopping…' : 'Stop'}
                </button>
              )}
            </div>
            <div className="trm-footer-right">
              <button className="btn btn-secondary" onClick={onClose}>
                Close
              </button>
              {totals && totals.failures + totals.errors > 0 && (
                <button
                  className="btn btn-secondary"
                  onClick={() => void handleCopyFailed()}
                  title="Copy failed & errored tests to the clipboard"
                >
                  <Icon name={copiedFailed ? 'check' : 'clipboard'} size={13} />{' '}
                  {copiedFailed ? 'Copied' : `Copy failed (${totals.failures + totals.errors})`}
                </button>
              )}
              {/* Subset re-run builds a Maven `-Dtest=` filter — other runners
                  (vitest) re-run the whole target instead. */}
              {statusFilter && visibleSuites.length > 0 && run?.runnerType === 'maven' && (
                <button
                  className="btn btn-secondary"
                  onClick={() => onRerun(buildTestFilter(visibleSuites))}
                  disabled={isRunning}
                  title={`Re-run only the ${statusFilter} tests`}
                >
                  <Icon name="refresh" size={13} /> Re-run {statusFilter}
                </button>
              )}
              <button className="btn btn-primary" onClick={() => onRerun()} disabled={isRunning}>
                <Icon name="refresh" size={13} /> Re-run all
              </button>
            </div>
          </div>
          </>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
