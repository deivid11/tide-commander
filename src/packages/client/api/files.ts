import { apiUrl, authFetch } from '../utils/storage';

export interface GlobalFileSearchHit {
  path: string;
  name: string;
  relativePath: string;
  projectName: string;
  projectRoot: string;
  areaId: string;
  areaName: string;
}

/** Filename search across every directory configured on areas. */
export async function searchFilesGlobal(
  query: string,
  options?: { exclude?: string[]; limit?: number }
): Promise<GlobalFileSearchHit[]> {
  const params = new URLSearchParams({ q: query });
  if (options?.limit != null) params.set('limit', String(options.limit));
  if (options?.exclude) params.set('exclude', options.exclude.join(','));
  const response = await authFetch(apiUrl(`/api/files/search-global?${params.toString()}`));
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.error || `Failed to search files: ${response.statusText}`);
  }
  const data = await response.json();
  return Array.isArray(data.files) ? data.files : [];
}

export async function revealInFileExplorer(path: string): Promise<void> {
  const response = await authFetch(apiUrl('/api/files/reveal'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.error || `Failed to open file explorer: ${response.statusText}`);
  }
}
