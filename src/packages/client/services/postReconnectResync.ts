/**
 * Post-reconnect resync.
 *
 * After a WS reconnect, the server pushes an `agents_update` snapshot, but its
 * status fields race the server's background `syncAllAgentStatus`. We pull
 * `GET /api/agents` to obtain the authoritative status list and merge it into
 * the store. Per-agent history refetch is already wired through `reconnectCount`
 * in useHistoryLoader.ts and useAgentHistory.ts; this service only ensures the
 * agent map itself is refreshed.
 */

import type { Agent } from '../../shared/types';
import { store } from '../store';
import { apiUrl, authFetch } from '../utils/storage';

interface ResyncDeps {
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  applyAgents?: (agents: Agent[]) => void;
  setResyncFlag?: (value: boolean) => void;
}

export async function runPostReconnectResync(deps: ResyncDeps = {}): Promise<{
  ok: boolean;
  agents?: Agent[];
  error?: unknown;
}> {
  const fetcher = deps.fetcher ?? authFetch;
  const applyAgents = deps.applyAgents ?? ((list: Agent[]) => store.setAgents(list));
  const setResyncFlag = deps.setResyncFlag ?? ((v: boolean) => store.setResyncInProgress(v));

  setResyncFlag(true);
  try {
    const res = await fetcher(apiUrl('/api/agents'));
    if (!res.ok) {
      return { ok: false, error: new Error(`HTTP ${res.status}`) };
    }
    const payload = (await res.json()) as Agent[] | { agents?: Agent[] };
    const agents = Array.isArray(payload) ? payload : Array.isArray(payload.agents) ? payload.agents : [];
    applyAgents(agents);
    return { ok: true, agents };
  } catch (error) {
    return { ok: false, error };
  } finally {
    setResyncFlag(false);
  }
}
