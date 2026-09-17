/**
 * Message composers (the agent panel's TerminalInputArea and the Commander view's TerminalInput):
 * should Enter add a line instead of sending?
 *
 * On a phone there is no Shift+Enter, and an Enter meant as a line break must not send a
 * half-written message: there, Enter adds a line and only the Send button sends. "Phone" means a
 * touch-first screen (coarse primary pointer, the criterion TerminalEmbed and Spotlight already
 * use) OR a narrow one (<= 768 px, the width the agent panel used on its own until now). A phone in
 * landscape is wider than 768 px but still touch-first, which is why width alone was not enough.
 * Desktop (fine pointer, wide window) keeps Enter = send and Shift+Enter = new line.
 */
export interface ComposerEnv {
  matchMedia?: (query: string) => { matches: boolean };
  innerWidth?: number;
}

export const NARROW_COMPOSER_MAX_WIDTH = 768;

export function enterInsertsNewline(
  env: ComposerEnv | undefined = typeof window !== 'undefined' ? window : undefined,
): boolean {
  if (!env) return false;
  const coarse = typeof env.matchMedia === 'function' ? env.matchMedia('(pointer: coarse)').matches : false;
  const narrow = typeof env.innerWidth === 'number' && env.innerWidth <= NARROW_COMPOSER_MAX_WIDTH;
  return coarse || narrow;
}
