import type {
  AgentProvider,
  ClaudeEffort,
  CodexConfig,
  SessionTransferMode,
  SessionTransferResponse,
} from '../../shared/types';
import { providerDisplayName } from '../../shared/types';
import { apiUrl, authFetch } from '../utils/storage';

export interface ConvertAgentRuntimeRequest {
  /** Runtime the agent should run on after the migration. */
  targetProvider: AgentProvider;
  mode: SessionTransferMode;
  /** Model on the target runtime (Claude alias, Codex/Grok/OpenCode id, or Pi provider/model). */
  model?: string;
  effort?: ClaudeEffort | null;
  /** Only used when targetProvider === 'codex'. */
  codexConfig?: CodexConfig;
  stopActive?: boolean;
}

/**
 * Migrate an agent to another harness. When the target has a writable native
 * session store the source conversation is imported (smart/full); every
 * runtime supports 'fresh'.
 */
export async function convertAgentRuntime(
  agentId: string,
  request: ConvertAgentRuntimeRequest,
): Promise<SessionTransferResponse> {
  const response = await authFetch(apiUrl(`/api/agents/${agentId}/convert-runtime`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    let message = `Failed to convert session to ${providerDisplayName(request.targetProvider)} (HTTP ${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.error === 'string' && body.error) message = body.error;
    } catch {
      // Keep the HTTP fallback when the server did not return JSON.
    }
    throw new Error(message);
  }

  return (await response.json()) as SessionTransferResponse;
}

/** @deprecated Use convertAgentRuntime with targetProvider: 'pi'. */
export async function convertAgentToPi(
  agentId: string,
  request: Omit<ConvertAgentRuntimeRequest, 'targetProvider' | 'model'> & { piModel?: string },
): Promise<SessionTransferResponse> {
  const { piModel, ...rest } = request;
  return convertAgentRuntime(agentId, { ...rest, targetProvider: 'pi', model: piModel });
}
