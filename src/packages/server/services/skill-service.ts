/**
 * Skill Service
 * Business logic for managing skills that can be assigned to agents
 *
 * Skills are markdown-based instruction sets that teach agents how to perform
 * specific tasks. They can be assigned to individual agents or entire agent classes.
 */

import type { Skill, AgentClass, Agent } from '../../shared/types.js';
import { loadSkills, saveSkills } from '../data/index.js';
import { createLogger, generateId, generateSlug } from '../utils/index.js';
import { BUILTIN_SKILLS, createBuiltinSkill, isBuiltinSkillId } from '../data/builtin-skills.js';

const log = createLogger('SkillService');

// In-memory skill storage
const skills = new Map<string, Skill>();

// Listeners for skill changes
type SkillListener = (event: string, skill: Skill | string) => void;
const listeners = new Set<SkillListener>();

// Track agents that have pending skill updates (need to be notified on next command)
const pendingSkillUpdates = new Set<string>();

// ============================================================================
// Initialization
// ============================================================================

export function initSkills(): void {
  try {
    // First, load user-created skills from disk
    const storedSkills = loadSkills();
    for (const skill of storedSkills) {
      // Skip any old builtin skills from storage (we'll recreate them fresh)
      if (skill.builtin) continue;
      skills.set(skill.id, skill);
    }
    log.log(` Loaded ${skills.size} user skills`);

    // Then, ensure all built-in skills exist
    let builtinCount = 0;
    for (const definition of BUILTIN_SKILLS) {
      const builtinSkill = createBuiltinSkill(definition);
      // Always set builtin skills (overwrite any existing to ensure latest content)
      skills.set(builtinSkill.id, builtinSkill);
      builtinCount++;
    }
    log.log(` Loaded ${builtinCount} built-in skills`);

    // Persist to ensure builtin skills are saved (in case this is first run)
    persistSkills();
  } catch (err) {
    log.error(' Failed to load skills:', err);
  }
}

export function persistSkills(): void {
  try {
    saveSkills(Array.from(skills.values()));
  } catch (err) {
    log.error(' Failed to save skills:', err);
  }
}

// ============================================================================
// Event System
// ============================================================================

export function subscribe(listener: SkillListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: string, data: Skill | string): void {
  listeners.forEach((listener) => listener(event, data));
}

// ============================================================================
// Skill CRUD
// ============================================================================

export function getSkill(id: string): Skill | undefined {
  return skills.get(id);
}

export function getSkillBySlug(slug: string): Skill | undefined {
  return Array.from(skills.values()).find(s => s.slug === slug);
}

export function getAllSkills(): Skill[] {
  return Array.from(skills.values());
}

/**
 * Ensure slug is unique by appending a number if needed
 */
