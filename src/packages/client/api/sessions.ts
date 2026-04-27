/**
 * Sessions API client — global (cross-project) session discovery.
 *
 * Pairs with `src/packages/server/routes/sessions.ts` and powers the
 * Session Finder modal.
 */

import { authFetch, apiUrl } from '../utils/storage';

export interface GlobalSessionRow {
  sessionId: string;
  projectPath: string;
  projectDir: string;
  lastModified: string;
  messageCount: number;
  firstPrompt: string;
  sizeBytes: number;
}

export interface GlobalSessionMatch {
  sessionId: string;
  projectPath: string;
  projectDir: string;
  lastModified: string;
  totalMatches: number;
  snippet: string;
  firstPrompt: string;
}

export interface SessionPreviewMessage {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
  timestamp?: string;
  uuid?: string;
}

export async function fetchGlobalSessions(opts?: {
  limit?: number;
  includeMessageCount?: boolean;
}): Promise<GlobalSessionRow[]> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.includeMessageCount) params.set('includeMessageCount', 'true');
  const res = await authFetch(apiUrl(`/api/sessions/global?${params.toString()}`));
  if (!res.ok) throw new Error(`Failed to list sessions: ${res.status}`);
  const data = await res.json();
  return data.sessions || [];
}

export async function searchGlobalSessions(
  query: string,
  opts?: { limit?: number; cwdFilter?: string }
): Promise<GlobalSessionMatch[]> {
  const params = new URLSearchParams({ q: query });
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.cwdFilter) params.set('cwdFilter', opts.cwdFilter);
  const res = await authFetch(apiUrl(`/api/sessions/search?${params.toString()}`));
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const data = await res.json();
  return data.matches || [];
}

export async function previewGlobalSession(
  cwd: string,
  sessionId: string,
  limit = 30
): Promise<{ messages: SessionPreviewMessage[]; totalCount: number }> {
  const params = new URLSearchParams({ cwd, sessionId, limit: String(limit) });
  const res = await authFetch(apiUrl(`/api/sessions/preview?${params.toString()}`));
  if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
  const data = await res.json();
  return { messages: data.messages || [], totalCount: data.totalCount ?? 0 };
}
