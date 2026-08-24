import { Capacitor, registerPlugin } from '@capacitor/core';
import { apiUrl, authFetch, getAuthToken } from './storage';

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

// ── Download URLs + native drag-out (merged from the former fileDownload.ts) ──
/** Absolute, self-authenticating URL — safe to hand to the browser or the OS. */
function absoluteAuthedUrl(path: string, params: Record<string, string>): string {
  const url = new URL(apiUrl(path), window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const token = getAuthToken();
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

/** URL that streams `dirPath` as a .zip named after the folder. */
export function folderZipUrl(dirPath: string): string {
  return absoluteAuthedUrl('/api/files/download-folder', { path: dirPath });
}

/** URL that downloads a single file as an attachment. */
export function fileDownloadUrl(filePath: string): string {
  return absoluteAuthedUrl('/api/files/binary', { path: filePath, download: 'true' });
}

/**
 * Turn a src the app renders (relative, or an authed /api/files URL) into an
 * absolute, self-authenticating one — so something OUTSIDE the app's fetch
 * wrapper (headless Chrome printing a PDF, a native drag-out) can load it.
 * Already-absolute foreign URLs are returned untouched.
 */
export function absolutizeAssetUrl(src: string): string {
  const url = new URL(src, window.location.origin);
  if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
    const token = getAuthToken();
    if (token) url.searchParams.set('token', token);
  }
  return url.toString();
}

/** Trigger a browser download without navigating away from the app. */
export function triggerBrowserDownload(
  url: string,
  suggestedName?: string,
  preserveCurrentPage = false,
): void {
  const link = document.createElement('a');
  link.href = url;
  // Only a hint: a cross-origin response's Content-Disposition wins, which is
  // what actually names these files.
  if (suggestedName) link.download = suggestedName;
  // Streaming ZIP responses are not consistently recognized as downloads by
  // WebViews. Never let that response replace Tide Commander: a failed or
  // unsupported download may open separately, but cannot blank the app.
  if (preserveCurrentPage) link.target = '_blank';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function downloadFolder(dirPath: string, folderName?: string): void {
  const url = folderZipUrl(dirPath);
  const filename = `${folderName || 'folder'}.zip`;

  // Android WebView does not reliably honor Content-Disposition for streamed
  // ZIPs and can navigate the whole Commander view to the binary response.
  // Route it through the native Downloads provider instead.
  if (Capacitor.getPlatform() === 'android') {
    void downloadServerFile(url, filename, 'application/zip').catch((error: unknown) => {
      console.error('Folder download failed:', error);
    });
    return;
  }

  triggerBrowserDownload(url, filename, true);
}

export function downloadFile(filePath: string, fileName?: string): void {
  triggerBrowserDownload(fileDownloadUrl(filePath), fileName);
}

/**
 * Make a tree row draggable straight out of the browser into any OS app.
 *
 * The magic is the `DownloadURL` DataTransfer type: on drop, Chromium fetches
 * the URL itself and writes a real file wherever it landed (Finder, VS Code, a
 * mail composer). It is Chromium-only — Firefox and Safari ignore it and fall
 * back to the plain text/uri-list, which drops a link instead of a file. Folders
 * ride the same path as a .zip, since the OS has no way to receive a stream of
 * loose files from a web page.
 */
export function setNativeFileDrag(
  dataTransfer: DataTransfer,
  node: { path: string; name: string; isDirectory: boolean },
): void {
  const isDir = node.isDirectory;
  const url = isDir ? folderZipUrl(node.path) : fileDownloadUrl(node.path);
  const fileName = isDir ? `${node.name}.zip` : node.name;
  const mime = isDir ? 'application/zip' : 'application/octet-stream';

  // Chromium's format is strict: mime:filename:url, colon-separated, and the
  // filename must not contain a colon or the URL gets truncated at it.
  dataTransfer.setData('DownloadURL', `${mime}:${fileName.replace(/:/g, '_')}:${url}`);
  // Fallbacks for everything that is not Chromium, and for drops into text
  // editors / chat boxes where a path is more useful than a file.
  dataTransfer.setData('text/uri-list', url);
  dataTransfer.setData('text/plain', node.path);
  dataTransfer.effectAllowed = 'copy';
}
