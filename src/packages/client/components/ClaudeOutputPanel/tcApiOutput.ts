/**
 * Classify the OUTPUT of an internal Tide Commander API curl into a renderable
 * shape for the TC API card. Works on raw endpoint payloads AND on jq
 * projections of them (a projection like `{id, name, status}` keeps the
 * discriminating keys), falling back to pretty JSON for unrecognized
 * structures and to plain text for non-JSON output (e.g. `jq 'length'` →
 * "166", or `jq -r` tab-separated lines).
 */

export interface TcAgentRow {
  id?: string;
  name: string;
  status?: string;
  agentClass?: string;
  cwd?: string;
  provider?: string;
}

export interface TcSkillRow {
  id?: string;
  name: string;
  description?: string;
  enabled?: boolean;
  assignedCount?: number;
}

export interface TcAreaRow {
  id?: string;
  name: string;
  color?: string;
  agentCount?: number;
}

export interface TcBuildingRow {
  id?: string;
  name: string;
  buildingType?: string;
  status?: string;
}

export type TcApiListing =
  | { kind: 'agents'; rows: TcAgentRow[]; total: number }
  | { kind: 'skills'; rows: TcSkillRow[]; total: number }
  | { kind: 'areas'; rows: TcAreaRow[]; total: number }
  | { kind: 'buildings'; rows: TcBuildingRow[]; total: number }
  | { kind: 'json'; value: unknown; preview: string }
  | { kind: 'text'; text: string };

// Bound the rows materialized for React; the card reports the real total.
const MAX_ROWS = 40;
// Skip JSON.parse on absurdly large outputs — show them as text instead.
const MAX_PARSE_CHARS = 2_000_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

type ListKind = 'agents' | 'skills' | 'areas' | 'buildings';

const BUILDING_TYPES = new Set(['server', 'boss', 'database', 'http', 'tests']);

/**
 * Decide what entity an object is, from its keys. Order matters: skills also
 * carry `assignedAgentIds` (checked before areas) and buildings also carry
 * `status`+`cwd` (checked before the agents fallback).
 */
function sniffKind(sample: Record<string, unknown>): ListKind | null {
  const has = (k: string) => k in sample;
  if (has('slug') || has('allowedTools') || has('assignedAgentClasses')) return 'skills';
  if (has('pm2') || has('folderPath') || (typeof sample.type === 'string' && BUILDING_TYPES.has(sample.type))) {
    return 'buildings';
  }
  if (has('assignedAgentIds') || has('center') || sample.type === 'rectangle') return 'areas';
  if (
    has('class') || has('provider') || has('permissionMode') || has('contextUsed')
    || has('isBoss') || has('sessionId') || has('lastActivity')
    || (has('status') && has('cwd'))
  ) {
    return 'agents';
  }
  return null;
}

function rowName(obj: Record<string, unknown>): string {
  return asStr(obj.name) ?? asStr(obj.id) ?? '—';
}

function buildListing(kind: ListKind, items: Record<string, unknown>[], total: number): TcApiListing {
  switch (kind) {
    case 'agents':
      return {
        kind,
        total,
        rows: items.map((o): TcAgentRow => ({
          id: asStr(o.id),
          name: rowName(o),
          status: asStr(o.status),
          agentClass: asStr(o.class),
          cwd: asStr(o.cwd),
          provider: asStr(o.provider),
        })),
      };
    case 'skills':
      return {
        kind,
        total,
        rows: items.map((o): TcSkillRow => {
          const ids = Array.isArray(o.assignedAgentIds) ? o.assignedAgentIds.length : 0;
          const classes = Array.isArray(o.assignedAgentClasses) ? o.assignedAgentClasses.length : 0;
          return {
            id: asStr(o.id),
            name: rowName(o),
            description: asStr(o.description),
            enabled: typeof o.enabled === 'boolean' ? o.enabled : undefined,
            assignedCount: ids + classes > 0 ? ids + classes : undefined,
          };
        }),
      };
    case 'areas':
      return {
        kind,
        total,
        rows: items.map((o): TcAreaRow => ({
          id: asStr(o.id),
          name: rowName(o),
          color: asStr(o.color),
          agentCount: Array.isArray(o.assignedAgentIds) ? o.assignedAgentIds.length : undefined,
        })),
      };
    case 'buildings':
      return {
        kind,
        total,
        rows: items.map((o): TcBuildingRow => ({
          id: asStr(o.id),
          name: rowName(o),
          buildingType: asStr(o.type),
          status: asStr(o.status),
        })),
      };
  }
}

/** Unwrap single-list envelopes like `{skills: [...]}` or `{agents: [...]}`. */
function unwrapEnvelope(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const arrayEntries = Object.entries(value).filter(([, v]) => Array.isArray(v));
  if (arrayEntries.length === 1 && Object.keys(value).length <= 2) {
    return arrayEntries[0][1];
  }
  return value;
}

export function classifyTcApiOutput(output: string | null | undefined): TcApiListing | null {
  if (typeof output !== 'string') return null;
  const trimmed = output.trim();
  if (!trimmed) return null;

  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (!looksJson || trimmed.length > MAX_PARSE_CHARS) {
    return { kind: 'text', text: trimmed };
  }

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    // jq multi-document output, truncated JSON, mixed text — show as text.
    return { kind: 'text', text: trimmed };
  }

  const unwrapped = unwrapEnvelope(value);
  if (Array.isArray(unwrapped) && unwrapped.length > 0) {
    const records = unwrapped.filter(isRecord);
    if (records.length === unwrapped.length) {
      const kind = sniffKind(records[0]);
      if (kind) return buildListing(kind, records.slice(0, MAX_ROWS), records.length);
    }
  }

  const compact = JSON.stringify(value);
  const preview = compact.length > 160 ? `${compact.slice(0, 159)}…` : compact;
  return { kind: 'json', value, preview };
}
