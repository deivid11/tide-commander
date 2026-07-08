/**
 * HttpResultsCard — compact card rendered in the terminal when an agent's
 * output contains a Tide Commander HTTP-request result (see httpResultsParser):
 * a single fired request (method, status pill, time, size, body preview) or a
 * history list of recent runs. Visual language mirrors TestResultsCard.
 */

import { useMemo } from 'react';
import { Icon } from '../Icon';
import { highlightCode } from '../FileExplorerPanel/syntaxHighlighting';
import type { HttpResultsCardData, HttpRunRow } from './httpResultsParser';

const METHOD_COLORS: Record<string, string> = {
  GET: '#5cb88a',
  POST: '#5a8fd4',
  PUT: '#d4a05a',
  PATCH: '#a855f7',
  DELETE: '#d45a5a',
  HEAD: '#5ad4d4',
  OPTIONS: '#8a8a98',
};

function methodColor(method: string): string {
  return METHOD_COLORS[method.toUpperCase()] ?? '#8a8a98';
}

function statusColor(row: HttpRunRow): string {
  if (!row.ok || row.status === undefined) return '#d45a5a';
  if (row.status < 300) return '#5cb88a';
  if (row.status < 400) return '#5ad4d4';
  if (row.status < 500) return '#d4a05a';
  return '#d45a5a';
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtSize(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtAgo(ms: number | undefined): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatusPill({ row }: { row: HttpRunRow }) {
  const color = statusColor(row);
  return (
    <span className="hrc-status" style={{ color, borderColor: color }}>
      {row.ok && row.status !== undefined ? `${row.status}${row.statusText ? ` ${row.statusText}` : ''}` : 'ERR'}
    </span>
  );
}

export function HttpResultsCard({ data }: { data: HttpResultsCardData }) {
  // Prism-colorize JSON previews (token CSS is global, shipped by the file
  // explorer's syntax theme). Hook must run unconditionally — before the
  // list-kind early return.
  const bodyHtml = useMemo(() => {
    const preview = data.kind === 'single' ? data.bodyPreview : undefined;
    if (!preview) return null;
    const t = preview.trimStart();
    return t.startsWith('{') || t.startsWith('[') ? highlightCode(preview, 'json') : null;
  }, [data]);

  if (data.kind === 'list') {
    const okCount = data.rows.filter((r) => r.ok && (r.status ?? 600) < 400).length;
    return (
      <div className="http-results-card list">
        <div className="hrc-header">
          <span className="hrc-title">
            <Icon name="globe" size={13} /> HTTP requests · {data.total} run{data.total === 1 ? '' : 's'}
          </span>
          <span className="hrc-meta">{okCount}/{data.rows.length} ok shown</span>
        </div>
        <div className="hrc-rows">
          {data.rows.map((r, i) => (
            <div key={i} className="hrc-row" title={r.url}>
              <span className="hrc-method" style={{ color: methodColor(r.method) }}>{r.method}</span>
              <span className="hrc-name">{r.name || r.url}</span>
              <StatusPill row={r} />
              <span className="hrc-meta">{fmtMs(r.timeMs)}</span>
              {r.env && <span className="hrc-env">{r.env}</span>}
              {r.finishedAt !== undefined && <span className="hrc-meta when">{fmtAgo(r.finishedAt)}</span>}
            </div>
          ))}
          {data.total > data.rows.length && <div className="hrc-more">+{data.total - data.rows.length} more</div>}
        </div>
      </div>
    );
  }

  const row = data.rows[0];
  const borderClass = !row.ok ? 'status-error' : (row.status ?? 600) < 400 ? 'status-ok' : 'status-http-error';
  return (
    <div className={`http-results-card single ${borderClass}`}>
      <div className="hrc-header">
        <span className="hrc-method big" style={{ color: methodColor(row.method) }}>{row.method}</span>
        {row.name && <span className="hrc-name">{row.name}</span>}
        <StatusPill row={row} />
        <span className="hrc-meta">{fmtMs(row.timeMs)}</span>
        {row.sizeBytes !== undefined && <span className="hrc-meta">{fmtSize(row.sizeBytes)}</span>}
        {data.contentType && <span className="hrc-meta type">{data.contentType}</span>}
      </div>
      <div className="hrc-url" title={row.url}>{row.url}</div>

      {row.error && (
        <div className="hrc-error">
          <Icon name="warning-circle" size={12} /> {row.error}
        </div>
      )}
      {data.unresolvedVariables && (
        <div className="hrc-warn">
          <Icon name="warning-circle" size={12} /> Unresolved: {data.unresolvedVariables.map((v) => `{{${v}}}`).join(' ')}
        </div>
      )}

      {data.bodyPreview &&
        (bodyHtml ? (
          <pre className="hrc-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        ) : (
          <pre className="hrc-body">
            {data.bodyPreview}
            {data.bodyTruncated && '\n… [response truncated at 2 MB]'}
          </pre>
        ))}
    </div>
  );
}
