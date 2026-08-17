export interface PiReasoningMetadata {
  /** Provider-reported hidden reasoning token count for this assistant message. */
  reasoningTokens?: number;
  /** Number of plaintext reasoning summary sections exposed by the provider. */
  reasoningSummaryCount?: number;
  /** True when the detailed reasoning exists only as an encrypted provider payload. */
  reasoningEncrypted?: boolean;
  /** True when the visible text is a provider summary rather than full reasoning. */
  reasoningSummaryOnly?: boolean;
}

interface OpenAIReasoningSignature {
  encrypted_content?: unknown;
  summary?: unknown;
  content?: unknown;
}

function nonEmptyTextParts(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.filter((part) => {
    if (!part || typeof part !== 'object') return false;
    const text = (part as { text?: unknown }).text;
    return typeof text === 'string' && text.trim().length > 0;
  }).length;
}

/**
 * Extract the useful, safe metadata Pi persists around a thinking block.
 * OpenAI/Codex models expose plaintext summaries while keeping the detailed
 * chain of thought in `encrypted_content`; that payload cannot be decrypted by
 * Tide Commander, but its presence lets the UI explain why only titles exist.
 */
export function extractPiReasoningMetadata(
  thinkingSignature: unknown,
  reasoningTokens: unknown,
): PiReasoningMetadata {
  const metadata: PiReasoningMetadata = {};
  if (typeof reasoningTokens === 'number' && Number.isFinite(reasoningTokens) && reasoningTokens >= 0) {
    metadata.reasoningTokens = reasoningTokens;
  }

  if (typeof thinkingSignature !== 'string' || !thinkingSignature.trim()) {
    return metadata;
  }

  let signature: OpenAIReasoningSignature;
  try {
    signature = JSON.parse(thinkingSignature) as OpenAIReasoningSignature;
  } catch {
    return metadata;
  }

  const summaryCount = nonEmptyTextParts(signature.summary);
  const fullTextCount = nonEmptyTextParts(signature.content);
  const encrypted = typeof signature.encrypted_content === 'string'
    && signature.encrypted_content.length > 0;

  if (summaryCount > 0) metadata.reasoningSummaryCount = summaryCount;
  if (encrypted) metadata.reasoningEncrypted = true;
  if (encrypted && summaryCount > 0 && fullTextCount === 0) {
    metadata.reasoningSummaryOnly = true;
  }

  return metadata;
}
