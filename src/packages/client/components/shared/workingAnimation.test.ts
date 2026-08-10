import { describe, expect, it } from 'vitest';
import { isWorkingAnimationName, pickWorkingAnimationName } from './workingAnimation';

// The stock Kenney characters ship all of these in one GLB.
const STOCK_CLIPS = [
  'static', 'idle', 'walk', 'sprint', 'jump', 'fall', 'crouch', 'sit', 'drive', 'die', 'pick-up',
  'emote-yes', 'emote-no', 'holding-right', 'holding-both-shoot', 'attack-kick-left',
  'wheelchair-sit', 'wheelchair-move-forward',
];

describe('isWorkingAnimationName', () => {
  it('rejects clips that read as idle, dead or seated', () => {
    for (const name of ['static', 'idle', 'die', 'fall', 'sit', 'crouch', 'drive', 'wheelchair-sit', 'holding-both']) {
      expect(isWorkingAnimationName(name), name).toBe(false);
    }
  });

  it('keeps clips that look like activity', () => {
    for (const name of ['walk', 'sprint', 'jump', 'pick-up', 'emote-yes', 'attack-kick-left', 'holding-both-shoot']) {
      expect(isWorkingAnimationName(name), name).toBe(true);
    }
  });
});

describe('pickWorkingAnimationName', () => {
  it('never picks a filtered clip from the stock model, whatever the roll', () => {
    for (let i = 0; i < STOCK_CLIPS.length; i++) {
      const picked = pickWorkingAnimationName(STOCK_CLIPS, null, () => i / STOCK_CLIPS.length);
      expect(picked).not.toBeNull();
      expect(isWorkingAnimationName(picked as string), `roll ${i} → ${picked}`).toBe(true);
    }
  });

  it('avoids repeating the clip already on screen', () => {
    // random() = 0 would otherwise land on 'walk' again
    expect(pickWorkingAnimationName(['walk', 'jump'], 'walk', () => 0)).toBe('jump');
  });

  it('falls back to the only clip when it is also the current one', () => {
    expect(pickWorkingAnimationName(['walk'], 'walk', () => 0)).toBe('walk');
  });

  it('animates rather than freezing when every clip is filtered out', () => {
    expect(pickWorkingAnimationName(['idle', 'static'], null, () => 0)).toBe('idle');
  });

  it('treats an unknown custom model as all-eligible', () => {
    expect(pickWorkingAnimationName(['Action.001', 'Take 001'], null, () => 0.99)).toBe('Take 001');
  });

  it('returns null when the model has no animations', () => {
    expect(pickWorkingAnimationName([], null, () => 0)).toBeNull();
  });
});
