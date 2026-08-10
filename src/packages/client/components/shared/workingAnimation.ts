/**
 * Picks which of a GLB's animation clips to play while an agent is working.
 *
 * The stock character models ship 32 clips, and a uniform shuffle would happily
 * land on `die`, `static` or `wheelchair-sit` — which read as "broken", not
 * "busy". So clips whose name says "not doing anything" are filtered out, and
 * anything left (including every clip of an unknown custom model, whose names
 * match nothing here) is fair game.
 */

/** Clip names that would look idle, dead or seated if they came up. */
const NON_WORKING_ANIMATION = /(^|[-_])(static|idle|die|death|dead|fall|sit|crouch|drive|sleep|rest)([-_]|$)|wheelchair|^holding-(right|left|both)$/;

export function isWorkingAnimationName(name: string): boolean {
  return !NON_WORKING_ANIMATION.test(name.trim().toLowerCase());
}

/**
 * Choose a random working clip, avoiding an immediate repeat of `currentName`
 * when there is anything else to show. Returns null only when `names` is empty.
 * Falls back to the full list if every clip was filtered out (a model whose only
 * animation is `idle` still animates rather than freezing).
 */
export function pickWorkingAnimationName(
  names: string[],
  currentName?: string | null,
  random: () => number = Math.random,
): string | null {
  if (names.length === 0) return null;

  let pool = names.filter(isWorkingAnimationName);
  if (pool.length === 0) pool = [...names];

  if (currentName && pool.length > 1) {
    const withoutCurrent = pool.filter((n) => n !== currentName);
    if (withoutCurrent.length > 0) pool = withoutCurrent;
  }

  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
