import { Capacitor, registerPlugin } from '@capacitor/core';

interface ExternalNavigationNativePlugin {
  open(options: { url: string }): Promise<void>;
}

const ExternalNavigationNative = registerPlugin<ExternalNavigationNativePlugin>('ExternalNavigation');

const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:', 'geo:', 'market:']);

function externalUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl, window.location.href);
    if (!EXTERNAL_SCHEMES.has(url.protocol)) return null;
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === window.location.origin) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function openThroughCapacitorNavigation(url: URL): void {
  // Capacitor's WebViewClient intercepts a top-level navigation to a foreign
  // origin and dispatches ACTION_VIEW. Unlike target=_blank, it does not ask
  // WebView to create a second rendering surface. This also works on older
  // APK binaries that do not yet contain ExternalNavigationPlugin.
  window.location.assign(url.toString());
}

/** Open an external URL without involving WebView's target=_blank machinery. */
export async function openExternalUrl(rawUrl: string): Promise<boolean> {
  const url = externalUrl(rawUrl);
  if (!url) return false;
  if (!Capacitor.isPluginAvailable('ExternalNavigation')) {
    openThroughCapacitorNavigation(url);
    return true;
  }
  try {
    await ExternalNavigationNative.open({ url: url.toString() });
  } catch (error) {
    console.warn('[ExternalNavigation] Native plugin unavailable; using WebViewClient fallback:', error);
    openThroughCapacitorNavigation(url);
  }
  return true;
}

/**
 * Route every external anchor/window.open through an Android ACTION_VIEW
 * intent. Keeping the external browser out of the embedded WebView prevents a
 * known Android failure where returning from a target=_blank link leaves the
 * app's WebView surface entirely black while its Activity remains alive.
 */
export function installExternalNavigation(): () => void {
  if (Capacitor.getPlatform() !== 'android' || !Capacitor.isNativePlatform()) {
    return () => {};
  }

  const nativePluginAvailable = Capacitor.isPluginAvailable('ExternalNavigation');
  const launchExternal = (url: URL) => {
    if (!nativePluginAvailable) {
      openThroughCapacitorNavigation(url);
      return;
    }
    void ExternalNavigationNative.open({ url: url.toString() }).catch((error: unknown) => {
      console.warn('[ExternalNavigation] Native open failed; using WebViewClient fallback:', error);
      openThroughCapacitorNavigation(url);
    });
  };

  const handleDocumentClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download')) return;
    const url = externalUrl(anchor.href);
    if (!url) return;

    event.preventDefault();
    event.stopPropagation();
    launchExternal(url);
  };

  const originalWindowOpen = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const parsed = url === undefined ? null : externalUrl(String(url));
    if (parsed) {
      launchExternal(parsed);
      return null;
    }
    return originalWindowOpen(url, target, features);
  }) as typeof window.open;

  document.addEventListener('click', handleDocumentClick, true);
  return () => {
    document.removeEventListener('click', handleDocumentClick, true);
    window.open = originalWindowOpen;
  };
}
