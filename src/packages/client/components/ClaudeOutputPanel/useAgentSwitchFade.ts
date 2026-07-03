/**
 * useAgentSwitchFade - shared agent-switch crossfade state machine.
 *
 * Used by every surface that hosts an AgentTerminalPane (the guake terminal
 * in 3D mode and the Flat view chat) so switching agents looks and behaves
 * identically everywhere: the keyed pane remounts atomically, but the swap is
 * held for one short, TIMEOUT-bounded fade-out of the outgoing conversation.
 *
 * switch → host adds `pane-fading-out` (fades the current conversation out)
 *        → keyed remount for the new agent
 *        → the new conversation fades in after pin.
 *
 * Deliberately NOT useDeferredValue — a deferred render can be starved by
 * streaming store updates, leaving the old conversation frozen on screen with
 * no feedback. A setTimeout is bounded no matter what else is rendering.
 */

import { useEffect, useState } from 'react';

// How long the outgoing conversation fades before the keyed pane remounts for
// the incoming agent. Must match the `pane-fading-out` transition duration in
// styles/components/guake-terminal/_output.scss.
export const PANE_FADE_OUT_MS = 30;

export function useAgentSwitchFade(activeAgentId: string | null): {
  /** The agent the pane should currently render (lags activeAgentId by one fade). */
  displayedAgentId: string | null;
  /** True while the outgoing conversation is fading; host applies `pane-fading-out`. */
  fadingOut: boolean;
} {
  const [displayedAgentId, setDisplayedAgentId] = useState<string | null>(activeAgentId);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    if (activeAgentId === displayedAgentId) {
      // Also covers switching BACK to the displayed agent mid-fade.
      setFadingOut(false);
      return;
    }
    if (!displayedAgentId) {
      // Nothing on screen to fade — bind immediately.
      setDisplayedAgentId(activeAgentId);
      return;
    }
    setFadingOut(true);
    const timer = setTimeout(() => {
      setDisplayedAgentId(activeAgentId);
      setFadingOut(false);
    }, PANE_FADE_OUT_MS);
    return () => clearTimeout(timer);
  }, [activeAgentId, displayedAgentId]);

  return { displayedAgentId, fadingOut };
}
