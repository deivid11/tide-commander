import { describe, it, expect } from 'vitest';
import {
  normalizeModelId,
  modelTier,
  isModelAlias,
  formatModelName,
  detectModelFallback,
  ModelFallbackTracker,
} from './model-fallback.js';

describe('normalizeModelId', () => {
  it('drops the Tide Commander [1m] context label', () => {
    expect(normalizeModelId('claude-fable-5[1m]')).toBe('claude-fable-5');
    expect(normalizeModelId('claude-opus-4-8[1m]')).toBe('claude-opus-4-8');
  });

  it('drops dated snapshots and Bedrock revisions', () => {
    expect(normalizeModelId('claude-fable-5-1-20260831')).toBe('claude-fable-5-1');
    expect(normalizeModelId('claude-opus-4-8-20260101')).toBe('claude-opus-4-8');
    expect(normalizeModelId('claude-fable-5-v1:0')).toBe('claude-fable-5');
    expect(normalizeModelId('claude-opus-5-latest')).toBe('claude-opus-5');
  });

  it('drops cloud-vendor prefixes', () => {
    expect(normalizeModelId('us.anthropic.claude-opus-4-8')).toBe('claude-opus-4-8');
    expect(normalizeModelId('bedrock/claude-fable-5')).toBe('claude-fable-5');
  });

  it('treats the CLI synthetic-message placeholder as no model', () => {
    expect(normalizeModelId('<synthetic>')).toBeNull();
    expect(normalizeModelId('')).toBeNull();
    expect(normalizeModelId(undefined)).toBeNull();
  });
});

describe('modelTier / isModelAlias', () => {
  it('reads the family out of a versioned id', () => {
    expect(modelTier('claude-opus-4-8')).toBe('opus');
    expect(modelTier('claude-fable-5[1m]')).toBe('fable');
    expect(modelTier('claude-3-5-sonnet-20241022')).toBe('sonnet');
    expect(modelTier('gpt-5.6-luna')).toBeNull();
  });

  it('recognizes bare family aliases', () => {
    expect(isModelAlias('opus')).toBe(true);
    expect(isModelAlias('sonnet')).toBe(true);
    expect(isModelAlias('default')).toBe(true);
    expect(isModelAlias('claude-opus-4-8')).toBe(false);
  });
});