function ensureUniqueSlug(baseSlug: string, excludeId?: string): string {
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const existing = getSkillBySlug(slug);
    if (!existing || existing.id === excludeId) {
      return slug;
    }
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

export interface CreateSkillInput {
  name: string;
  slug?: string;
  description: string;
  content: string;
  allowedTools?: string[];
  model?: string;
  context?: 'fork' | 'inline';
  assignedAgentIds?: string[];
  assignedAgentClasses?: AgentClass[];
  enabled?: boolean;
}

export function createSkill(input: CreateSkillInput): Skill {
  const id = generateId();
  const baseSlug = input.slug || generateSlug(input.name);
  const slug = ensureUniqueSlug(baseSlug);

  const skill: Skill = {
    id,
    name: input.name,
    slug,
    description: input.description,
    content: input.content,
    allowedTools: input.allowedTools || [],
    model: input.model,
    context: input.context,
    assignedAgentIds: input.assignedAgentIds || [],
    assignedAgentClasses: input.assignedAgentClasses || [],
    enabled: input.enabled ?? true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  skills.set(id, skill);
  persistSkills();
  emit('created', skill);

  log.log(` Created skill "${skill.name}" (${skill.id})`);
  return skill;
}

export function updateSkill(id: string, updates: Partial<Skill>): Skill | undefined {
  const skill = skills.get(id);
  if (!skill) {
    log.error(` Skill not found: ${id}`);
    return undefined;
  }

  // Protect built-in skills from content/name/description changes
  if (skill.builtin) {
    // Only allow assignment changes for builtin skills
    const allowedKeys = ['assignedAgentIds', 'assignedAgentClasses', 'enabled'];
    const attemptedKeys = Object.keys(updates);
    const disallowedKeys = attemptedKeys.filter(k => !allowedKeys.includes(k));

    if (disallowedKeys.length > 0) {
      log.error(` Cannot modify built-in skill "${skill.name}": ${disallowedKeys.join(', ')}`);
      return undefined;
    }
  }

  // If name is being updated, regenerate slug if not explicitly provided
  if (updates.name && !updates.slug) {
    const baseSlug = generateSlug(updates.name);
    updates.slug = ensureUniqueSlug(baseSlug, id);
  }

  // If slug is being updated, ensure uniqueness
  if (updates.slug) {
    updates.slug = ensureUniqueSlug(updates.slug, id);
  }

  const updatedSkill: Skill = {
    ...skill,
    ...updates,
    updatedAt: Date.now(),
  };

  skills.set(id, updatedSkill);
  persistSkills();
  emit('updated', updatedSkill);

  log.log(` Updated skill "${updatedSkill.name}" (${id})`);
  return updatedSkill;
}

export function deleteSkill(id: string): boolean {
  const skill = skills.get(id);
  if (!skill) {
    log.error(` Skill not found: ${id}`);
    return false;
  }

  // Protect built-in skills from deletion
  if (skill.builtin) {
    log.error(` Cannot delete built-in skill "${skill.name}"`);
    return false;
  }

  skills.delete(id);
  persistSkills();
  emit('deleted', id);

  log.log(` Deleted skill "${skill.name}" (${id})`);
  return true;
}

// ============================================================================
// Agent Assignment
// ============================================================================

export function assignSkillToAgent(skillId: string, agentId: string): Skill | undefined {
  const skill = skills.get(skillId);
  if (!skill) {
    log.error(` Skill not found: ${skillId}`);
    return undefined;
  }

  if (skill.assignedAgentIds.includes(agentId)) {
    log.log(` Skill "${skill.name}" already assigned to agent ${agentId}`);
    return skill;
  }

  const updatedSkill: Skill = {
    ...skill,
    assignedAgentIds: [...skill.assignedAgentIds, agentId],
    updatedAt: Date.now(),
  };

  skills.set(skillId, updatedSkill);
  persistSkills();
  // Use 'assigned' event for assignment changes - this doesn't restart agents
  // unlike 'updated' which is for content changes that require agent restarts
  emit('assigned', updatedSkill);

  // Mark agent as having pending skill updates (will be injected on next command)
  pendingSkillUpdates.add(agentId);

  log.log(` Assigned skill "${skill.name}" to agent ${agentId}`);
  return updatedSkill;
}

export function unassignSkillFromAgent(skillId: string, agentId: string): Skill | undefined {
  const skill = skills.get(skillId);
  if (!skill) {
    log.error(` Skill not found: ${skillId}`);
    return undefined;
  }

  if (!skill.assignedAgentIds.includes(agentId)) {
    log.log(` Skill "${skill.name}" not assigned to agent ${agentId}`);
    return skill;
  }

  const updatedSkill: Skill = {
    ...skill,
    assignedAgentIds: skill.assignedAgentIds.filter(id => id !== agentId),
    updatedAt: Date.now(),
  };

  skills.set(skillId, updatedSkill);
  persistSkills();
  // Use 'assigned' event for assignment changes - this doesn't restart agents
  // unlike 'updated' which is for content changes that require agent restarts
  emit('assigned', updatedSkill);

  log.log(` Unassigned skill "${skill.name}" from agent ${agentId}`);
  return updatedSkill;
}

/**
 * Get all skills assigned to a specific agent
 * Includes skills assigned directly AND skills assigned to the agent's class
 */
export function getSkillsForAgent(agentId: string, agentClass: AgentClass): Skill[] {
  return Array.from(skills.values()).filter(skill => {
    if (!skill.enabled) return false;

    // Check direct assignment
    if (skill.assignedAgentIds.includes(agentId)) return true;

    // Check class assignment
    if (skill.assignedAgentClasses.includes(agentClass)) return true;

    return false;
  });
}

/**
 * Build the skill instruction content for an agent's system prompt
 * Returns markdown text that should be appended to the system prompt
 */
export function buildSkillPromptContent(agentId: string, agentClass: AgentClass): string {
  const agentSkills = getSkillsForAgent(agentId, agentClass);

  if (agentSkills.length === 0) {
    return '';
  }

  const sections = agentSkills.map(skill => {
    let section = `## Skill: ${skill.name}\n\n`;
    section += `**Description:** ${skill.description}\n\n`;

    if (skill.allowedTools.length > 0) {
      section += `**Allowed Tools:** ${skill.allowedTools.join(', ')}\n\n`;
    }

    section += skill.content;
    return section;
  });

  return `
# Available Skills

The following skills are available to you. Use them when appropriate based on their descriptions.

${sections.join('\n\n---\n\n')}
`;
}

/**
 * Get the allowed tools for all skills assigned to an agent
 * Returns a deduplicated list of tool permissions
 */
export function getAllowedToolsForAgent(agentId: string, agentClass: AgentClass): string[] {
  const agentSkills = getSkillsForAgent(agentId, agentClass);
  const tools = new Set<string>();

  for (const skill of agentSkills) {
    for (const tool of skill.allowedTools) {
      tools.add(tool);
    }
  }

  return Array.from(tools);
}

/**
 * Remove agent from all skill assignments (when agent is deleted)
 */
export function removeAgentFromAllSkills(agentId: string): void {
  let modified = false;

  for (const [id, skill] of skills) {
    if (skill.assignedAgentIds.includes(agentId)) {
      const updatedSkill: Skill = {
        ...skill,
        assignedAgentIds: skill.assignedAgentIds.filter(aid => aid !== agentId),
        updatedAt: Date.now(),
      };
      skills.set(id, updatedSkill);
      modified = true;
    }
  }

  if (modified) {
    persistSkills();
    log.log(` Removed agent ${agentId} from all skill assignments`);
  }
}

/**
 * Check if an agent has pending skill updates that need to be injected
 */
export function hasPendingSkillUpdates(agentId: string): boolean {
  return pendingSkillUpdates.has(agentId);
}

/**
 * Clear pending skill updates for an agent (call after injecting skills into message)
 */
export function clearPendingSkillUpdates(agentId: string): void {
  pendingSkillUpdates.delete(agentId);
}

/**
 * Build a skill update notification to inject into a message
 * This is used to notify running agents about new skills without restarting
 */
export function buildSkillUpdateNotification(agentId: string, agentClass: AgentClass): string {
  const agentSkills = getSkillsForAgent(agentId, agentClass);

  if (agentSkills.length === 0) {
    return '';
  }

  const sections = agentSkills.map(skill => {
    let section = `## Skill: ${skill.name}\n\n`;
    section += `**Description:** ${skill.description}\n\n`;

    if (skill.allowedTools.length > 0) {
      section += `**Allowed Tools:** ${skill.allowedTools.join(', ')}\n\n`;
    }

    section += skill.content;
    return section;
  });

  return `
---
# 🔄 SKILL UPDATE

Your available skills have been updated. Here are your current skills:

${sections.join('\n\n---\n\n')}
---

`;
}

// ============================================================================
// Skill Hot-Reload
// ============================================================================

// Service interface types for hot-reload
interface AgentServiceInterface {
  getAllAgents(): Agent[];
  updateAgent(id: string, updates: Partial<Agent>, updateActivity?: boolean): Agent | null;
}

interface ClaudeServiceInterface {
  stopAgent(agentId: string): Promise<void>;
}

// These will be set by setupSkillHotReload
let agentServiceRef: AgentServiceInterface | null = null;
let claudeServiceRef: ClaudeServiceInterface | null = null;
let broadcastRef: ((message: any) => void) | null = null;

/**
 * Set up skill hot-reload: when a skill's content changes, restart all agents using that skill
 * so they pick up the new instructions in their system prompt.
 *
 * @param agentSvc - Reference to agent service
 * @param claudeSvc - Reference to claude service
 * @param broadcast - Function to broadcast messages to all clients
 */
export function setupSkillHotReload(
  agentSvc: AgentServiceInterface,
  claudeSvc: ClaudeServiceInterface,
  broadcast: (message: any) => void
): void {
  agentServiceRef = agentSvc;
  claudeServiceRef = claudeSvc;
  broadcastRef = broadcast;

  subscribe((event, data) => {
    if (event === 'updated' && typeof data === 'object') {
      handleSkillContentUpdate(data as Skill);
    }
  });

  log.log(' Skill hot-reload enabled');
}

/**
 * Handle skill content update - hot restart all agents using this skill
 */
async function handleSkillContentUpdate(skill: Skill): Promise<void> {
  if (!agentServiceRef || !claudeServiceRef || !broadcastRef) {
    log.error(' Skill hot-reload not initialized');
    return;
  }

  // Find all agents that use this skill (directly or via class)
  const allAgents = agentServiceRef.getAllAgents();
  const affectedAgents = allAgents.filter(agent => {
    // Check direct assignment
    if (skill.assignedAgentIds.includes(agent.id)) return true;
    // Check class assignment
    if (skill.assignedAgentClasses.includes(agent.class as AgentClass)) return true;
    return false;
  });

  if (affectedAgents.length === 0) {
    log.log(` Skill "${skill.name}" updated, no agents affected`);
    return;
  }

  log.log(` Skill "${skill.name}" updated, hot-restarting ${affectedAgents.length} agent(s)`);

  for (const agent of affectedAgents) {
    // Only restart agents with active sessions
    if (!agent.sessionId) {
      log.log(` Agent ${agent.name}: No active session, skill will apply on next start`);
      continue;
    }

    try {
      // Stop the current Claude process
      await claudeServiceRef.stopAgent(agent.id);

      // Mark as idle (resume will happen on next command with new skills in system prompt)
      agentServiceRef.updateAgent(agent.id, {
        status: 'idle',
        currentTask: undefined,
        currentTool: undefined,
        // Keep sessionId! This allows --resume to work with updated skill content
      }, false);

      // Send activity notification
      broadcastRef({
        type: 'activity',
        payload: {
          agentId: agent.id,
          message: `Skill "${skill.name}" updated - context preserved`,
        },
      });

      log.log(` Agent ${agent.name}: Hot-restarted for skill update`);
    } catch (err) {
      log.error(` Failed to hot-restart agent ${agent.name} after skill update:`, err);
    }
  }
}

/**
 * Check if a skill is a built-in skill (by ID or by checking the skill object)
 */
export function isBuiltinSkill(skillOrId: string | Skill): boolean {
  if (typeof skillOrId === 'string') {
    const skill = skills.get(skillOrId);
    return skill?.builtin === true || isBuiltinSkillId(skillOrId);
  }
  return skillOrId.builtin === true;
}

// Export skill service as a singleton-like object for consistency
export const skillService = {
  init: initSkills,
  persist: persistSkills,
  subscribe,
  getSkill,
  getSkillBySlug,
  getAllSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  assignSkillToAgent,
  unassignSkillFromAgent,
  getSkillsForAgent,
  buildSkillPromptContent,
  getAllowedToolsForAgent,
  removeAgentFromAllSkills,
  hasPendingSkillUpdates,
  clearPendingSkillUpdates,
  buildSkillUpdateNotification,
  isBuiltinSkill,
};
