/**
 * Subordinate Context Service
 * Builds detailed context about boss agent's subordinates for injection into messages
 */

import type { BuiltInAgentClass, Agent } from '../../shared/types.js';
import { BUILT_IN_AGENT_CLASSES } from '../../shared/types.js';
import * as bossService from './boss-service.js';
import * as supervisorService from './supervisor-service.js';
import * as skillService from './skill-service.js';
import * as customClassService from './custom-class-service.js';
import { loadSession, loadToolHistory } from '../claude/session-loader.js';
import { truncate } from '../utils/index.js';

/**
 * Format time since a timestamp (e.g., "5m", "2h", "1d 3h")
 */
export function formatTimeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/**
 * Build session conversation section for a subordinate
 */
async function buildConversationSection(sub: Agent): Promise<string> {
  if (!sub.sessionId) return '';

  try {
    const session = await loadSession(sub.cwd, sub.sessionId, 10);
    if (!session || session.messages.length === 0) return '';

    const recentMessages = session.messages.slice(-6);
    const conversationLines = recentMessages.map(msg => {
      const role = msg.type === 'user' ? '👤 User' :
                  msg.type === 'assistant' ? '🤖 Claude' :
                  msg.type === 'tool_use' ? `🔧 Tool: ${msg.toolName}` :
                  '📤 Result';
      const content = truncate(msg.content, 120) || '(empty)';
      return `  - **${role}**: ${content}`;
    });
    return `\n### Recent Conversation:\n${conversationLines.join('\n')}`;
  } catch {
    return '';
  }
}

/**
 * Build file changes section for a subordinate
 */
async function buildFileChangesSection(sub: Agent): Promise<string> {
  if (!sub.sessionId) return '';

  try {
    const { fileChanges } = await loadToolHistory(sub.cwd, sub.sessionId, sub.id, sub.name, 20);
    if (fileChanges.length === 0) return '';

    const fileLines = fileChanges.map(fc => {
      const actionIcon = fc.action === 'created' ? '✨' :
                        fc.action === 'modified' ? '📝' :
                        fc.action === 'deleted' ? '🗑️' :
                        fc.action === 'read' ? '📖' : '📄';
      const timeSince = formatTimeSince(fc.timestamp);
      const shortPath = fc.filePath.length > 60 ? '...' + fc.filePath.slice(-57) : fc.filePath;
      return `  - ${actionIcon} \`${shortPath}\` (${timeSince} ago)`;
    });
    return `\n### File History (Last ${fileChanges.length}):\n${fileLines.join('\n')}`;
  } catch {
    return '';
  }
}

/**
 * Build capabilities section for a subordinate
 */
function buildCapabilitiesSection(sub: Agent, agentClass: string): string {
  let section = '';
  const customClass = customClassService.getCustomClass(agentClass);
  const isBuiltIn = agentClass in BUILT_IN_AGENT_CLASSES;

  if (customClass) {
    const instructionsSummary = customClass.instructions
      ? truncate(customClass.instructions.replace(/\n/g, ' ').trim(), 150)
      : null;

    section = `\n### Capabilities:
- **Class Type**: Custom Class "${customClass.name}" ${customClass.icon}
- **Specialization**: ${customClass.description}`;

    if (instructionsSummary) {
      section += `\n- **Custom Instructions**: ${instructionsSummary}`;
    }
  } else if (isBuiltIn) {
    const builtInConfig = BUILT_IN_AGENT_CLASSES[agentClass as BuiltInAgentClass];
    section = `\n### Capabilities:
- **Class Type**: ${builtInConfig.icon} ${agentClass.charAt(0).toUpperCase() + agentClass.slice(1)} (built-in)
- **Specialization**: ${builtInConfig.description}`;
  }

  // Get agent skills
  const agentSkills = skillService.getSkillsForAgent(sub.id, sub.class);
  if (agentSkills.length > 0) {
    const skillsList = agentSkills.map(s => s.name).join(', ');
    section += `\n- **Skills**: ${skillsList}`;
  }

  return section;
}

/**
 * Build supervisor status updates section
 */
