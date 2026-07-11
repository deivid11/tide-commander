import { describe, it, expect } from 'vitest';
import { extractToolKeyParam } from '../../../utils/outputRendering';

/** Mirror of makeToolInvocationKey in AgentTerminalPane (kept pure for tests). */
function makeToolInvocationKey(
  toolName: string | undefined,
  toolInput: Record<string, unknown> | undefined,
  textFallback?: string,
): string | null {
  let name = (toolName || '').trim();
  if (!name && textFallback?.startsWith('Using tool:')) {
    name = textFallback.replace('Using tool:', '').trim();
  }
  if (!name) return null;
  let keyParam: string | null = null;
  if (toolInput && typeof toolInput === 'object' && Object.keys(toolInput).length > 0) {
    try {
      keyParam = extractToolKeyParam(name, JSON.stringify(toolInput));
    } catch { /* ignore */ }
  }
  return keyParam ? `${name}::${keyParam}` : `${name}::`;
}

describe('makeToolInvocationKey (Guake tool dedup)', () => {
  it('matches live early and history call for the same Bash command', () => {
    const cmd = 'cd /home/riven/d/tide-commander && node --import tsx -e \'…\'';
    const live = makeToolInvocationKey('Bash', { command: cmd }, 'Using tool: Bash');
    const history = makeToolInvocationKey('Bash', { command: cmd });
    expect(live).toBe(history);
    expect(live).toContain('Bash::');
    expect(live).not.toBe('Bash::');
  });

  it('distinguishes two Reads of different files', () => {
    const a = makeToolInvocationKey('Read', { target_file: '/tmp/a.ts' });
    const b = makeToolInvocationKey('Read', { target_file: '/tmp/b.ts' });
    expect(a).not.toBe(b);
  });

  it('empty input yields name-only key (not used for aggressive live dedup)', () => {
    expect(makeToolInvocationKey('Bash', {})).toBe('Bash::');
    expect(makeToolInvocationKey('ListFiles', undefined, 'Using tool: ListFiles')).toBe('ListFiles::');
  });
});
