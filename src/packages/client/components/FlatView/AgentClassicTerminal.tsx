/**
 * AgentClassicTerminal — embeds the real interactive `claude` TUI for an
 * interactive-mode agent by attaching (via ttyd) to its tmux session. Reuses the
 * existing TerminalEmbed (xterm.js) component used by building terminals.
 */
import React, { useEffect, useState } from 'react';
import TerminalEmbed from '../TerminalEmbed';
import { startAgentTerminal, stopAgentTerminal } from '../../api/agent-terminal';

interface AgentClassicTerminalProps {
  agentId: string;
}

// Pending debounced stops, keyed by agentId. React StrictMode (dev) double-
// invokes effects as setup → cleanup → setup; killing the ttyd in the cleanup
// would tear down the terminal we just started. Debouncing the stop lets the
// immediate remount cancel it, so the viewer survives the StrictMode cycle and
// only stops on a genuine close (toggle off / switch agent).
const pendingStops = new Map<string, ReturnType<typeof setTimeout>>();

function AgentClassicTerminal({ agentId }: AgentClassicTerminalProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Cancel a stop scheduled by a just-prior unmount (StrictMode remount /
    // quick re-toggle) so we reuse the existing ttyd instead of churning it.
    const pending = pendingStops.get(agentId);
    if (pending) {
      clearTimeout(pending);
      pendingStops.delete(agentId);
    }

    setUrl(null);
    setError(null);

    startAgentTerminal(agentId)
      .then((res) => {
        if (!cancelled) setUrl(res.url);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to start terminal');
      });

    return () => {
      cancelled = true;
      // Debounced stop — a remount within the window cancels it. The tmux
      // session (and the agent) keep running; this only tears down the viewer.
      const existing = pendingStops.get(agentId);
      if (existing) clearTimeout(existing);
      pendingStops.set(
        agentId,
        setTimeout(() => {
          pendingStops.delete(agentId);
          void stopAgentTerminal(agentId);
        }, 2500),
      );
    };
  }, [agentId]);

  if (error) {
    return (
      <div className="flat-classic-terminal flat-classic-terminal--message">
        <span>{error}</span>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flat-classic-terminal flat-classic-terminal--message">
        <span>Attaching to interactive session…</span>
      </div>
    );
  }

  return (
    <div className="flat-classic-terminal">
      <TerminalEmbed terminalUrl={url} visible={true} />
    </div>
  );
}

export default AgentClassicTerminal;
