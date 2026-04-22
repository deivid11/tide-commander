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
  syncAgentStatus: (agentId: string) => Promise<void>;
  syncAllAgentStatus: () => Promise<void>;
}

export function createRuntimeStatusSync(deps: RuntimeStatusSyncDeps): RuntimeStatusSyncApi {
  const { log, getRunnerForAgent, isProviderProcessRunningInCwd, onSessionUpdate } = deps;

  // Safety fallback: when activity can't be determined from a session file,
  // flip an untracked 'working' agent to 'idle' after this many seconds past
  // its last assigned task. Prevents agents from being stuck 'working' forever
  // on providers without session-file activity integration, or when the
  // session file lookup fails for any reason.
  const NULL_ACTIVITY_STALE_SECONDS = 30;

  async function pollOrphanedAgents(): Promise<void> {
    const agents = agentService.getAllAgents();

    for (const agent of agents) {
      if (agent.status !== 'working') continue;

      const isTracked = getRunnerForAgent(agent.id)?.isRunning(agent.id) ?? false;
      if (isTracked) continue;
      if (!agent.sessionId || !agent.cwd) continue;

      try {
        const activity = await getSessionActivityStatus(agent.cwd, agent.sessionId, 60);
        const provider = agent.provider ?? 'claude';

        if (activity && activity.isActive) {
          onSessionUpdate(agent.id);
          continue;
        }

        if (activity && !activity.isActive) {
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
          continue;
        }

        // activity === null: session file couldn't be resolved. Fall back to
        // wall-clock staleness + absence of an orphaned provider process so
        // agents don't get stuck in 'working' indefinitely.
        const lastTaskMs = agent.lastAssignedTaskTime ?? agent.lastActivity ?? 0;
        const ageSeconds = lastTaskMs > 0 ? (Date.now() - lastTaskMs) / 1000 : Infinity;
        if (ageSeconds < NULL_ACTIVITY_STALE_SECONDS) continue;

        const hasOrphanedProcess = await isProviderProcessRunningInCwd(provider, agent.cwd);
        if (hasOrphanedProcess) continue;

        log.log(`Orphaned agent ${agent.id} (${provider}) has null session activity and no live process after ${ageSeconds.toFixed(0)}s - marking as idle`);
        agentService.updateAgent(agent.id, {
          status: 'idle',
          currentTask: undefined,
          currentTool: undefined,
          isDetached: false,
        });
      } catch (err) {
        log.error(`Failed to poll orphaned agent ${agent.id}:`, err);
      }
    }
  }

  async function syncAgentStatus(agentId: string): Promise<void> {
    const agent = agentService.getAgent(agentId);
    if (!agent) return;
    // Only working agents need sync — idle agents stay idle.
    // We intentionally do NOT promote idle agents to working based on
    // orphaned processes or session activity. That caused agents to
    // incorrectly resume after backend restarts/reconnects.
    if (agent.status !== 'working') return;

    const isTrackedProcess = getRunnerForAgent(agentId)?.isRunning(agentId) ?? false;
    if (isTrackedProcess) return;

    let isRecentlyActive = false;

    if (agent.sessionId && agent.cwd) {
      try {
        const activity = await getSessionActivityStatus(agent.cwd, agent.sessionId, 60);
        if (activity) {
          isRecentlyActive = activity.isActive;
        }
      } catch {
        // Session activity check failed, assume not active.
      }
    }

    if (!isRecentlyActive) {
      agentService.updateAgent(agentId, {
        status: 'idle',
        currentTask: undefined,
        currentTool: undefined,
        isDetached: false,
      });
    }
  }

  async function syncAllAgentStatus(): Promise<void> {
    const agents = agentService.getAllAgents();
    await Promise.all(agents.map((agent) => syncAgentStatus(agent.id)));
  }

  return {
    pollOrphanedAgents,
    syncAgentStatus,
    syncAllAgentStatus,
  };
}
