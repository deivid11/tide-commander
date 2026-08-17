/** Minimal structural API keeps this extension standalone when loaded by Pi. */
interface PiExtensionApi {
  on: (
    event: 'before_provider_request',
    handler: (event: { payload?: unknown }) => unknown,
  ) => void;
}

/**
 * Request the richest safe reasoning summary supported by OpenAI Responses.
 * The full chain of thought remains in the provider's encrypted payload.
 */
export function requestDetailedReasoningSummary(payload: unknown): unknown | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;

  const request = payload as Record<string, unknown>;
  const reasoning = request.reasoning;
  const include = request.include;
  const isEncryptedResponsesRequest = Array.isArray(include)
    && include.includes('reasoning.encrypted_content');

  if (!isEncryptedResponsesRequest || !reasoning || typeof reasoning !== 'object' || Array.isArray(reasoning)) {
    return undefined;
  }

  // Preserve effort and every other provider request field. This changes only
  // OpenAI Responses/Codex Responses summary verbosity (`auto` often returns
  // the short titles Tide users previously saw).
  return {
    ...request,
    reasoning: {
      ...(reasoning as Record<string, unknown>),
      summary: 'detailed',
    },
  };
}

export default function detailedReasoningExtension(pi: PiExtensionApi): void {
  pi.on('before_provider_request', (event) =>
    requestDetailedReasoningSummary(event?.payload));
}
