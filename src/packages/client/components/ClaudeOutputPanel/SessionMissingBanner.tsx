/**
 * SessionMissingBanner — a strip under the terminal header shown when an
 * agent's saved Claude session can no longer be resumed because its transcript
 * is gone (e.g. removed by Claude Code's retention sweep).
 *
 * Without it the agent simply stops answering: the CLI fails `--resume`, the
 * turn ends with zero usage and nothing reaches the chat. The button hands the
 * agent a fresh session; the old history cannot be recovered.
 */

import { memo } from 'react';
import { Icon } from '../Icon';
import type { Agent } from '../../../shared/types';

export const SessionMissingBanner = memo(function SessionMissingBanner({
  agent,
  onStartNewSession,
}: {
  agent: Agent;
  onStartNewSession: () => void;
}) {
  if (!agent.sessionMissing) return null;

  return (
    <div className="guake-session-missing-banner" role="alert">
      <Icon name="warn" size={12} />
      <span className="guake-session-missing-text">
        The saved Claude session for this agent no longer exists, so it cannot answer.
      </span>
      <button
        type="button"
        className="guake-session-missing-btn"
        onClick={onStartNewSession}
        title="Starts a fresh conversation on the next message. The old history cannot be recovered."
      >
        Start new session
      </button>
    </div>
  );
});
