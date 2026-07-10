import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Icon, type IconName } from './Icon';

export type ToastType = 'error' | 'success' | 'warning' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  title: string;
  message: string;
  duration: number;
}

interface ToastContextType {
  showToast: (type: ToastType, title: string, message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

const TOAST_ICONS: Record<ToastType, IconName> = {
  error: 'failure',
  success: 'success',
  warning: 'warn',
  info: 'info',
};

let toastId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [currentToast, setCurrentToast] = useState<Toast | null>(null);
  const queueRef = useRef<Toast[]>([]);
  const timeoutRef = useRef<number | null>(null);
  // Mirrors currentToast so showToast/processQueue can stay identity-stable
  // (consumers put showToast in effect/callback deps)
  const currentToastRef = useRef<Toast | null>(null);

  const setToast = useCallback((toast: Toast | null) => {
    currentToastRef.current = toast;
    setCurrentToast(toast);
  }, []);

  // Process the next toast in the queue
  const processQueue = useCallback(() => {
    if (queueRef.current.length > 0 && !currentToastRef.current) {
      const nextToast = queueRef.current.shift()!;
      setToast(nextToast);
    }
  }, [setToast]);

  // Show next toast when current one is cleared
  useEffect(() => {
    if (!currentToast) {
      processQueue();
    }
  }, [currentToast, processQueue]);

  // Set up auto-dismiss timer for current toast
  useEffect(() => {
    if (currentToast && currentToast.duration > 0) {
      timeoutRef.current = window.setTimeout(() => {
        setToast(null);
      }, currentToast.duration);

      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      };
    }
  }, [currentToast, setToast]);

  const showToast = useCallback(
    (type: ToastType, title: string, message: string, duration = 5000) => {
      const id = ++toastId;
      const toast: Toast = { id, type, title, message, duration };

      // Add to queue
      queueRef.current.push(toast);

      // If no current toast, process immediately
      if (!currentToastRef.current) {
        const nextToast = queueRef.current.shift()!;
        setToast(nextToast);
      }
    },
    [setToast]
  );

  const dismissToast = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setToast(null);
  }, [setToast]);

  const contextValue = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div id="toast-container">
        {currentToast && (
          <div key={currentToast.id} className={`toast ${currentToast.type}`}>
            <span className="toast-icon"><Icon name={TOAST_ICONS[currentToast.type]} size={16} /></span>
            <div className="toast-content">
              <div className="toast-title">{currentToast.title}</div>
              <div className="toast-message">{currentToast.message}</div>
            </div>
            <button className="toast-close" onClick={dismissToast}>
              &times;
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}
