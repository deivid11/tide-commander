/**
 * Built-in Skills
 *
 * These are core Tide Commander skills that ship with the application.
 * They cannot be modified or deleted by users.
 */

import type { Skill } from '../../../shared/types.js';
import type { BuiltinSkillDefinition } from './types.js';

// Import individual skills
import { fullNotifications } from './full-notifications.js';
import { sendMessageToAgent } from './send-message-to-agent.js';
import { gitCaptain } from './git-captain.js';
import { serverLogs } from './server-logs.js';

// Re-export types
export type { BuiltinSkillDefinition } from './types.js';

/**
 * All built-in skills that ship with Tide Commander
 */
export const BUILTIN_SKILLS: BuiltinSkillDefinition[] = [
  fullNotifications,
  sendMessageToAgent,
  gitCaptain,
  serverLogs,
];

/**
 * Get the ID for a built-in skill based on its slug
 * Built-in skills use a predictable ID format: "builtin-{slug}"
 */
export function getBuiltinSkillId(slug: string): string {
  return `builtin-${slug}`;
}

/**
 * Check if a skill ID is a built-in skill
 */
export function isBuiltinSkillId(id: string): boolean {
  return id.startsWith('builtin-');
}

/**
 * Convert a built-in skill definition to a full Skill object
 */
export function createBuiltinSkill(definition: BuiltinSkillDefinition): Skill {
  const now = Date.now();
  return {
    id: getBuiltinSkillId(definition.slug),
    slug: definition.slug,
    name: definition.name,
    description: definition.description,
    content: definition.content,
    allowedTools: definition.allowedTools,
    model: definition.model,
    context: definition.context,
    assignedAgentIds: [],
    assignedAgentClasses: definition.assignedAgentClasses || [],
    enabled: true,
    builtin: true,
    createdAt: now,
    updatedAt: now,
  };
}
