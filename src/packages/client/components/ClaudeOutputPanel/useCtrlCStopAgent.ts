import { useEffect } from 'react';
import { store } from '../../store';

/**
 * Ctrl+C stops the given agent's current run (terminal semantics) while the
 * hosting terminal view is open — unless text is selected anywhere (input,
 * textarea, or page selection), so copy keeps working.
 *
 * Mount at most one enabled instance per view: the listener is document-level,
 * so two enabled instances (e.g. one per split pane) would stop both agents
 * on a single Ctrl+C.
 */
export function useCtrlCStopAgent(enabled: boolean, agentId: string | null | undefined): void {
  useEffect(() => {
    if (!enabled || !agentId) return;

    const handleStopShortcut = (e: KeyboardEvent) => {
      if (e.key !== 'c' || !e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        if (target.selectionStart !== target.selectionEnd) return;
      } else if (window.getSelection()?.isCollapsed === false) {
        return;
      }

      const agent = store.getState().agents.get(agentId);
      if (agent?.status !== 'working') return;
      e.preventDefault();
      store.stopAgent(agentId);
      // Visual kill feedback: the pane displaying this agent flashes red.
      window.dispatchEvent(new CustomEvent('tide:agent-stop-flash', { detail: { agentId } }));
    };

    document.addEventListener('keydown', handleStopShortcut);
    return () => document.removeEventListener('keydown', handleStopShortcut);
  }, [enabled, agentId]);
}
