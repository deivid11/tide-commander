/**
 * Classify the OUTPUT of a bolba-tasks curl (127.0.0.1:7492) into a renderable
 * shape for the Bolba card. The service always answers indented JSON except
 * `?as=text`, which returns a fixed-width table (board/search) or a markdown
 * block (single task). Agents sometimes pipe the JSON through `python3 -c`
 * one-liners — anything unparseable falls back to plain text.
 *
 * Response shapes (confirmed against the live service, 18-ago-2026):
 * - GET /tasks · /search · /duplicates → `{count, tasks: [...]}`
 * - POST /tasks → `{id, task, reimported}` (201)
 * - PATCH /tasks/:id · /close · /reopen → `{task, warnings?, reimported}`
 * - POST /tasks/:id/timeline → `{task, added}`
 * - DELETE /tasks/:id → `{deleted: id}`
 * - GET /health → `{ok, db, drift, stats: {by_status, due_today_or_overdue, …}}`
 * - errors → `{error, valid?}` · 409 dup → `{error, candidates: [...]}`
 */

export interface BolbaTaskRow {
  id?: number;
  proj?: string;
  type?: string;
  status?: string;
  due?: string;
  done?: string;
  section?: string;
  title: string;
  /** Rendered line with project/type emojis — preferred for display. */
  head?: string;
  /** Accumulated minutes. */
  real?: number;
  timelineCount?: number;
  lastEvent?: string;
  /** `age` column from the as=text table (e.g. `4d`). */
  age?: string;
}

export interface BolbaDupCandidate {
  id?: number;
  title: string;
  proj?: string;
  status?: string;
  similarity?: number;
}

export type BolbaTasksOutput =
  | { kind: 'list'; count: number; tasks: BolbaTaskRow[] }
  | { kind: 'mutation'; task: BolbaTaskRow; createdId?: number; added?: number; warnings: string[]; reimported: string[] }
  | { kind: 'deleted'; id: number }
  | { kind: 'duplicate'; error: string; candidates: BolbaDupCandidate[] }
  | { kind: 'error'; error: string; valid?: string[] }
  | { kind: 'health'; ok: boolean; byStatus: Array<[string, number]>; dueTodayOrOverdue?: number }
  | { kind: 'text'; text: string }
  | { kind: 'json'; value: unknown; preview: string };

// Bound the rows materialized for React; the card reports the real total.
const MAX_ROWS = 40;
const MAX_PARSE_CHARS = 2_000_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function toTaskRow(o: Record<string, unknown>): BolbaTaskRow {
  return {
    id: asNum(o.id),
    proj: asStr(o.proj),
    type: asStr(o.type),
    status: asStr(o.status),
    due: asStr(o.due),
    done: asStr(o.done),
    section: asStr(o.section),
    title: asStr(o.title) ?? '—',
    head: asStr(o.head),
    real: asNum(o.real),
    timelineCount: asNum(o.timeline_count),
    lastEvent: asStr(o.last_event),
  };
}

const BOLBA_STATUSES = new Set(['open', 'waiting', 'done', 'delegated', 'discarded']);

/**
 * Parse the `?as=text` board/search table:
 *   id    proj           status    due         age  title
 *   ----- …
 *   5267  OPM            open      2026-08-18  1d   ALT-19309 …
 * `due` may be `-` or carry a time (`2026-08-17 12:00`); a `**bold**` title
 * survives as-is. Returns null when the text doesn't look like the table
 * (e.g. a single task's markdown block) so it renders as plain text instead.
 */
export function parseBolbaTextTable(text: string): BolbaTaskRow[] | null {
  const lines = text.split('\n');
  if (lines.length < 2) return null;
  if (!/^id\s+proj\s+status\s+due/.test(lines[0].trim())) return null;

  const rows: BolbaTaskRow[] = [];
  const ROW_RE = /^(\d+)\s+(\S+)\s+(\S+)\s+(\S+(?:\s\d{2}:\d{2})?|-)\s+(\S+)\s+(.*)$/;
  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed || /^-{3,}/.test(trimmed)) continue;
    const m = ROW_RE.exec(trimmed);
    if (!m || !BOLBA_STATUSES.has(m[3])) continue;
    rows.push({
      id: Number(m[1]),
      proj: m[2],
      status: m[3],
      due: m[4] === '-' ? undefined : m[4],
      age: m[5],
      title: m[6].trim(),
    });
  }
  return rows.length > 0 ? rows : null;
}

