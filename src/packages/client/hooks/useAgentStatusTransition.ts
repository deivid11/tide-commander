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

  useEffect(() => {
    const prev = prevStatusRef.current;
    const next = status;
    prevStatusRef.current = next;

    if (prev === 'working' && next && next !== 'working') {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        callbackRef.current(next);
        timerRef.current = null;
      }, debounceMs);
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
