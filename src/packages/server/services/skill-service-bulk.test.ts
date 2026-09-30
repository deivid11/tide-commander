import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored = vi.hoisted(() => ({ skills: [] as unknown[] }));

vi.mock('../data/index.js', () => ({
  loadSkills: () => stored.skills,
  saveSkills: vi.fn(),
}));
vi.mock('../integrations/integration-registry.js', () => ({ getIntegrationSkills: () => [] }));
vi.mock('./instruction-refresh.js', () => ({ markInstructionsDirty: vi.fn() }));
vi.mock('./default-agent-skills-service.js', () => ({ renameDefaultAgentSkillSlug: vi.fn() }));

const now = Date.now();
const skill = (id: string, extra: Record<string, unknown>) => ({
  id, name: id, slug: id, description: '', content: '', allowedTools: [],
  assignedAgentIds: [], assignedAgentClasses: [], enabled: true, createdAt: now, updatedAt: now, ...extra,
});

const grogu = { id: 'grogu', class: 'farfetch' };
const bilbo = { id: 'bilbo', class: 'farfetch' };

describe('bulk skill add/remove for any assignment source', () => {
  beforeEach(() => {
    vi.resetModules();
    stored.skills = [
      skill('direct-skill', { assignedAgentIds: ['grogu'] }),
      skill('class-skill', { assignedAgentClasses: ['farfetch'] }),
      skill('wild-skill', { assignedAgentClasses: ['*'] }),
    ];
  });

  it('removes a direct assignment without leaving an exclusion', async () => {
    const svc = await import('./skill-service.js');
    svc.initSkills();
    expect(svc.removeSkillForAgent('direct-skill', grogu)?.changed).toBe(true);
    const after = svc.getSkill('direct-skill')!;
    expect(after.assignedAgentIds).toEqual([]);
    expect(after.excludedAgentIds).toBeUndefined();
  });

  it('removes a class or wildcard skill from one agent only', async () => {
    const svc = await import('./skill-service.js');
    svc.initSkills();
    expect(svc.removeSkillForAgent('class-skill', grogu)?.changed).toBe(true);
    expect(svc.removeSkillForAgent('wild-skill', grogu)?.changed).toBe(true);

    const ids = (agent: typeof grogu) => svc.getSkillsForAgent(agent.id, agent.class).map((s) => s.id);
    expect(ids(grogu)).toEqual(['direct-skill']);
    expect(ids(bilbo)).toEqual(expect.arrayContaining(['class-skill', 'wild-skill']));
    // The class assignment itself is untouched.
    expect(svc.getSkill('class-skill')!.assignedAgentClasses).toEqual(['farfetch']);
  });

  it('is idempotent and re-adding lifts the exclusion instead of assigning directly', async () => {
    const svc = await import('./skill-service.js');
    svc.initSkills();
    svc.removeSkillForAgent('class-skill', grogu);
    expect(svc.removeSkillForAgent('class-skill', grogu)?.changed).toBe(false);

    expect(svc.addSkillForAgent('class-skill', grogu)?.changed).toBe(true);
    const after = svc.getSkill('class-skill')!;
    expect(after.excludedAgentIds).toBeUndefined();
    expect(after.assignedAgentIds).toEqual([]);
    expect(svc.addSkillForAgent('class-skill', grogu)?.changed).toBe(false);
  });

  it('forgets a deleted agent in exclusions too', async () => {
    const svc = await import('./skill-service.js');
    svc.initSkills();
    svc.removeSkillForAgent('class-skill', grogu);
    svc.removeAgentFromAllSkills('grogu');
    expect(svc.getSkill('class-skill')!.excludedAgentIds).toBeUndefined();
  });
});
