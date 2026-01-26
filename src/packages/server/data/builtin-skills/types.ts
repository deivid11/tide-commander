/**
 * Built-in Skill Types
 */

/**
 * Built-in skill definition (without runtime fields like id, createdAt, updatedAt)
 */
export interface BuiltinSkillDefinition {
  slug: string;
  name: string;
  description: string;
  content: string;
  allowedTools: string[];
  model?: string;
  context?: 'fork' | 'inline';
  assignedAgentClasses?: string[];
}
