import { describe, expect, it } from 'vitest';
import { resolveDefaultSkillIds } from './default-agent-skills';

const skills = [
  { id: 'builtin-full-notifications', slug: 'full-notifications' },
  { id: 'builtin-streaming-exec', slug: 'streaming-exec' },
  { id: 'custom-1', slug: 'deploy-helper' },
];

describe('resolveDefaultSkillIds', () => {
  it('maps configured slugs onto the skills installed here', () => {
    expect(resolveDefaultSkillIds(skills, ['full-notifications', 'deploy-helper']))
      .toEqual(['builtin-full-notifications', 'custom-1']);
  });

  it('skips slugs with no skill behind them instead of failing', () => {
    // A default can name a skill that was deleted, or one from another install.
    expect(resolveDefaultSkillIds(skills, ['streaming-exec', 'gone']))
      .toEqual(['builtin-streaming-exec']);
  });

  it('pre-selects nothing for an empty list', () => {
    expect(resolveDefaultSkillIds(skills, [])).toEqual([]);
  });
});