describe('formatModelName', () => {
  it('renders compact labels', () => {
    expect(formatModelName('claude-fable-5-1')).toBe('Fable 5.1');
    expect(formatModelName('claude-fable-5')).toBe('Fable 5');
    expect(formatModelName('claude-opus-5')).toBe('Opus 5');
    expect(formatModelName('claude-opus-4-8')).toBe('Opus 4.8');
    expect(formatModelName('claude-haiku-4-5')).toBe('Haiku 4.5');
    expect(formatModelName('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5');
    expect(formatModelName('opus')).toBe('Opus');
  });

  it('echoes ids it cannot parse instead of guessing', () => {
    expect(formatModelName('some-new-model')).toBe('some-new-model');
  });
});

describe('detectModelFallback', () => {
  it('reports the Fable → Opus 4.8 swap', () => {
    const detection = detectModelFallback('claude-fable-5', 'claude-opus-4-8');
    expect(detection).toMatchObject({
      from: 'claude-fable-5',
      to: 'claude-opus-4-8',
      fromLabel: 'Fable 5',
      toLabel: 'Opus 4.8',
      tierChanged: true,
    });
  });

  it('reports a same-tier version downgrade (Opus 5 → Opus 4.8)', () => {
    const detection = detectModelFallback('claude-opus-5', 'claude-opus-4-8');
    expect(detection).toMatchObject({
      fromLabel: 'Opus 5',
      toLabel: 'Opus 4.8',
      tierChanged: false,
    });
  });

  it('ignores the [1m] label — same model, different context window', () => {
    expect(detectModelFallback('claude-fable-5[1m]', 'claude-fable-5')).toBeNull();
  });

  it('ignores dated snapshots of the requested model', () => {
    expect(detectModelFallback('claude-opus-4-8', 'claude-opus-4-8-20260101')).toBeNull();
  });

  it('does not flag the CLI resolving our own family alias', () => {
    expect(detectModelFallback('opus', 'claude-opus-4-8')).toBeNull();
    expect(detectModelFallback('sonnet', 'claude-sonnet-5')).toBeNull();
  });

  it('still flags an alias request served by a different family', () => {
    expect(detectModelFallback('opus', 'claude-sonnet-5')).toMatchObject({
      toLabel: 'Sonnet 5',
      tierChanged: true,
    });
  });

  it('stays quiet when either side is unknown', () => {
    expect(detectModelFallback('claude-fable-5', '<synthetic>')).toBeNull();
    expect(detectModelFallback(null, 'claude-opus-4-8')).toBeNull();
  });
});

describe('ModelFallbackTracker', () => {
  it('stays quiet until a model actually answers with something else', () => {
    const tracker = new ModelFallbackTracker('claude-fable-5');
    expect(tracker.observe('claude-fable-5')).toBeNull();
    expect(tracker.observe('claude-fable-5')).toBeNull();
  });

  it('reports the swap once, then the recovery once', () => {
    const tracker = new ModelFallbackTracker('claude-fable-5');

    expect(tracker.observe('claude-opus-4-8')).toMatchObject({
      restored: false,
      label: 'Fable 5 → Opus 4.8',
    });
    expect(tracker.observe('claude-opus-4-8')).toBeNull();
    expect(tracker.observe('claude-opus-4-8')).toBeNull();
    expect(tracker.observe('claude-fable-5')).toMatchObject({
      restored: true,
      label: 'Fable 5',
    });
    expect(tracker.observe('claude-fable-5')).toBeNull();
  });

  it('reports a move from one fallback target to another', () => {
    const tracker = new ModelFallbackTracker('claude-fable-5');
    tracker.observe('claude-opus-4-8');
    expect(tracker.observe('claude-sonnet-5')).toMatchObject({
      label: 'Fable 5 → Sonnet 5',
    });
  });

  it('does nothing until a requested model is known', () => {
    const tracker = new ModelFallbackTracker();
    expect(tracker.observe('claude-opus-4-8')).toBeNull();
  });

  it('resumes from a fallback restored out of a persisted agent record', () => {
    // Commander restarted mid-fallback: the tracker is seeded with what was
    // serving, so the very next good turn still reports the recovery.
    const tracker = new ModelFallbackTracker('claude-fable-5', 'claude-opus-4-8');
    expect(tracker.observe('claude-fable-5')).toMatchObject({ restored: true });
  });

  it('keeps the seeded served model when the request arrives afterwards', () => {
    // The real restart order: the tracker is built from the agent record before
    // the next run's args/init tell it which model was requested. That first
    // setRequested must not wipe the seed, or the stale badge never clears.
    const tracker = new ModelFallbackTracker(null, 'claude-opus-4-8');
    tracker.setRequested('claude-fable-5');
    expect(tracker.observe('claude-fable-5')).toMatchObject({ restored: true });
  });

  it('keeps its state when init reports a dated snapshot of the launch model', () => {
    // Real sequence from a resumed session: `--model claude-haiku-4-5` on the
    // command line, `claude-haiku-4-5-20251001` back from system/init.
    const tracker = new ModelFallbackTracker();
    tracker.setRequested('claude-haiku-4-5');
    tracker.observe('claude-sonnet-5');                 // downgraded
    tracker.setRequested('claude-haiku-4-5-20251001');  // resumed turn's init

    expect(tracker.observe('claude-sonnet-5')).toBeNull();
  });

  it('keeps its state when init merely refines the alias we launched with', () => {
    const tracker = new ModelFallbackTracker();
    tracker.setRequested('opus');            // launch arg
    tracker.observe('claude-sonnet-5');      // downgraded out of the family
    tracker.setRequested('claude-opus-4-8'); // system/init resolves the alias

    expect(tracker.observe('claude-sonnet-5')).toBeNull();
  });

  it('forgets the old swap when the agent is reconfigured to another model', () => {
    const tracker = new ModelFallbackTracker('claude-fable-5');
    tracker.observe('claude-opus-4-8');
    tracker.setRequested('claude-sonnet-5');

    // Now legitimately on Sonnet 5 — nothing to restore, nothing to warn about.
    expect(tracker.observe('claude-sonnet-5')).toBeNull();
  });
});
