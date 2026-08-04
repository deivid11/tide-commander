/**
 * Silent model-fallback detection.
 *
 * Anthropic's API can serve a turn with a DIFFERENT model than the one the
 * session was started with — a refusal fallback, a capacity/quota fallback, or
 * a server-side mid-stream swap. Only the first of those lanes shows a dialog
 * in the CLI; the other two produce no UI notification at all and do not honor
 * the local opt-outs (`switchModelsOnFlag`, CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK).
 *
 * The one trace that always reaches us is the message stamp: when a swap
 * happens the CLI rewrites `message.model` on the assistant message to the
 * model that actually served it, while the session's `system/init` keeps
 * reporting the model we asked for. Comparing those two catches all three
 * lanes, which is what these helpers do.
 */

/** Model tiers we can compare across versions. */
export type ModelTier = 'fable' | 'opus' | 'sonnet' | 'haiku';

const TIERS: ModelTier[] = ['fable', 'opus', 'sonnet', 'haiku'];

/**
 * Reduce any model spelling to a comparable id.
 *
 * Handles the Tide Commander `[1m]` suffix (a context-window label, not a
 * different model), cloud-vendor prefixes (Bedrock `us.anthropic.…`, Vertex),
 * dated snapshots (`-20260115`) and Bedrock revisions (`-v1:0`). Returns null
 * for values that name no real model — `<synthetic>` is the CLI's placeholder
 * for locally generated messages (rate-limit notices, cancellations).
 */
