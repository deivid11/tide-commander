/**
 * Skill Service
 * Business logic for managing skills that can be assigned to agents
 *
 * Skills are markdown-based instruction sets that teach agents how to perform
 * specific tasks. They can be assigned to individual agents or entire agent classes.
 */

import type { Skill, AgentClass } from '../../shared/types.js';
import { loadSkills, saveSkills } from '../data/index.js';
import { createLogger, generateId, generateSlug } from '../utils/index.js';

const log = createLogger('SkillService');

// In-memory skill storage
const skills = new Map<string, Skill>();

// Listeners for skill changes
type SkillListener = (event: string, skill: Skill | string) => void;
const listeners = new Set<SkillListener>();

// ============================================================================
// Initialization
// ============================================================================

export function initSkills(): void {
  try {
    const storedSkills = loadSkills();
    for (const skill of storedSkills) {
      skills.set(skill.id, skill);
    }
    log.log(` Loaded ${skills.size} skills`);
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
  emit('updated', updatedSkill);

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
  emit('updated', updatedSkill);

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
};
