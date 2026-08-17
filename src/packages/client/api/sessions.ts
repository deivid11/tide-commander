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
  /** Which CLI owns the session ('claude' | 'grok' | …). Absent on older servers. */
  provider?: string;
}

/** Who produced a conversation extract — drives the per-line color. */
export type SessionExtractKind = 'user' | 'assistant' | 'tool' | 'raw';

export interface SessionExtract {
  text: string;
  kind: SessionExtractKind;
}

export interface GlobalSessionMatch {
  sessionId: string;
  projectPath: string;
  projectDir: string;
  lastModified: string;
  totalMatches: number;
  snippet: string;
  /** Up to 4 distinct extracts, best-first (user prompts containing the query,
   * then agent text/reasoning, then tool output), each tagged with who said
   * it. Absent on older servers. */
  extracts?: SessionExtract[];
  firstPrompt: string;
  /** Which CLI owns the session ('claude' | 'grok' | …). Absent on older servers. */
  provider?: string;
  /** Agent that owns the conversation — resolved through CURRENT sessions and
   * archived session history, so it survives the agent rotating sessions. */
  agentId?: string;
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
  limit = 30,
  q?: string
): Promise<{ messages: SessionPreviewMessage[]; totalCount: number }> {
  const params = new URLSearchParams({ cwd, sessionId, limit: String(limit) });
  if (q) params.set('q', q);
  const res = await authFetch(apiUrl(`/api/sessions/preview?${params.toString()}`));
  if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
  const data = await res.json();
  return { messages: data.messages || [], totalCount: data.totalCount ?? 0 };
}
