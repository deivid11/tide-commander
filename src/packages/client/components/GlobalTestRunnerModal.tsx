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
import { useModalStackRegistration } from '../hooks/useModalStack';

export function GlobalTestRunnerModal() {
  const isOpen = useTestResultsModalOpen();
  const latestTestRunId = useLatestTestRunId();
  // On the modal stack so Escape closes this modal (via closeTopModal) instead
  // of bubbling to the global handler that closes the guake terminal.
  useModalStackRegistration('test-results-modal', isOpen, () => store.closeTestResults());

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
