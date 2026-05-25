import { apiUrl, authFetch } from '../utils/storage';

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
