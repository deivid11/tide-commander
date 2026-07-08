/**
 * HttpRunInline — live inline card rendered under a `curl /api/http-requests/run`
 * line in the terminal (mirrors TestRunInline). Driven by http_run_* WebSocket
 * events keyed by runId: spinner while the request is in flight, then a rich
 * result — method chip, status pill, timing, size, colorized JSON body preview,
 * expandable headers — plus Re-run and copy-as-curl buttons.
 */

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../Icon';
import { store, useHttpRun } from '../../store';
import { highlightCode } from '../FileExplorerPanel/syntaxHighlighting';
import { CopyCurlButton } from '../shared/CopyCurlButton';
import { fetchHttpHistory, fetchHttpRun } from '../../api/http-requests';
import type { HttpRunSummary } from '../../../shared/types';

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

function statusColor(ok: boolean, status: number | undefined): string {
  if (!ok || status === undefined) return '#d45a5a';
  if (status < 300) return '#5cb88a';
  if (status < 400) return '#5ad4d4';
  if (status < 500) return '#d4a05a';
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

const MAX_INLINE_BODY = 2000;

export function HttpRunInline({ runId }: { runId: string }) {
  const run = useHttpRun(runId);
  const [showBody, setShowBody] = useState(true);
  const [showHeaders, setShowHeaders] = useState(false);

  const result = run?.result;
  const bodyPreview = useMemo(() => {
    if (!result?.body) return null;
    let text = result.body;
    if (!result.contentType || /json/i.test(result.contentType)) {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* not JSON */
      }
    }
    const truncated = text.length > MAX_INLINE_BODY;
    if (truncated) text = `${text.slice(0, MAX_INLINE_BODY)}…`;
    const isJsonish = text.trimStart().startsWith('{') || text.trimStart().startsWith('[');
    return { html: isJsonish ? highlightCode(text, 'json') : null, text, truncated };
  }, [result]);

  if (!run) return null;

  const running = run.status === 'running';
  const border = running
    ? 'status-running'
    : !result || !result.ok
      ? 'status-error'
      : (result.status ?? 600) < 400
        ? 'status-ok'
        : 'status-http-error';
  const pillColor = result ? statusColor(result.ok, result.status) : '#5a8fd4';

  return (
    <div className={`http-run-inline ${border}`}>
      <div className="hri-header">
        <span className="hri-method" style={{ color: methodColor(run.method) }}>
          {run.method}
        </span>
        <span className="hri-name" title={`${run.relFile}#${run.requestIndex} · ${run.url}`}>
          {run.requestName}
        </span>
        {running ? (
          <span className="hri-running">
            <span className="hri-spin" /> running…
          </span>
        ) : (
          <>
            <span className="hri-status" style={{ color: pillColor, borderColor: pillColor }}>
              {result?.ok && result.status !== undefined
                ? `${result.status}${result.statusText ? ` ${result.statusText}` : ''}`
                : 'ERR'}
            </span>
            {result && <span className="hri-meta">{fmtMs(result.timeMs)}</span>}
            {result?.sizeBytes !== undefined && <span className="hri-meta">{fmtSize(result.sizeBytes)}</span>}
          </>
        )}
        {run.env && <span className="hri-env">{run.env}</span>}
        <span className="hri-actions">
          {!running && result && (
            <>
              {result.headers && result.headers.length > 0 && (
                <button
                  className={`hri-btn ${showHeaders ? 'active' : ''}`}
                  onClick={() => setShowHeaders((v) => !v)}
                  title="Response headers"
                >
                  <Icon name="list" size={11} />
                </button>
              )}
              <CopyCurlButton request={result.request} className="hri-btn" title="Copy as curl (as sent)" />
              <button
                className="hri-btn rerun"
                onClick={() => void store.rerunHttpRun(runId)}
                title="Re-run this request"
              >
                <Icon name="refresh" size={11} /> Re-run
              </button>
            </>
          )}
        </span>
      </div>

      <div className="hri-url" title={result?.request.url || run.url}>
        {result?.request.url || run.url}
        {result?.finalUrl && <span className="hri-redirect"> → {result.finalUrl}</span>}
      </div>

      {!running && result?.error && (
        <div className="hri-error">
          <Icon name="warning-circle" size={12} /> {result.error}
        </div>
      )}
      {!running && result?.unresolvedVariables && result.unresolvedVariables.length > 0 && (
        <div className="hri-warn">
          <Icon name="warning-circle" size={12} /> Unresolved:{' '}
          {result.unresolvedVariables.map((v) => `{{${v}}}`).join(' ')}
        </div>
      )}

      {!running && showHeaders && result?.headers && (
        <div className="hri-headers">
          {result.headers.map((h, i) => (
            <div key={i} className="hri-header-line">
              <span className="hri-header-name">{h.name}:</span> {h.value}
            </div>
          ))}
        </div>
      )}

      {!running && result && !result.bodyBinary && bodyPreview && (
        <>
          <button className="hri-body-toggle" onClick={() => setShowBody((v) => !v)}>
            <Icon name={showBody ? 'caret-down' : 'caret-right'} size={10} />
            {showBody ? 'Hide response' : 'Response'}
          </button>
          {showBody &&
            (bodyPreview.html ? (
              <pre className="hri-body" dangerouslySetInnerHTML={{ __html: bodyPreview.html }} />
            ) : (
              <pre className="hri-body">{bodyPreview.text}</pre>
            ))}
          {showBody && bodyPreview.truncated && <div className="hri-truncated">preview truncated</div>}
        </>
      )}
      {!running && result?.bodyBinary && (
        <div className="hri-truncated">binary response ({fmtSize(result.sizeBytes)}) — not displayed</div>
      )}
    </div>
  );
}

