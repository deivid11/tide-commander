export interface SlashCommandOutputLike {
  pluginOutput?: unknown;
}

/**
 * Hides structured plugin cards without deleting them from the agent output
 * store. Returning the original array while visible avoids needless list work.
 */
export function filterSlashCommandOutputs<T extends SlashCommandOutputLike>(
  outputs: T[],
  visible: boolean,
): T[] {
  return visible ? outputs : outputs.filter((output) => !output.pluginOutput);
}