export function classifyBolbaTasksOutput(output: string | null | undefined): BolbaTasksOutput | null {
  if (typeof output !== 'string') return null;
  const trimmed = output.trim();
  if (!trimmed) return null;

  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (!looksJson || trimmed.length > MAX_PARSE_CHARS) {
    const tableRows = parseBolbaTextTable(trimmed);
    if (tableRows) return { kind: 'list', count: tableRows.length, tasks: tableRows.slice(0, MAX_ROWS) };
    return { kind: 'text', text: trimmed };
  }

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { kind: 'text', text: trimmed };
  }
  if (!isRecord(value)) {
    const compact = JSON.stringify(value);
    return { kind: 'json', value, preview: compact.length > 160 ? `${compact.slice(0, 159)}…` : compact };
  }

  // Errors first — 409 duplicate decision gets its own shape.
  const error = asStr(value.error);
  if (error) {
    if (Array.isArray(value.candidates)) {
      const candidates = value.candidates.filter(isRecord).slice(0, 8).map((c): BolbaDupCandidate => ({
        id: asNum(c.id),
        title: asStr(c.title) ?? '—',
        proj: asStr(c.proj),
        status: asStr(c.status),
        similarity: asNum(c.similarity),
      }));
      return { kind: 'duplicate', error, candidates };
    }
    const valid = Array.isArray(value.valid) ? value.valid.filter((v): v is string => typeof v === 'string') : undefined;
    return { kind: 'error', error, valid };
  }

  // DELETE /tasks/:id
  const deleted = asNum(value.deleted);
  if (deleted !== undefined) return { kind: 'deleted', id: deleted };

  // Listings: {count, tasks: [...]}
  if (Array.isArray(value.tasks)) {
    const records = value.tasks.filter(isRecord);
    return {
      kind: 'list',
      count: asNum(value.count) ?? records.length,
      tasks: records.slice(0, MAX_ROWS).map(toTaskRow),
    };
  }

  // Mutations: {task: {...}, ...}
  if (isRecord(value.task)) {
    const warnings = Array.isArray(value.warnings)
      ? value.warnings.filter((w): w is string => typeof w === 'string')
      : [];
    const reimported = Array.isArray(value.reimported)
      ? value.reimported.filter((r): r is string => typeof r === 'string')
      : [];
    return {
      kind: 'mutation',
      task: toTaskRow(value.task),
      createdId: asNum(value.id),
      added: asNum(value.added),
      warnings,
      reimported,
    };
  }

  // GET /health (`{ok, stats: {...}}`) and GET /stats (the stats object bare).
  const statsSource = typeof value.ok === 'boolean' && isRecord(value.stats)
    ? value.stats
    : isRecord(value.by_status) ? value : undefined;
  if (statsSource) {
    const byStatusRaw = isRecord(statsSource.by_status) ? statsSource.by_status : {};
    const byStatus = Object.entries(byStatusRaw)
      .filter((e): e is [string, number] => typeof e[1] === 'number');
    return {
      kind: 'health',
      ok: typeof value.ok === 'boolean' ? value.ok : true,
      byStatus,
      dueTodayOrOverdue: asNum(statsSource.due_today_or_overdue),
    };
  }

  // Single task fetched directly (GET /tasks/:id returns the task object).
  if (asNum(value.id) !== undefined && asStr(value.title) !== undefined) {
    return { kind: 'mutation', task: toTaskRow(value), warnings: [], reimported: [] };
  }

  const compact = JSON.stringify(value);
  return { kind: 'json', value, preview: compact.length > 160 ? `${compact.slice(0, 159)}…` : compact };
}
