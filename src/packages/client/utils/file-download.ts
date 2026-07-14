import { Capacitor, registerPlugin } from '@capacitor/core';
import { authFetch, getAuthToken } from './storage';

interface FileDownloadNativePlugin {
  download(options: {
    url: string;
    filename: string;
    mimeType?: string;
    headers?: Record<string, string>;
  }): Promise<{ uri: string; filename: string }>;
}

const FileDownloadNative = registerPlugin<FileDownloadNativePlugin>('FileDownload');

/**
 * Download an authenticated server URL. Android must save through native APIs:
 * WebView silently ignores anchor downloads whose href is a blob URL.
 */
export async function downloadServerFile(
  url: string,
  filename: string,
  mimeType?: string,
): Promise<void> {
  if (Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('FileDownload')) {
    const token = getAuthToken();
    await FileDownloadNative.download({
      url,
      filename,
      mimeType,
      headers: token ? { 'X-Auth-Token': token } : undefined,
    });
    return;
  }

  const response = await authFetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText || 'Download failed'}`.trim());
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