// ============================================================================
// History fallback — reconstruct the card from the persisted run history
// ============================================================================
// Live runs render via http_run_* WS events, but those only exist in memory:
// after a reload (or for runs fired without an agentId) the store is empty.
// Every run IS persisted server-side, so for a `curl /api/http-requests/run`
// line with no in-store match we parse the request params out of the command,
// find the stored run whose finishedAt sits next to the line's timestamp, seed
// the store with it, and render the exact same card (Re-run included).

interface HttpRunParams {
  path: string;
  relFile: string;
  requestIndex: number;
  env?: string;
}

/** Pull the run body fields straight out of the curl command text. */
function parseRunParams(command: string): HttpRunParams | null {
  const path = command.match(/"path"\s*:\s*"([^"]+)"/)?.[1];
  const relFile = command.match(/"relFile"\s*:\s*"([^"]+)"/)?.[1];
  const idx = command.match(/"requestIndex"\s*:\s*(\d+)/)?.[1];
  const env = command.match(/"env"\s*:\s*"([^"]+)"/)?.[1];
  if (!path || !relFile || idx === undefined) return null;
  return { path, relFile, requestIndex: Number(idx), env };
}

// Positive resolutions per line (survives virtualized unmount/remount cycles).
const resolvedRuns = new Map<string, string>();
// Short-lived per-folder history fetch dedupe (many lines share one folder).
const folderFetches = new Map<string, { at: number; promise: Promise<HttpRunSummary[]> }>();

function fetchFolderHistory(folder: string): Promise<HttpRunSummary[]> {
  const cached = folderFetches.get(folder);
  if (cached && Date.now() - cached.at < 15_000) return cached.promise;
  const promise = fetchHttpHistory(folder, 200).catch(() => [] as HttpRunSummary[]);
  folderFetches.set(folder, { at: Date.now(), promise });
  return promise;
}

export function HttpRunLookup({ command, timestampMs }: { command: string; timestampMs: number }) {
  const params = useMemo(() => parseRunParams(command), [command]);
  const lineKey = params ? `${timestampMs}:${params.relFile}#${params.requestIndex}` : '';
  const [runId, setRunId] = useState<string | null>(() => (lineKey && resolvedRuns.get(lineKey)) || null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!params || runId || attempt >= 6) return;
    let live = true;
    // First attempt immediately; retries every 3s (a live run without agentId
    // may not be persisted yet while the request is still in flight).
    const timer = window.setTimeout(async () => {
      const runs = await fetchFolderHistory(params.path);
      if (!live) return;
      const candidates = runs.filter(
        (r) =>
          r.relFile === params.relFile &&
          r.requestIndex === params.requestIndex &&
          r.finishedAt >= timestampMs - 5_000 &&
          r.finishedAt <= timestampMs + 180_000,
      );
      if (candidates.length === 0) {
        // Old line whose run was never persisted (or pruned) — give up quickly.
        setAttempt(Date.now() - timestampMs > 300_000 ? 6 : attempt + 1);
        return;
      }
      const best = candidates.reduce((a, b) =>
        Math.abs(a.finishedAt - timestampMs) <= Math.abs(b.finishedAt - timestampMs) ? a : b,
      );
      // Seed the store (idempotent) so HttpRunInline renders it and Re-run works.
      if (!store.getState().httpRuns?.get(best.runId)?.result) {
        const full = await fetchHttpRun(best.runId);
        if (!live) return;
        if (!full) {
          setAttempt(6);
          return;
        }
        store.handleHttpRunStarted({
          runId: full.runId,
          folder: full.folder,
          relFile: full.relFile,
          requestIndex: full.requestIndex,
          requestName: full.requestName,
          method: full.method,
          url: full.url,
          env: full.env,
        });
        store.handleHttpRunCompleted(full.runId, full.result);
      }
      resolvedRuns.set(lineKey, best.runId);
      setRunId(best.runId);
    }, attempt === 0 ? 0 : 3_000);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [params, runId, attempt, lineKey, timestampMs]);

  if (!runId) return null;
  return <HttpRunInline runId={runId} />;
}
