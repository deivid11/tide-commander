export function getQuickSelectSwipeTarget(
  ids: readonly string[],
  activeAgentId: string,
  direction: 1 | -1,
): string | null {
  if (ids.length < 2) return null;
  const current = ids.indexOf(activeAgentId);
  if (current === -1) return direction > 0 ? ids[0] : ids[ids.length - 1];
  return ids[(current + direction + ids.length) % ids.length] ?? null;
}
