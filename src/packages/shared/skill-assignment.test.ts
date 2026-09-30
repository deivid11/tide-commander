import { describe, expect, it } from 'vitest';
import { skillAppliesToAgent, skillAssignmentSource } from './skill-assignment.js';

const farfetch = { id: 'grogu', class: 'farfetch' };

describe('skillAssignmentSource', () => {
  it('reports direct, class and wildcard reach', () => {
    expect(skillAssignmentSource({ assignedAgentIds: ['grogu'], assignedAgentClasses: [] }, farfetch)).toBe('direct');
    expect(skillAssignmentSource({ assignedAgentIds: [], assignedAgentClasses: ['farfetch'] }, farfetch)).toBe('class');
    expect(skillAssignmentSource({ assignedAgentIds: [], assignedAgentClasses: ['*'] }, farfetch)).toBe('wildcard');
    expect(skillAssignmentSource({ assignedAgentIds: [], assignedAgentClasses: ['pidgey'] }, farfetch)).toBeNull();
  });

  it('lets one agent opt out of a class or wildcard skill', () => {
    expect(skillAssignmentSource({ assignedAgentIds: [], assignedAgentClasses: ['farfetch'], excludedAgentIds: ['grogu'] }, farfetch)).toBeNull();
    expect(skillAssignmentSource({ assignedAgentIds: [], assignedAgentClasses: ['*'], excludedAgentIds: ['grogu'] }, farfetch)).toBeNull();
    // Other agents of the class keep it.
    expect(skillAssignmentSource({ assignedAgentIds: [], assignedAgentClasses: ['farfetch'], excludedAgentIds: ['grogu'] }, { id: 'bilbo', class: 'farfetch' })).toBe('class');
  });

  it('a direct assignment wins over an exclusion', () => {
    expect(skillAssignmentSource({ assignedAgentIds: ['grogu'], assignedAgentClasses: ['farfetch'], excludedAgentIds: ['grogu'] }, farfetch)).toBe('direct');
  });

  it('skillAppliesToAgent also requires the skill to be enabled', () => {
    expect(skillAppliesToAgent({ enabled: false, assignedAgentIds: ['grogu'], assignedAgentClasses: [] }, farfetch)).toBe(false);
    expect(skillAppliesToAgent({ enabled: true, assignedAgentIds: [], assignedAgentClasses: ['farfetch'] }, farfetch)).toBe(true);
  });
});
