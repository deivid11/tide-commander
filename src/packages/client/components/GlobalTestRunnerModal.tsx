/**
 * GlobalTestRunnerModal
 *
 * App-wide mount of the test results modal, driven entirely by the store so it
 * can be opened from anywhere (the file-explorer button or the Ctrl+T shortcut)
 * — not only while the file explorer is open. The run itself lives in the store
 * (latestTestRunId), so this just reflects it.
 */

import { TestRunnerModal } from './TestRunnerModal';
import { store, useLatestTestRunId, useTestResultsModalOpen } from '../store';

export function GlobalTestRunnerModal() {
  const isOpen = useTestResultsModalOpen();
  const latestTestRunId = useLatestTestRunId();

  return (
    <TestRunnerModal
      isOpen={isOpen}
      runId={latestTestRunId}
      targetName=""
      onClose={() => store.closeTestResults()}
      onRerun={(filter) => {
        void store.rerunTests(filter);
      }}
    />
  );
}
