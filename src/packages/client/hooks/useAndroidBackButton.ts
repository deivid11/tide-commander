import { useEffect, useRef } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { isNativeApp } from '../utils/notifications';

export type AndroidBackResult = 'handled' | 'exit';

/**
 * Capacitor back-button hook (Android APK).
 *
 * The handler runs on every system back gesture; return `'handled'` to absorb
 * the gesture, `'exit'` to call App.exitApp() and let the OS close the app.
 * Forward gestures aren't exposed by Android, so only back is wired.
 */
export function useAndroidBackButton(handler: () => AndroidBackResult): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!isNativeApp()) return;

    let listener: PluginListenerHandle | null = null;
    let cancelled = false;

    void App.addListener('backButton', () => {
      if (handlerRef.current() === 'exit') {
        void App.exitApp();
      }
    }).then((h) => {
      if (cancelled) {
        void h.remove();
      } else {
        listener = h;
      }
    });

    return () => {
      cancelled = true;
      if (listener) {
        void listener.remove();
        listener = null;
      }
    };
  }, []);
}
