/**
 * Tests for the user-prompt overview rail helpers (promptMarkers.ts).
 *
 * Covers: which merged rows earn a marker (genuine user prompts only), which
 * are skipped (slash commands, interruptions, task reports/notifications,
 * command runs), and how wrappers (boss context, Codex injected instructions,
 * delegated-task headers) are stripped from the hover preview.
 */

import { describe, it, expect } from 'vitest';
import { buildPromptMarkers, extractPromptPreview, MAX_PROMPT_MARKERS } from '../promptMarkers';
import type { TaggedItem } from '../virtualizedOutputKey';
import { BOSS_CONTEXT_START, BOSS_CONTEXT_END } from '../../../../shared/agent-types';

function live(item: Record<string, unknown>, originalIndex = 0): TaggedItem {
  return { kind: 'live', item: item as never, originalIndex };
}

function history(item: Record<string, unknown>, originalIndex = 0): TaggedItem {
  return { kind: 'history', item: item as never, originalIndex };
}

describe('extractPromptPreview', () => {
  it('keeps a plain prompt and collapses whitespace', () => {
    expect(extractPromptPreview('  arregla   el \n\n bug  ')).toBe('arregla el bug');
  });

  it('returns null for empty / whitespace-only text', () => {
    expect(extractPromptPreview('')).toBeNull();
    expect(extractPromptPreview('   \n  ')).toBeNull();
  });

  it('skips slash commands, with and without args', () => {
    expect(extractPromptPreview('/compact')).toBeNull();
    expect(extractPromptPreview('/compact enfócate en el bug del scroll')).toBeNull();
    expect(extractPromptPreview('/code-review')).toBeNull();
  });

  it('does NOT treat an absolute path as a slash command', () => {
    expect(extractPromptPreview('/home/riven/d/foo.ts está roto')).toBe(
      '/home/riven/d/foo.ts está roto'
    );
  });

  it('skips internal rename-agent orchestration prompts', () => {
    expect(extractPromptPreview('[RENAME_AGENT_PROPOSALS_REQUEST]\nAnaliza tu conversación…')).toBeNull();
  });

  it('skips history command runs and interruptions', () => {
    expect(extractPromptPreview('<command-name>/clear</command-name>')).toBeNull();
    expect(extractPromptPreview('[Request interrupted by user]')).toBeNull();
    expect(extractPromptPreview('Caveat: The messages below were generated...')).toBeNull();
  });

  it('strips the boss-context wrapper down to the real prompt', () => {
    const raw = `${BOSS_CONTEXT_START}\ncontexto del jefe\n${BOSS_CONTEXT_END}\nhaz el deploy`;
    expect(extractPromptPreview(raw)).toBe('haz el deploy');
  });

  it('strips Codex injected instructions via the User Request header', () => {
    const raw = 'Follow all instructions below for this task.\nblah\n## User Request\nrevisa el login';
    expect(extractPromptPreview(raw)).toBe('revisa el login');
  });

  it('keeps delegated tasks but drops the header', () => {
    expect(extractPromptPreview('[DELEGATED TASK from Boss (abc123)] documenta el API')).toBe(
      'documenta el API'
    );
  });

  it('skips task reports and pure task notifications', () => {
    expect(extractPromptPreview('[TASK REPORT from Sub (x)] status: done')).toBeNull();
    expect(
      extractPromptPreview('<task-notification>task 1 completed</task-notification>')
    ).toBeNull();
  });

  it('strips system-reminder blocks and image placeholders', () => {
    const raw = 'mira esto [Image: /tmp/shot.png] <system-reminder>noise</system-reminder> por favor';
    expect(extractPromptPreview(raw)).toBe('mira esto por favor');
  });

  it('truncates long prompts on a word boundary with an ellipsis', () => {
    const raw = 'palabra '.repeat(60).trim();
    const preview = extractPromptPreview(raw);
    expect(preview).not.toBeNull();
    expect(preview!.length).toBeLessThanOrEqual(161);
    expect(preview!.endsWith('…')).toBe(true);
  });
});

describe('buildPromptMarkers', () => {
  it('marks history user rows and live isUserPrompt rows, preserving merged indices', () => {
    const items: TaggedItem[] = [
      history({ type: 'user', content: 'primer prompt', timestamp: '2026-08-04T10:00:00.000Z', uuid: 'u1' }),
      history({ type: 'assistant', content: 'respuesta', timestamp: '2026-08-04T10:00:05.000Z', uuid: 'a1' }),
      history({ type: 'tool_use', content: 'Bash', timestamp: '2026-08-04T10:00:06.000Z', uuid: 't1' }),
      live({ isUserPrompt: true, text: 'segundo prompt', timestamp: 1754301700000, uuid: 'u2' }),
      live({ isUserPrompt: false, text: 'streaming...', timestamp: 1754301701000, uuid: 'a2' }),
    ];
    const keys = ['k0', 'k1', 'k2', 'k3', 'k4'];

    const markers = buildPromptMarkers(items, keys);

    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({ index: 0, key: 'k0', preview: 'primer prompt' });
    expect(markers[0].timestampMs).toBe(Date.parse('2026-08-04T10:00:00.000Z'));
    expect(markers[1]).toMatchObject({ index: 3, key: 'k3', preview: 'segundo prompt', timestampMs: 1754301700000 });
  });

  it('drops user rows whose preview is filtered out (slash command / interruption)', () => {
    const items: TaggedItem[] = [
      history({ type: 'user', content: '<command-name>/compact</command-name>', uuid: 'c1' }),
      live({ isUserPrompt: true, text: '/clear', timestamp: 1, uuid: 'c2' }),
      live({ isUserPrompt: true, text: 'prompt real', timestamp: 2, uuid: 'p1' }),
    ];
    const markers = buildPromptMarkers(items, ['k0', 'k1', 'k2']);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ index: 2, preview: 'prompt real' });
  });

  it(`caps the rail at the newest ${MAX_PROMPT_MARKERS} prompts`, () => {
    const items: TaggedItem[] = [];
    const keys: string[] = [];
    for (let i = 0; i < MAX_PROMPT_MARKERS + 5; i++) {
      items.push(live({ isUserPrompt: true, text: `prompt ${i}`, timestamp: i + 1, uuid: `u${i}` }, i));
      keys.push(`k${i}`);
    }

    const markers = buildPromptMarkers(items, keys);

    expect(markers).toHaveLength(MAX_PROMPT_MARKERS);
    // Oldest 5 dropped: the first surviving marker is prompt 5, the last is the newest.
    expect(markers[0]).toMatchObject({ index: 5, preview: 'prompt 5' });
    expect(markers[markers.length - 1]).toMatchObject({
      index: MAX_PROMPT_MARKERS + 4,
      preview: `prompt ${MAX_PROMPT_MARKERS + 4}`,
    });
  });
});
