/**
 * Which agents a skill reaches — the single rule shared by the server (prompt
 * injection, hot reload) and every client view (agent panel, bulk manager,
 * edit modal, skills panel).
 *
 * A skill reaches an agent directly (`assignedAgentIds`), through the agent's
 * class, or through the `'*'` wildcard. `excludedAgentIds` opts one agent out
 * of the class/wildcard reach without touching the class assignment, so a
 * skill every farfetch gets can still be removed from one farfetch. A direct
 * assignment always wins over an exclusion.
 */

import type { Skill } from './common-types.js';

export type SkillAssignmentSource = 'direct' | 'class' | 'wildcard';

type SkillReach = Pick<Skill, 'assignedAgentIds' | 'assignedAgentClasses' | 'excludedAgentIds'>;

/** How the skill reaches the agent, or null when it doesn't (disabled state is not considered). */
export function skillAssignmentSource(
  skill: SkillReach,
  agent: { id: string; class: string },
): SkillAssignmentSource | null {
  if (skill.assignedAgentIds.includes(agent.id)) return 'direct';
  if (skill.excludedAgentIds?.includes(agent.id)) return null;
  if (skill.assignedAgentClasses.includes('*')) return 'wildcard';
  if ((skill.assignedAgentClasses as string[]).includes(agent.class)) return 'class';
  return null;
}

/** True when an enabled skill reaches the agent. */
export function skillAppliesToAgent(
  skill: SkillReach & Pick<Skill, 'enabled'>,
  agent: { id: string; class: string },
): boolean {
  return skill.enabled && skillAssignmentSource(skill, agent) !== null;
}