function buildSupervisorSection(agentId: string): string {
  const history = supervisorService.getAgentSupervisorHistory(agentId);
  if (!history.entries || history.entries.length === 0) return '';

  const updates = history.entries.slice(0, 3).map((entry) => {
    const analysis = entry.analysis;
    const timeSince = formatTimeSince(entry.timestamp);
    const progress = analysis?.progress || 'unknown';
    const progressEmoji = progress === 'on_track' ? '🟢' :
                         progress === 'completed' ? '✅' :
                         progress === 'idle' ? '💤' :
                         progress === 'stalled' ? '🟡' :
                         progress === 'blocked' ? '🔴' : '⚪';

    const lines: string[] = [];
    lines.push(`#### ${progressEmoji} [${timeSince} ago] ${analysis?.statusDescription || 'No status'}`);

    if (analysis?.recentWorkSummary) {
      lines.push(`> 📝 ${analysis.recentWorkSummary}`);
    }
    if (analysis?.currentFocus && analysis.currentFocus !== analysis.statusDescription) {
      lines.push(`> 🎯 **Focus**: ${analysis.currentFocus}`);
    }
    if (analysis?.blockers && analysis.blockers.length > 0) {
      lines.push(`> 🚧 **Blockers**: ${analysis.blockers.join(', ')}`);
    }
    if (analysis?.suggestions && analysis.suggestions.length > 0) {
      lines.push(`> 💡 **Suggestions**: ${analysis.suggestions.join('; ')}`);
    }
    if (analysis?.filesModified && analysis.filesModified.length > 0) {
      lines.push(`> 📁 **Files**: ${analysis.filesModified.slice(0, 5).join(', ')}`);
    }
    if (analysis?.concerns && analysis.concerns.length > 0) {
      lines.push(`> ⚠️ **Concerns**: ${analysis.concerns.join('; ')}`);
    }

    return lines.join('\n');
  });

  return `\n### Supervisor Status Updates:\n${updates.join('\n\n')}`;
}

/**
 * Build detailed context about boss's subordinates for injection into user message.
 * Returns null if boss has no subordinates.
 */
export async function buildBossContext(bossId: string): Promise<string | null> {
  const contexts = await bossService.gatherSubordinateContext(bossId);
  const subordinates = bossService.getSubordinates(bossId);

  if (contexts.length === 0) {
    return null;
  }

  // Build detailed subordinate info with session history and supervisor analysis
  const subordinateDetails = await Promise.all(contexts.map(async (ctx, i) => {
    const sub = subordinates[i];
    const history = supervisorService.getAgentSupervisorHistory(ctx.id);

    // Get working directory
    const cwd = sub?.cwd || 'Unknown';

    // Get last assigned task with time
    const lastTask = ctx.lastAssignedTask || sub?.lastAssignedTask;
    const lastTaskTime = sub?.lastAssignedTaskTime;
    let lastTaskInfo = 'None';
    if (lastTask) {
      const timeSince = lastTaskTime ? formatTimeSince(lastTaskTime) : '';
      lastTaskInfo = `"${truncate(lastTask, 200)}"${timeSince ? ` (${timeSince} ago)` : ''}`;
    }

    // Calculate idle time
    const idleTime = sub ? formatTimeSince(sub.lastActivity) : 'Unknown';

    // Get latest analysis summary
    const latestAnalysis = history.entries[0]?.analysis;
    const statusDesc = latestAnalysis?.statusDescription || ctx.status;

    // Build sections
    const conversationSection = sub ? await buildConversationSection(sub) : '';
    const fileChangesSection = sub ? await buildFileChangesSection(sub) : '';
    const capabilitiesSection = sub ? buildCapabilitiesSection(sub, ctx.class) : '';
    const supervisorSection = buildSupervisorSection(ctx.id);

    return `## ${ctx.name} (${ctx.class})
- **Agent ID**: \`${ctx.id}\`
- **Status**: ${statusDesc} (${ctx.status})
- **Idle Time**: ${idleTime}
- **Last Assigned Task**: ${lastTaskInfo}
- **Working Directory**: ${cwd}
- **Context Usage**: ${ctx.contextPercent}% (${ctx.tokensUsed?.toLocaleString() || 0} tokens)${capabilitiesSection}${fileChangesSection}${conversationSection}${supervisorSection}`;
  }));

  // Get recent delegation history for this boss
  const delegationHistory = bossService.getDelegationHistory(bossId).slice(0, 5);
  const delegationSummary = delegationHistory.length > 0
    ? delegationHistory.map(d => {
        const time = formatTimeSince(d.timestamp);
        return `- [${time} ago] "${truncate(d.userCommand, 60)}" → **${d.selectedAgentName}** (${d.confidence})`;
      }).join('\n')
    : 'No recent delegations.';

  return `# YOUR TEAM (${contexts.length} agents)
${subordinateDetails.join('\n\n')}

# RECENT DELEGATION HISTORY
${delegationSummary}`;
}
