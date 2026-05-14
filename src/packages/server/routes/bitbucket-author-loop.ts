/**
 * Bitbucket author-loop guard.
 *
 * When the bot account itself comments / approves / requests-changes on a PR,
 * Bitbucket fires another webhook with the bot as `actor`. Without this guard,
 * the agent would react to its own activity in a loop.
 *
 * Scope: only events where the actor's identity is meaningfully separable
 * from the PR author. `pullrequest:created` is excluded — the actor IS the PR
 * author and we DO want to route on PR creation regardless of who opened it.
 *
 * Identity match: compares the configured `BITBUCKET_BOT_USERNAME` against
 * three actor fields in the payload, returning true if any match. The env
 * var name suggests `nickname` (the typical case), but UUID and account_id
 * are also accepted for higher reliability — UUIDs/account_ids never change,
 * whereas a nickname can be re-claimed if the bot is renamed.
 *   - `actor.nickname`   (e.g. "review-bot")          — most readable
 *   - `actor.uuid`       (e.g. "{abc-1234-...}")      — most reliable
 *   - `actor.account_id` (e.g. "557058:abcd-...")     — also reliable
 */

const GUARDED_EVENT_KEYS = new Set<string>([
  'pullrequest:approved',
  'pullrequest:unapproved',
  'pullrequest:changes_request_created',
  'pullrequest:changes_request_removed',
  'pullrequest:comment_created',
  'pullrequest:comment_updated',
  'pullrequest:comment_deleted',
]);

interface BitbucketActorFields {
  nickname?: unknown;
  uuid?: unknown;
  account_id?: unknown;
}

/**
 * Returns true when the event is a guarded action AND the actor in the
 * payload matches the configured bot identifier. Caller should ACK 200 with
 * `{ skipped: 'author-loop-guard' }` and skip routing.
 *
 * Returns false when:
 *   - `botIdentifier` is empty (guard disabled)
 *   - `eventKey` is not in the guarded set (e.g. pullrequest:created)
 *   - the payload's actor doesn't match any of the candidate fields
 */
export function isBitbucketAuthorLoop(
  eventKey: string | undefined,
  payload: unknown,
  botIdentifier: string | undefined,
): boolean {
  if (!botIdentifier || !eventKey) return false;
  if (!GUARDED_EVENT_KEYS.has(eventKey)) return false;
  if (!payload || typeof payload !== 'object') return false;

  const actor = (payload as { actor?: unknown }).actor;
  if (!actor || typeof actor !== 'object') return false;

  const a = actor as BitbucketActorFields;
  const candidates = [a.nickname, a.uuid, a.account_id]
    .filter((v): v is string => typeof v === 'string' && v.length > 0);

  return candidates.includes(botIdentifier);
}
