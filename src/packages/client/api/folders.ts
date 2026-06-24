/**
 * Folder / git-repo search API client.
 * Backs the Spotlight "Folders" results — see GET /api/folders/search.
 */

import { apiUrl, authFetch } from '../utils/storage';

export interface FolderSearchResult {
  path: string;
  name: string;
  isGitRepo: boolean;
  gitBranch?: string;
}

/** Search discoverable folders / git repos by name. Returns [] for short queries. */
export async function searchFolders(query: string): Promise<FolderSearchResult[]> {
  const params = new URLSearchParams({ q: query });
  const response = await authFetch(apiUrl(`/api/folders/search?${params.toString()}`));
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.error || `Failed to search folders: ${response.statusText}`);
  }
  const data = await response.json();
  return Array.isArray(data.folders) ? data.folders : [];
}
