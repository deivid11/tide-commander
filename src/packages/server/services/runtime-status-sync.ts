import type { AgentProvider } from '../../shared/types.js';
import * as agentService from './agent-service.js';
import { getSessionActivityStatus } from '../claude/session-loader.js';

interface RuntimeStatusSyncDeps {
  log: {
    log: (message: string) => void;
    error: (message: string, err?: unknown) => void;
  };
  getRunnerForAgent: (agentId: string) => { isRunning: (agentId: string) => boolean } | null;
  isProviderProcessRunningInCwd: (provider: AgentProvider, cwd: string) => Promise<boolean>;
  onSessionUpdate: (agentId: string) => void;
}

export interface RuntimeStatusSyncApi {
  pollOrphanedAgents: () => Promise<void>;
  syncAgentStatus: (agentId: string, isStartupSync?: boolean) => Promise<void>;
  syncAllAgentStatus: (isStartupSync?: boolean) => Promise<void>;
}

export function createRuntimeStatusSync(deps: RuntimeStatusSyncDeps): RuntimeStatusSyncApi {
  const { log, getRunnerForAgent, isProviderProcessRunningInCwd, onSessionUpdate } = deps;

  async function pollOrphanedAgents(): Promise<void> {
    const agents = agentService.getAllAgents();

    for (const agent of agents) {
      if (agent.status !== 'working') continue;

      const isTracked = getRunnerForAgent(agent.id)?.isRunning(agent.id) ?? false;
      if (isTracked) continue;
      if (!agent.sessionId || !agent.cwd) continue;

      try {
        const activity = await getSessionActivityStatus(agent.cwd, agent.sessionId, 60);

        if (activity && activity.isActive) {
          onSessionUpdate(agent.id);
        } else if (activity && !activity.isActive) {
          const provider = agent.provider ?? 'claude';
          const hasOrphanedProcess = await isProviderProcessRunningInCwd(provider, agent.cwd);

          if (!hasOrphanedProcess) {
            log.log(`Orphaned agent ${agent.id} has no activity - marking as idle`);
            agentService.updateAgent(agent.id, {
              status: 'idle',
              currentTask: undefined,
              currentTool: undefined,
              isDetached: false,
            });
          }
        }
      } catch (err) {
        log.error(`Failed to poll orphaned agent ${agent.id}:`, err);
      }
    }
  }

  async function syncAgentStatus(agentId: string, isStartupSync: boolean = false): Promise<void> {
    const agent = agentService.getAgent(agentId);
    if (!agent) return;

    const isTrackedProcess = getRunnerForAgent(agentId)?.isRunning(agentId) ?? false;
    if (isTrackedProcess) return;

    let isRecentlyActive = false;
    let hasOrphanedProcess = false;

    if (agent.sessionId && agent.cwd) {
      try {
        const activity = await getSessionActivityStatus(agent.cwd, agent.sessionId, 60);
        if (activity) {
          isRecentlyActive = activity.isActive;
        }
      } catch {
        // Session activity check failed, assume not active.
      }

      if (agent.status === 'idle') {
        try {
          const provider = agent.provider ?? 'claude';
          hasOrphanedProcess = await isProviderProcessRunningInCwd(provider, agent.cwd);
          if (hasOrphanedProcess) {
            log.log(`[syncAgentStatus] Agent ${agentId}: Found orphaned ${provider} process, isRecentlyActive=${isRecentlyActive}`);
          }
        } catch (err) {
          log.error(`[syncAgentStatus] Agent ${agentId}: Failed to check for orphaned process:`, err);
        }
      }
    }

    if (agent.status === 'working' && !isRecentlyActive && !hasOrphanedProcess) {
      agentService.updateAgent(agentId, {
        status: 'idle',
        currentTask: undefined,
        currentTool: undefined,
        isDetached: false,
      });
    } else if (agent.status === 'idle' && hasOrphanedProcess && isRecentlyActive) {
      const provider = agent.provider ?? 'claude';
      log.log(`Agent ${agentId} has orphaned ${provider} process with recent activity - marking as working (detached)`);
      agentService.updateAgent(agentId, {
        status: 'working',
        currentTask: 'Processing (detached)...',
        isDetached: true,
      });
    } else if (isStartupSync && agent.status === 'idle' && isRecentlyActive) {
      agentService.updateAgent(agentId, {
        status: 'working',
        currentTask: 'Processing...',
      });
    }
  }

  async function syncAllAgentStatus(isStartupSync: boolean = false): Promise<void> {
    const agents = agentService.getAllAgents();
    await Promise.all(agents.map((agent) => syncAgentStatus(agent.id, isStartupSync)));
  }

  return {
    pollOrphanedAgents,
    syncAgentStatus,
    syncAllAgentStatus,
  };
}
