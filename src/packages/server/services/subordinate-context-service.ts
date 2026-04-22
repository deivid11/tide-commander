/**
 * Subordinate Context Service
 * Builds detailed context about boss agent's subordinates for injection into messages
 */

import type { Agent } from '../../shared/types.js';
import * as bossService from './boss-service.js';
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
 * Shows last user query and last Claude response for a quick overview
 */
async function buildConversationSection(sub: Agent): Promise<string> {
  if (!sub.sessionId) return '';

  try {
    const session = await loadSession(sub.cwd, sub.sessionId, 20);
    if (!session || session.messages.length === 0) return '';

    // Find last user message and last assistant message
    let lastUserMsg: typeof session.messages[0] | undefined;
    let lastAssistantMsg: typeof session.messages[0] | undefined;

    // Iterate from most recent to find the last of each type
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i];
      if (!lastUserMsg && msg.type === 'user') {
        lastUserMsg = msg;
      }
      if (!lastAssistantMsg && msg.type === 'assistant') {
        lastAssistantMsg = msg;
      }
      if (lastUserMsg && lastAssistantMsg) break;
    }

    if (!lastUserMsg && !lastAssistantMsg) return '';

    const lines: string[] = [];
    if (lastUserMsg) {
      const content = truncate(lastUserMsg.content, 200) || '(empty)';
      lines.push(`  - **👤 Last Query**: ${content}`);
    }
    if (lastAssistantMsg) {
      const content = truncate(lastAssistantMsg.content, 200) || '(empty)';
      lines.push(`  - **🤖 Last Response**: ${content}`);
    }

    return `\n### Recent Conversation:\n${lines.join('\n')}`;
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
 * Build detailed context about boss's subordinates for injection into user message.
 * Returns null if boss has no subordinates.
 */
export async function buildBossContext(bossId: string): Promise<string | null> {
  const contexts = await bossService.gatherSubordinateContext(bossId);
  const subordinates = bossService.getSubordinates(bossId);

  if (contexts.length === 0) {
    return null;
  }

  const subordinateDetails = await Promise.all(contexts.map(async (ctx, i) => {
    const sub = subordinates[i];

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

    // Build sections
    const conversationSection = sub ? await buildConversationSection(sub) : '';
    const fileChangesSection = sub ? await buildFileChangesSection(sub) : '';

    return `## ${ctx.name}
- **Agent ID**: \`${ctx.id}\`
- **Status**: ${ctx.status}
- **Idle Time**: ${idleTime}
- **Last Assigned Task**: ${lastTaskInfo}
- **Context**: ${ctx.contextPercent}%${fileChangesSection}${conversationSection}`;
  }));

  // Get recent delegation history for this boss
  const delegationHistory = bossService.getDelegationHistory(bossId).slice(0, 5);
  const delegationSummary = delegationHistory.length > 0
    ? delegationHistory.map(d => {
        const time = formatTimeSince(d.timestamp);
        return `- [${time} ago] "${truncate(d.userCommand, 60)}" → **${d.selectedAgentName}** (${d.confidence})`;
      }).join('\n')
    : 'No recent delegations.';

  return `# TEAM:
${subordinateDetails.join('\n\n')}

# RECENT DELEGATION HISTORY
${delegationSummary}

**REMINDER: Remember to delegate tasks to your subordinates as your instructions describe.**`;
}
