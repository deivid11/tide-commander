import { useEffect, useRef } from 'react';

export interface UseAgentStatusTransitionOptions {
  status: string | undefined;
  onLeaveWorking: (nextStatus: string) => void;
  debounceMs?: number;
}

export function useAgentStatusTransition({
  status,
  onLeaveWorking,
  debounceMs = 500,
}: UseAgentStatusTransitionOptions): void {
  const prevStatusRef = useRef<string | undefined>(status);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(onLeaveWorking);
  callbackRef.current = onLeaveWorking;

  // Latest known status for the deferred callback re-check (avoid draining
  // after a forceInterrupt blip that already returned to working).
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const prev = prevStatusRef.current;
    const next = status;
    prevStatusRef.current = next;

    // Left working → schedule drain/delivery after a short settle window.
    if (prev === 'working' && next && next !== 'working') {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // Re-check: a force-interrupt briefly goes idle then working again.
        if (statusRef.current === 'working') return;
        callbackRef.current(next);
      }, debounceMs);
      return;
    }

    // Re-entered working before the debounce elapsed (e.g. forceInterrupt stop
    // → immediate respawn). Cancel the pending leave callback so we don't
    // drain/send the next queued message on top of the force-sent one.
    if (next === 'working' && timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [status, debounceMs]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);
}
