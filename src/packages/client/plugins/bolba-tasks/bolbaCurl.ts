import type { ParsedCurl } from '../../components/ClaudeOutputPanel/curlParser';

const BOLBA_TASKS_URL_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):7492(\/[^?#]*)?(?:\?([^#]*))?$/i;

export type BolbaTasksAction =
  | 'board' | 'task' | 'search' | 'duplicates' | 'stats' | 'health'
  | 'create' | 'update' | 'timeline' | 'close' | 'reopen' | 'delete'
  | 'render' | 'sync' | 'config' | 'other';

export interface BolbaTasksCall {
  method: string;
  path: string;
  action: BolbaTasksAction;
  verb: string;
  icon: string;
  taskId?: string;
  query?: string;
  filters?: string;
  asText: boolean;
  body?: Record<string, unknown>;
  actor?: string;
}

const BOLBA_VERBS: Record<BolbaTasksAction, { verb: string; icon: string }> = {
  board: { verb: 'Tablero', icon: 'list-checks' },
  task: { verb: 'Tarea', icon: 'task' },
  search: { verb: 'Búsqueda', icon: 'search' },
  duplicates: { verb: 'Duplicados', icon: 'copy' },
  stats: { verb: 'Stats', icon: 'chart-line' },
  health: { verb: 'Salud', icon: 'health' },
  create: { verb: 'Nueva tarea', icon: 'plus' },
  update: { verb: 'Actualizar', icon: 'edit' },
  timeline: { verb: 'Eventos', icon: 'history' },
  close: { verb: 'Cerrar', icon: 'check' },
  reopen: { verb: 'Reabrir', icon: 'arrow-clockwise' },
  delete: { verb: 'Borrar', icon: 'trash' },
  render: { verb: 'Re-render', icon: 'refresh' },
  sync: { verb: 'Sync', icon: 'arrow-clockwise' },
  config: { verb: 'Config', icon: 'gear' },
  other: { verb: 'Llamada', icon: 'plant' },
};

const BOLBA_FILTER_KEYS = new Set(['status', 'proj', 'type', 'due', 'stale', 'from', 'coti', 'limit', 'scope']);

function extractHeredocBody(raw: string): string | null {
  const marker = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n/.exec(raw);
  if (!marker) return null;
  const start = marker.index + marker[0].length;
  const terminator = marker[2];
  const rest = raw.slice(start);
  const endPattern = new RegExp(`(?:^|\\n)[\\t ]*${terminator}[\\t ]*(?:\\n|$)`);
  const end = endPattern.exec(rest);
  return end ? rest.slice(0, end.index).replace(/^\n/, '') : null;
}

/** Matcher contributed by the Bolba plugin for legacy agent curl calls. */
export function detectBolbaTasksCall(parsed: ParsedCurl, rawCommand?: string): BolbaTasksCall | null {
  const match = BOLBA_TASKS_URL_RE.exec(parsed.url);
  if (!match) return null;
  const path = (match[1] || '/').replace(/\/+$/, '') || '/';
  const segments = path.split('/').filter(Boolean);
  const method = parsed.method;

  let body: Record<string, unknown> | undefined;
  const readBody = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  body = readBody(parsed.bodyJson);
  if (body === undefined && parsed.body === '@-' && rawCommand) {
    const heredoc = extractHeredocBody(rawCommand);
    if (heredoc) {
      try { body = readBody(JSON.parse(heredoc.trim())); } catch { /* leave undefined */ }
    }
  }

  let query: string | undefined;
  let asText = false;
  const filters: string[] = [];
  if (match[2]) {
    for (const pair of match[2].split('&')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const key = pair.slice(0, eq).toLowerCase();
      const rawValue = pair.slice(eq + 1);
      let value: string;
      try { value = decodeURIComponent(rawValue.replace(/\+/g, ' ')); } catch { value = rawValue; }
      if (key === 'q' || key === 'title') query = value;
      else if (key === 'as' && value === 'text') asText = true;
      else if (BOLBA_FILTER_KEYS.has(key)) filters.push(`${key}=${value}`);
    }
  }

  let action: BolbaTasksAction = 'other';
  let taskId: string | undefined;
  const root = (segments[0] || '').toLowerCase();
  if (root === 'tasks') {
    taskId = segments[1] && /^\d+$/.test(segments[1]) ? segments[1] : undefined;
    const sub = (segments[2] || '').toLowerCase();
    if (taskId && sub === 'close') action = 'close';
    else if (taskId && sub === 'reopen') action = 'reopen';
    else if (taskId && sub === 'timeline') action = 'timeline';
    else if (taskId) action = method === 'DELETE' ? 'delete' : (method === 'PATCH' || method === 'PUT') ? 'update' : 'task';
    else action = method === 'POST' ? 'create' : 'board';
  } else if (root === 'search') action = 'search';
  else if (root === 'duplicates') action = 'duplicates';
  else if (root === 'stats') action = 'stats';
  else if (root === 'health') action = 'health';
  else if (root === 'render') action = 'render';
  else if (root === 'sync') action = 'sync';
  else if (root === 'config') action = 'config';

  const actorEntry = Object.entries(parsed.headers).find(([key]) => key.toLowerCase() === 'x-actor');
  return {
    method,
    path,
    action,
    verb: BOLBA_VERBS[action].verb,
    icon: BOLBA_VERBS[action].icon,
    taskId,
    query,
    filters: filters.length > 0 ? filters.join(' · ') : undefined,
    asText,
    body,
    actor: actorEntry?.[1],
  };
}
