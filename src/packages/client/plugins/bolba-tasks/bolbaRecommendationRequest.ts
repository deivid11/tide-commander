export const BOLBA_RECOMMENDATION_REQUEST_MARKER = '[BOLBA_TASK_RECOMMENDATIONS_REQUEST]';

export interface BolbaRecommendationRequestInfo {
  count?: number;
  day?: string;
}

export function parseBolbaRecommendationRequest(text: string | null | undefined): BolbaRecommendationRequestInfo | null {
  const trimmed = text?.trim() ?? '';
  if (!trimmed.startsWith(BOLBA_RECOMMENDATION_REQUEST_MARKER)) return null;
  const match = /elige exactamente\s+(\d+)\s+para completar hoy\s+\((\d{4}-\d{2}-\d{2})\)/i.exec(trimmed);
  return {
    ...(match?.[1] ? { count: Number(match[1]) } : {}),
    ...(match?.[2] ? { day: match[2] } : {}),
  };
}

export function bolbaRecommendationRequestPreview(text: string | null | undefined): string | null {
  const request = parseBolbaRecommendationRequest(text);
  if (!request) return null;
  return `Bolba · IA analizando${request.count ? ` ${request.count}` : ''} recomendaciones…`;
}
