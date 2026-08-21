import { absolutizeAssetUrl, triggerBrowserDownload } from './file-download';
import { apiUrl, authFetch } from './storage';

function safeFilename(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'agent-response';
}

/** Export an already-rendered Markdown element through the shared Chrome PDF endpoint. */
export async function exportMarkdownElementToPdf(
  element: HTMLElement,
  title = 'Agent response',
  filename = title,
): Promise<void> {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:')) return;
    try {
      img.setAttribute('src', absolutizeAssetUrl(src));
    } catch {
      // Keep the original source; only that image may be absent from the PDF.
    }
  });

  const response = await authFetch(apiUrl('/api/files/markdown-pdf'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html: clone.innerHTML, title }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `PDF export failed (${response.status})`);
  }

  const blobUrl = URL.createObjectURL(await response.blob());
  triggerBrowserDownload(blobUrl, `${safeFilename(filename)}.pdf`);
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
}
