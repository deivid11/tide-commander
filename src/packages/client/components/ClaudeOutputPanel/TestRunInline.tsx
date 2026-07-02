/**
 * TestRunInline — inline terminal component for an agent-started test run.
 *
 * Rendered under the `curl … /api/tests/run` line (live via OutputLine and,
 * after refresh, via HistoryLine). Shows the parsed suite/test tree as it streams
 * in (like the results modal, compact), with the raw console behind a toggle.
 * The header links to the full results panel.
 */

import { memo, useMemo, useState } from 'react';
import { Icon, type IconName } from '../Icon';
import { store, useTestRun, type TestRun } from '../../store';
import { ansiToHtml } from '../../utils/ansiToHtml';
import type { TestCaseStatus, TestRunResult, TestSuiteResult } from '../../../shared/types';

const STATUS_META: Record<TestCaseStatus | 'running', { icon: IconName; color: string }> = {
  passed: { icon: 'success', color: '#5cb88a' },
  failed: { icon: 'failure', color: '#d45a5a' },
  error: { icon: 'warning-circle', color: '#d4a05a' },
  skipped: { icon: 'minus', color: '#8a8a98' },
  running: { icon: 'hourglass', color: '#5a8fd4' },
};

const RUN_COLOR: Record<TestRun['status'], string> = {
  running: '#5a8fd4',
  passed: '#5cb88a',
  failed: '#d45a5a',
  error: '#d4a05a',
};

const SuiteRow = memo(function SuiteRow({ suite }: { suite: TestSuiteResult }) {
  const failing = suite.testcases.filter((tc) => tc.status === 'failed' || tc.status === 'error');
  const [open, setOpen] = useState(failing.length > 0);
  const meta = STATUS_META[suite.status];
  const short = suite.name.split('.').pop() || suite.name;

  return (
    <div className="tri-suite">
      <div
        className="tri-suite-row"
        onClick={() => failing.length > 0 && setOpen((o) => !o)}
      >
        {failing.length > 0 ? (
          <Icon name={open ? 'caret-down' : 'caret-right'} size={9} />
        ) : (
          <span className="tri-caret-spacer" />
        )}
        <span className="tri-icon" style={{ color: meta.color }}>
          <Icon name={meta.icon} size={11} />
        </span>
        <span className="tri-suite-name" title={suite.name}>{short}</span>
        <span className="tri-suite-counts">
          {suite.failures + suite.errors > 0 && <span className="fail">{suite.failures + suite.errors}✗</span>}
          <span className="pass">{suite.passed}✓</span>
          {suite.skipped > 0 && <span className="skip">{suite.skipped}⊘</span>}
        </span>
      </div>
      {open &&
        failing.map((tc) => (
          <div key={tc.name} className="tri-test-row">
            <span className="tri-icon" style={{ color: STATUS_META[tc.status].color }}>
              <Icon name={STATUS_META[tc.status].icon} size={10} />
            </span>
            <span className="tri-test-name">{tc.name}</span>
            {tc.failureMessage && <span className="tri-test-msg">{tc.failureMessage}</span>}
          </div>
        ))}
    </div>
  );
});

// The suite tree only depends on `result` (which changes on progress/completed,
// NOT on every console line), so memoizing it keeps output updates cheap.
const SuiteTree = memo(function SuiteTree({ result, isRunning }: { result?: TestRunResult; isRunning: boolean }) {
  return (
    <div className="tri-suites">
      {!result || result.suites.length === 0 ? (
        <div className="tri-empty">{isRunning ? 'Running… waiting for the first suite' : 'No results.'}</div>
      ) : (
        result.suites.map((s) => <SuiteRow key={s.name} suite={s} />)
      )}
    </div>
  );
});

export function TestRunInline({ runId }: { runId: string }) {
  const run = useTestRun(runId);
  const [showConsole, setShowConsole] = useState(false);
  // Console lines only rendered when the toggle is open (keeps output updates cheap).
  const consoleLines = useMemo(
    () => (showConsole && run ? run.output.slice(-14).map((l) => l.replace(/^\[stderr\] /, '')) : []),
    [showConsole, run?.output]
  );

  if (!run) return null;
  const result = run.result;
  const totals = result?.totals;
  const isRunning = run.status === 'running';

  return (
    <div className={`test-run-inline status-${run.status}`}>
      <div
        className="tri-header"
        onClick={() => store.openTestResultsForRun(run.runId)}
        title="Open the full test results panel"
      >
        {isRunning && <span className="tri-spin" />}
        <Icon name="flask" size={12} />
        <span className="tri-status" style={{ color: RUN_COLOR[run.status] }}>
          {isRunning ? 'Running tests' : `Tests ${run.status}`}
        </span>
        {totals && (
          <span className="tri-counts">
            <span className="pass">{totals.passed}✓</span>
            {totals.failures + totals.errors > 0 && <span className="fail">{totals.failures + totals.errors}✗</span>}
            {totals.skipped > 0 && <span className="skip">{totals.skipped}⊘</span>}
            <span className="tot">/ {totals.tests}</span>
          </span>
        )}
        <span className="tri-open">open panel ↗</span>
      </div>

      <SuiteTree result={result} isRunning={isRunning} />

      <button className="tri-console-toggle" onClick={() => setShowConsole((v) => !v)}>
        <Icon name={showConsole ? 'caret-down' : 'caret-right'} size={9} /> {showConsole ? 'Hide console' : 'Show console'}
      </button>
      {showConsole && (
        <div className="tri-console">
          <pre>
            {consoleLines.map((line, i) => (
              <div key={i} dangerouslySetInnerHTML={{ __html: ansiToHtml(line) }} />
            ))}
            {isRunning && <span className="tri-cursor">▌</span>}
          </pre>
        </div>
      )}
    </div>
  );
}
