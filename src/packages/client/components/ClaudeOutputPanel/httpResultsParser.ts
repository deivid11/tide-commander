/**
 * Detects Tide Commander HTTP-request results in agent output (the JSON the
 * `/api/http-requests/run` and `/api/http-requests/history` endpoints return,
 * printed by a `curl` in the HTTP Request Tests skill) and extracts a compact
 * summary so the terminal renders a card instead of raw JSON. Returns null for
 * anything else — safe to call on every tool/bash output.
 */

export interface HttpRunRow {
  method: string;
  url: string;
  /** ### name of the request when known. */
  name?: string;
  ok: boolean;
  status?: number;
  statusText?: string;
  timeMs: number;
  sizeBytes?: number;
  error?: string;
  env?: string;
  finishedAt?: number;
}

export interface HttpResultsCardData {
  kind: 'single' | 'list';
  rows: HttpRunRow[]; // single → exactly one row
  /** Full list length before capping rows (list kind). */
  total: number;
  /** Single kind extras */
  contentType?: string;
  unresolvedVariables?: string[];
  bodyPreview?: string;
  bodyTruncated?: boolean;
}

const MAX_LIST_ROWS = 8;
const MAX_BODY_PREVIEW = 600;

function coerceObject(text: string): any | null {
  const t = text.trim();
  if (!t.startsWith('{')) return null;
  // Cheap gate before attempting JSON.parse on arbitrary output.
  if (!t.includes('"timeMs"')) return null;
  try {
    return JSON.parse(t);
  } catch {
    // Tolerate leading/trailing noise around a single JSON object.
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function isRunShape(o: any): boolean {
  return (
    o &&
    typeof o === 'object' &&
    typeof o.timeMs === 'number' &&
    typeof o.ok === 'boolean' &&
    (typeof o.url === 'string' || typeof o.request?.url === 'string')
  );
}

function previewBody(body: unknown, contentType: unknown): string | undefined {
  if (typeof body !== 'string' || !body) return undefined;
  let text = body;
  if (!contentType || /json/i.test(String(contentType))) {
    try {
      text = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      /* not JSON */
    }
  }
  return text.length > MAX_BODY_PREVIEW ? `${text.slice(0, MAX_BODY_PREVIEW)}…` : text;
}

export function parseHttpResults(text: string): HttpResultsCardData | null {
  if (!text) return null;
  const obj = coerceObject(text);
  if (!obj) return null;

  // Shape A: single run result from POST /api/http-requests/run
  // ({request:{method,url,...}, ok, timeMs, status?...}).
  if (isRunShape(obj) && obj.request && typeof obj.request.method === 'string') {
    const row: HttpRunRow = {
      method: obj.request.method,
      url: String(obj.request.url ?? ''),
      name: typeof obj.requestName === 'string' ? obj.requestName : undefined,
      ok: !!obj.ok,
      status: typeof obj.status === 'number' ? obj.status : undefined,
      statusText: typeof obj.statusText === 'string' ? obj.statusText : undefined,
      timeMs: obj.timeMs,
      sizeBytes: typeof obj.sizeBytes === 'number' ? obj.sizeBytes : undefined,
      error: typeof obj.error === 'string' ? obj.error : undefined,
    };
    return {
      kind: 'single',
      rows: [row],
      total: 1,
      contentType: typeof obj.contentType === 'string' ? obj.contentType.split(';')[0] : undefined,
      unresolvedVariables:
        Array.isArray(obj.unresolvedVariables) && obj.unresolvedVariables.length
          ? obj.unresolvedVariables.map(String)
          : undefined,
      bodyPreview: previewBody(obj.body, obj.contentType),
      bodyTruncated: !!obj.bodyTruncated,
    };
  }

  // Shape B: history list from GET /api/http-requests/history
  // ({runs:[{method,url,ok,timeMs,...}]}). Empty lists stay as raw JSON —
  // an empty `runs` array is ambiguous with the tests history endpoint.
  if (Array.isArray(obj.runs) && obj.runs.length > 0 && obj.runs.every(isRunShape)) {
    const rows: HttpRunRow[] = obj.runs.slice(0, MAX_LIST_ROWS).map((r: any) => ({
      method: String(r.method ?? r.request?.method ?? '?'),
      url: String(r.url ?? r.request?.url ?? ''),
      name: typeof r.requestName === 'string' ? r.requestName : undefined,
      ok: !!r.ok,
      status: typeof r.status === 'number' ? r.status : undefined,
      timeMs: r.timeMs,
      sizeBytes: typeof r.sizeBytes === 'number' ? r.sizeBytes : undefined,
      error: typeof r.error === 'string' ? r.error : undefined,
      env: typeof r.env === 'string' ? r.env : undefined,
      finishedAt: typeof r.finishedAt === 'number' ? r.finishedAt : undefined,
    }));
    return { kind: 'list', rows, total: obj.runs.length };
  }

  return null;
}
