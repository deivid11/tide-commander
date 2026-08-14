/**
 * Download + native drag-out helpers for the file trees.
 *
 * Both features need the SAME thing the rest of the app never needs: a URL the
 * BROWSER itself can fetch, with no `X-Auth-Token` header. A native download and
 * a drag-out to Finder/Explorer are performed by the browser outside our fetch
 * wrapper, so the token has to ride in the query string (the server accepts it
 * there — see extractTokenFromRequest).
 */

import { apiUrl, getAuthToken } from './storage';

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

/** Trigger a browser download without navigating away from the app. */
export function triggerBrowserDownload(url: string, suggestedName?: string): void {
  const link = document.createElement('a');
  link.href = url;
  // Only a hint: a cross-origin response's Content-Disposition wins, which is
  // what actually names these files.
  if (suggestedName) link.download = suggestedName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function downloadFolder(dirPath: string, folderName?: string): void {
  triggerBrowserDownload(folderZipUrl(dirPath), `${folderName || 'folder'}.zip`);
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
