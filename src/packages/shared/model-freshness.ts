/**
 * Is an agent running an older model generation than the one Tide Commander
 * now offers? Drives the small ⚠ on the header model chip ("Opus 5 [1M] —
 * newer: Opus 5.5 [1M]").
 *
 * Only generations count: the plain 200K id of the current model, family
 * aliases (`opus`, `sonnet`, whose version the CLI resolves to the latest) and
 * families with a single current model (Haiku) are never flagged.
 */

import {
  CLAUDE_MODELS,
  CODEX_MODELS,
  DEFAULT_CODEX_MODEL,
  migrateRetiredCodexModel,
  type ClaudeModel,
  type CodexModel,
} from './agent-types.js';

export interface OutdatedModelNotice {
  /** Label of the newest model of the same family, e.g. `Opus 5.5 [1M]`. */
  newerLabel: string;
  /** Model id to switch to. */
  newerModel: string;
}

// Newest model of each Claude family, as offered in the pickers.
const LATEST_CLAUDE: Record<'opus' | 'fable' | 'sonnet', ClaudeModel> = {
  opus: 'claude-opus-5-5[1m]',
  fable: 'claude-fable-5-1',
  sonnet: 'claude-sonnet-5-5',
};

// Tide labels whose bare id doesn't say the version.
const LABEL_ALIASES: Record<string, string> = { 'opus[1m]': 'claude-opus-4-7' };

const bareClaudeId = (model: string): string =>
  (LABEL_ALIASES[model] ?? model).replace(/\[1m\]$/, '');

/** Notice for a Claude model id (Tide `[1m]` label or bare id). */
export function outdatedClaudeModel(model: string | undefined | null): OutdatedModelNotice | null {
  if (!model) return null;
  const id = bareClaudeId(model.trim());
  const family = (['opus', 'fable', 'sonnet'] as const).find((name) => id.startsWith(`claude-${name}-`));
  if (!family) return null; // aliases (`opus`, `sonnet`), haiku, unknown ids
  const latest = LATEST_CLAUDE[family];
  if (id === bareClaudeId(latest)) return null;
  return { newerModel: latest, newerLabel: CLAUDE_MODELS[latest].label };
}

// GPT-6 models superseded by a point release of the same line.
const CODEX_POINT_RELEASES: Readonly<Record<string, CodexModel>> = {
  'gpt-6-sol': 'gpt-6.1-sol',
};

/** Notice for a Codex model id (bare or `openai-codex/…`). */
export function outdatedCodexModel(model: string | undefined | null): OutdatedModelNotice | null {
  if (!model) return null;
  const id = model.trim().replace(/^openai-codex\//, '');
  // A GPT-6 model with a point release of its own line (6 Sol → 6.1 Sol).
  const pointRelease = CODEX_POINT_RELEASES[id];
  if (pointRelease) return { newerModel: pointRelease, newerLabel: CODEX_MODELS[pointRelease].label };
  if (!/^gpt-5(?:[.-]|$)/.test(id)) return null; // the rest of GPT-6 is current
  // The retired model's own successor when it has one (5.6 Luna → 6 Luna),
  // else the default (Terra has no GPT-6 counterpart and is still registered).
  const successor = migrateRetiredCodexModel(id);
  const newerModel = (successor !== id && successor in CODEX_MODELS ? successor : DEFAULT_CODEX_MODEL) as CodexModel;
  return { newerModel, newerLabel: CODEX_MODELS[newerModel].label };
}

/** Notice for whatever model an agent is configured with, per provider. */
export function outdatedAgentModel(agent: {
  provider?: string;
  model?: string;
  codexModel?: string;
  piModel?: string;
}): OutdatedModelNotice | null {
  switch (agent.provider ?? 'claude') {
    case 'claude':
      return outdatedClaudeModel(agent.model);
    case 'codex':
      return outdatedCodexModel(agent.codexModel);
    case 'pi': {
      // Only where pi's own catalog already has the newer model: GPT-6 via
      // openai-codex. Its Anthropic catalog tops out below Opus 5.5.
      const piModel = agent.piModel ?? '';
      const notice = piModel.startsWith('openai-codex/') ? outdatedCodexModel(piModel) : null;
      return notice && { ...notice, newerModel: `openai-codex/${notice.newerModel}` };
    }
    default:
      return null;
  }
}