export function normalizeModelId(raw?: string | null): string | null {
  if (!raw) return null;
  let id = raw.trim().toLowerCase();
  if (!id || id === '<synthetic>' || id === 'synthetic') return null;

  id = id.replace(/\[1m\]$/, '');
  id = id.replace(/^(?:bedrock|vertex|anthropic)\//, '');
  id = id.replace(/^(?:us|eu|apac|global)\./, '');
  id = id.replace(/^anthropic\./, '');
  id = id.replace(/-v\d+:\d+$/, '');
  id = id.replace(/[-@]\d{8}$/, '');
  id = id.replace(/-latest$/, '');

  return id || null;
}

/** Which family a model belongs to, regardless of version. */
export function modelTier(raw?: string | null): ModelTier | null {
  const id = normalizeModelId(raw);
  if (!id) return null;
  return TIERS.find((tier) => id === tier || id.includes(tier)) ?? null;
}

/**
 * True when the id names only a family and lets the CLI pick the version
 * (`opus`, `sonnet`, `haiku`, `default`). Those requests cannot be compared
 * version-for-version — whatever version the CLI resolves is legitimate — so
 * they are only checked at tier level.
 */
export function isModelAlias(raw?: string | null): boolean {
  const id = normalizeModelId(raw);
  if (!id) return false;
  return id === 'default' || (TIERS as string[]).includes(id);
}

const TIER_LABELS: Record<ModelTier, string> = {
  fable: 'Fable',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
};

/**
 * Compact human label for a model id: `claude-opus-4-8` → `Opus 4.8`.
 * Falls back to the raw id when the shape is unfamiliar, so an unknown model
 * still shows something truthful instead of a wrong guess.
 */
export function formatModelName(raw?: string | null): string {
  const id = normalizeModelId(raw);
  if (!id) return raw?.trim() || 'unknown';

  const tier = modelTier(id);
  if (!tier) return raw?.trim() || id;

  // Version digits, in either modern (`claude-opus-4-8`) or legacy
  // (`claude-3-5-sonnet`) ordering — both reduce to the same digit list.
  const digits = id
    .split('-')
    .filter((part) => /^\d+$/.test(part));

  const label = TIER_LABELS[tier];
  if (digits.length === 0) return label;
  return `${label} ${digits.join('.')}`;
}

export interface ModelFallbackDetection {
  /** Normalized model the session asked for. */
  from: string;
  /** Normalized model that actually served the message. */
  to: string;
  fromLabel: string;
  toLabel: string;
  /** True when the swap also crossed tiers (e.g. Fable → Opus). */
  tierChanged: boolean;
}

/**
 * Compare the requested session model against the model that actually served a
 * message. Returns null when there is nothing to report:
 *  - either side is unknown or `<synthetic>`,
 *  - the models match,
 *  - the request was a bare family alias and the served model is in that same
 *    family (the CLI resolving `opus` → `claude-opus-4-8` is not a fallback).
 */
export function detectModelFallback(
  requested?: string | null,
  served?: string | null
): ModelFallbackDetection | null {
  const from = normalizeModelId(requested);
  const to = normalizeModelId(served);
  if (!from || !to || from === to) return null;

  const fromTier = modelTier(from);
  const toTier = modelTier(to);

  // `opus` → `claude-opus-4-8` is the CLI resolving our own alias, not a swap.
  if (isModelAlias(from) && fromTier && fromTier === toTier) return null;

  return {
    from,
    to,
    fromLabel: formatModelName(from),
    toLabel: formatModelName(to),
    tierChanged: fromTier !== toTier,
  };
}

/** A change in which model is answering — reported once per transition. */
export interface ModelFallbackTransition {
  /** True when the requested model took over again. */
  restored: boolean;
  requestedModel: string;
  servedModel: string;
  /** Ready-to-render summary: `Fable 5 → Opus 4.8`, or just `Fable 5` when restored. */
  label: string;
  detection: ModelFallbackDetection | null;
}

/**
 * Per-agent state machine over "which model answered this message".
 *
 * Reports the *edges* only — one transition when the API starts serving
 * something else, one when the requested model comes back — so a fallback that
 * spans twenty turns produces two lines, not forty.
 */
export class ModelFallbackTracker {
  private requested: string | null;
  private served: string | null;

  /**
   * @param requested model this session asked for, if already known
   * @param served    model observed serving it before this tracker existed
   *                  (e.g. restored from a persisted agent record after a
   *                  restart) so the "back to normal" edge isn't lost
   */
  constructor(requested?: string | null, served?: string | null) {
    this.requested = requested ?? null;
    this.served = served ?? null;
  }

  get requestedModel(): string | null {
    return this.requested;
  }

  /**
   * Record which model this run asked for. Keeps the observed served model when
   * the new value is just a different spelling of the same family (our alias
   * `opus` and the CLI's resolution `claude-opus-4-8` trade places between the
   * launch args and `system/init`) — otherwise a sustained fallback would
   * re-announce itself at the top of every turn.
   */
  setRequested(requested: string): void {
    const previous = this.requested;
    if (previous === requested) return;

    // Same model, different spelling. Observed live: the launch args say
    // `claude-haiku-4-5` while a resumed session's `system/init` reports the
    // dated `claude-haiku-4-5-20251001`. Comparing raw strings there would drop
    // the served model at the top of every resumed turn, which is exactly how a
    // sustained fallback would end up re-announcing itself on every turn.
    const previousId = normalizeModelId(previous);
    if (previousId !== null && previousId === normalizeModelId(requested)) {
      this.requested = requested;
      return;
    }

    const tier = modelTier(previous);
    const aliasRefinement =
      previous !== null
      && tier !== null
      && tier === modelTier(requested)
      && (isModelAlias(previous) || isModelAlias(requested));

    this.requested = requested;
    // Learning the requested model for the first time invalidates nothing — in
    // particular it must not drop a served model seeded from a persisted agent
    // record, which is the whole point of that seed.
    if (previous !== null && !aliasRefinement) this.served = null;
  }

  /**
   * Feed the model that served a main-loop message. Returns a transition only
   * when the situation actually changed, otherwise null.
   */
  observe(servedModel: string): ModelFallbackTransition | null {
    if (!this.requested) return null;

    const detection = detectModelFallback(this.requested, servedModel);
    const servedNow = detection ? detection.to : null;
    if (servedNow === this.served) return null;

    const wasFallenBack = this.served !== null;
    this.served = servedNow;

    if (detection) {
      return {
        restored: false,
        requestedModel: detection.from,
        servedModel: detection.to,
        label: `${detection.fromLabel} → ${detection.toLabel}`,
        detection,
      };
    }

    if (!wasFallenBack) return null;

    const requested = normalizeModelId(this.requested) || this.requested;
    return {
      restored: true,
      requestedModel: requested,
      servedModel: requested,
      label: formatModelName(requested),
      detection: null,
    };
  }
}
