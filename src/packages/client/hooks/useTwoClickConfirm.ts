import { useCallback, useEffect, useRef, useState } from 'react';

export interface TwoClickConfirm {
  isPending: (id: string) => boolean;
  arm: (id: string) => void;
  cancel: () => void;
  handleClick: (id: string, action: () => void) => void;
}

export function useTwoClickConfirm(timeoutMs = 3000): TwoClickConfirm {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const arm = useCallback((id: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPendingId(id);
    timerRef.current = setTimeout(() => {
      setPendingId((current) => (current === id ? null : current));
      timerRef.current = null;
    }, timeoutMs);
  }, [timeoutMs]);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPendingId(null);
  }, []);

  const isPending = useCallback((id: string) => pendingId === id, [pendingId]);

  const handleClick = useCallback((id: string, action: () => void) => {
    if (pendingId === id) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setPendingId(null);
      action();
    } else {
      arm(id);
    }
  }, [pendingId, arm]);

  return { isPending, arm, cancel, handleClick };
}
