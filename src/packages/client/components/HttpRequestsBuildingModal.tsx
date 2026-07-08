/**
 * HttpRequestsBuildingModal - Browser for an "http" building (IntelliJ-style
 * .http request files).
 *
 * Scans the building's configured folder for .http/.rest files (POST
 * /api/http-requests/scan), lists every request with a per-request play
 * button, and fires them one at a time (POST /api/http-requests/run) showing
 * the response — status, time, size, headers and pretty-printed body — in the
 * right-hand panel. {{variables}} resolve server-side from the folder's
 * http-client(.private).env.json files via the environment picker.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModalPortal } from './shared/ModalPortal';
import { Icon } from './Icon';
import { store, useHttpBuildingId, useBuildings } from '../store';
import { useModalStackRegistration } from '../hooks/useModalStack';
import { useSplitPane } from '../hooks/useSplitPane';
import { dockBuilding } from '../utils/buildingViewMode';
import { scanHttpRequests, runHttpRequest, fetchHttpHistory, fetchHttpRun } from '../api/http-requests';
import { apiUrl, authFetch, getStorageBoolean, setStorageBoolean, getStorageStringSet, setStorageStringSet } from '../utils/storage';
import { highlightCode } from './FileExplorerPanel/syntaxHighlighting';
import { CopyCurlButton } from './shared/CopyCurlButton';
import type {
  Building,
  HttpRequestFile,
  HttpRequestItem,
  HttpRequestsScanResult,
  HttpResolvedRequest,
  HttpRunResult,
  HttpRunSummary,
  StoredHttpRun,
} from '../../shared/types';
import '../styles/components/http-requests-building-modal.scss';

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
  return METHOD_COLORS[method] ?? '#8a8a98';
}

function statusColor(status: number | undefined): string {
  if (status === undefined) return '#d45a5a';
  if (status < 300) return '#5cb88a';
  if (status < 400) return '#5ad4d4';
  if (status < 500) return '#d4a05a';
  return '#d45a5a';
}

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Render text with {{variables}} highlighted as chips. */
function VarText({ text }: { text: string }) {
  const parts = useMemo(() => text.split(/(\{\{[^}]*\}\})/g), [text]);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('{{') ? (
          <span key={i} className="hrm-var" title="Resolved from the selected environment">
            {part}
          </span>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

/** Pretty-print JSON bodies; anything else passes through untouched. */
function prettyBody(
  body: string | undefined,
  contentType: string | undefined,
): { text: string; language: 'json' | 'markup' | null } {
  if (!body) return { text: '', language: null };
  if (!contentType || /json/i.test(contentType)) {
    try {
      return { text: JSON.stringify(JSON.parse(body), null, 2), language: 'json' };
    } catch {
      /* not JSON after all */
    }
  }
  if (contentType && /xml|html/i.test(contentType)) return { text: body, language: 'markup' };
  return { text: body, language: null };
}

type RequestKey = string; // `${relFile}#${index}`

function keyOf(relFile: string, index: number): RequestKey {
  return `${relFile}#${index}`;
}


// ============================================================================
// Left pane: file/request browser (memoized — no per-tick props)
// ============================================================================

interface RequestBrowserProps {
  files: HttpRequestFile[];
  searching: boolean;
  expanded: Set<string>;
  selectedKey: RequestKey | null;
  results: Map<RequestKey, HttpRunResult>;
  runningKey: RequestKey | null;
  runningFile: string | null;
  onToggleFile: (relFile: string) => void;
  onSelect: (relFile: string, index: number) => void;
  onRun: (relFile: string, index: number) => void;
  onRunFile: (relFile: string) => void;
  onEditFile: (relFile: string) => void;
}

const RequestBrowser = memo(function RequestBrowser({
  files,
  searching,
  expanded,
  selectedKey,
  results,
  runningKey,
  runningFile,
  onToggleFile,
  onSelect,
  onRun,
  onRunFile,
  onEditFile,
}: RequestBrowserProps) {
  if (files.length === 0) {
    return (
      <div className="hrm-browser-empty">
        {searching ? 'No requests match your search.' : 'No .http files found in this folder.'}
      </div>
    );
  }
  const busy = runningKey !== null || runningFile !== null;
  return (
    <div className="hrm-browser">
      {files.map((file) => {
        const isExpanded = searching || expanded.has(file.relFile);
        return (
          <div key={file.relFile} className="hrm-file">
            <div className="hrm-row hrm-file-row" onClick={() => onToggleFile(file.relFile)}>
              <span className="hrm-caret">
                <Icon name={isExpanded ? 'caret-down' : 'caret-right'} size={10} />
              </span>
              <span className="hrm-file-icon">
                <Icon name="file-code" size={13} />
              </span>
              <span className="hrm-row-name" title={file.relFile}>
                {file.relFile}
              </span>
              <span className="hrm-req-count">{file.requests.length}</span>
              <button
                className="hrm-edit-btn"
                title={`Edit ${file.relFile}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditFile(file.relFile);
                }}
              >
                <Icon name="edit" size={11} />
              </button>
              <button
                className="hrm-play"
                disabled={busy}
                title={busy ? 'A request is already running' : `Run all ${file.requests.length} requests in ${file.relFile}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRunFile(file.relFile);
                }}
              >
                {runningFile === file.relFile ? <span className="hrm-spinner" /> : <Icon name="play" size={11} />}
              </button>
            </div>
            {isExpanded &&
              file.requests.map((req) => {
                const key = keyOf(file.relFile, req.index);
                const result = results.get(key);
                const isRunning = runningKey === key;
                return (
                  <div
                    key={key}
                    className={`hrm-row hrm-req-row ${selectedKey === key ? 'selected' : ''}`}
                    onClick={() => onSelect(file.relFile, req.index)}
                  >
                    <span className="hrm-method" style={{ color: methodColor(req.method) }}>
                      {req.method}
                    </span>
                    <span className="hrm-row-name" title={`${req.name}\n${req.url}`}>
                      {req.name}
                    </span>
                    {result && (
                      <span
                        className="hrm-status-dot"
                        style={{ background: result.ok ? statusColor(result.status) : '#d45a5a' }}
                        title={result.ok ? `${result.status} ${result.statusText ?? ''} · ${formatTime(result.timeMs)}` : result.error}
                      />
                    )}
                    <button
                      className="hrm-play"
                      disabled={busy}
                      title={busy ? 'A request is already running' : `Run ${req.method} ${req.url}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRun(file.relFile, req.index);
                      }}
                    >
                      {isRunning ? <span className="hrm-spinner" /> : <Icon name="play" size={10} />}
                    </button>
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
});

// ============================================================================
// Right pane: request detail + response
// ============================================================================

function ResponsePanel({ result }: { result: HttpRunResult }) {
  const [showHeaders, setShowHeaders] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const body = useMemo(() => prettyBody(result.body, result.contentType), [result]);
  // Prism-colorized body (JSON/XML) — token CSS ships with the file explorer's
  // syntax theme and is global.
  const bodyHtml = useMemo(
    () => (body.language && body.text ? highlightCode(body.text, body.language) : null),
    [body],
  );

  return (
    <div className="hrm-response">
      <div className="hrm-response-head">
        {result.ok ? (
          <span className="hrm-status-pill" style={{ borderColor: statusColor(result.status), color: statusColor(result.status) }}>
            {result.status} {result.statusText}
          </span>
        ) : (
          <span className="hrm-status-pill error">
            <Icon name="warning-circle" size={12} /> Failed
          </span>
        )}
        <span className="hrm-response-meta">
          <Icon name="hourglass" size={11} /> {formatTime(result.timeMs)}
        </span>
        {result.sizeBytes !== undefined && <span className="hrm-response-meta">{formatSize(result.sizeBytes)}</span>}
        {result.contentType && (
          <span className="hrm-response-meta type" title={result.contentType}>
            {result.contentType.split(';')[0]}
          </span>
        )}
        <button
          className={`hrm-btn small ${showRequest ? 'active' : ''}`}
          onClick={() => setShowRequest((v) => !v)}
          title="Show the request exactly as it was sent (variables resolved)"
        >
          {showRequest ? 'Hide request' : 'Request'}
        </button>
        {result.headers && result.headers.length > 0 && (
          <button className="hrm-btn small" onClick={() => setShowHeaders((v) => !v)}>
            {showHeaders ? 'Hide headers' : `Headers (${result.headers.length})`}
          </button>
        )}
        <CopyCurlButton request={result.request} />
      </div>

      {showRequest && (
        <div className="hrm-sent-request">
          <div className="hrm-sent-request-title">Request sent</div>
          <div className="hrm-request-line">
            <span className="hrm-method big" style={{ color: methodColor(result.request.method) }}>
              {result.request.method}
            </span>
            <span className="hrm-url">{result.request.url}</span>
          </div>
          {result.request.headers.length > 0 && (
            <div className="hrm-headers-table request">
              {result.request.headers.map((h, i) => (
                <div key={i} className="hrm-header-line">
                  <span className="hrm-header-name">{h.name}:</span> {h.value}
                </div>
              ))}
            </div>
          )}
          {result.request.body && <pre className="hrm-request-body">{result.request.body}</pre>}
        </div>
      )}

      {result.error && (
        <div className="hrm-error-banner">
          <Icon name="warning-circle" size={13} /> {result.error}
        </div>
      )}
      {result.unresolvedVariables && result.unresolvedVariables.length > 0 && (
        <div className="hrm-warn-banner">
          <Icon name="warning-circle" size={13} /> Unresolved variables:{' '}
          {result.unresolvedVariables.map((v) => (
            <span key={v} className="hrm-var">{`{{${v}}}`}</span>
          ))}
          <span className="hrm-warn-hint">— pick an environment or define them in http-client.env.json</span>
        </div>
      )}
      {result.finalUrl && <div className="hrm-final-url">→ redirected to {result.finalUrl}</div>}

      {showHeaders && result.headers && (
        <div className="hrm-headers-table">
          {result.headers.map((h, i) => (
            <div key={i} className="hrm-header-line">
              <span className="hrm-header-name">{h.name}:</span> {h.value}
            </div>
          ))}
        </div>
      )}

      {result.bodyBinary ? (
        <div className="hrm-body-note">Binary response ({formatSize(result.sizeBytes)}) — not displayed.</div>
      ) : body.text ? (
        <>
          {bodyHtml ? (
            <pre className="hrm-response-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          ) : (
            <pre className="hrm-response-body">{body.text}</pre>
          )}
          {result.bodyTruncated && <div className="hrm-body-note">… response truncated at 2 MB</div>}
        </>
      ) : (
        result.ok && <div className="hrm-body-note">Empty response body.</div>
      )}
    </div>
  );
}

interface RequestDetailProps {
  file: HttpRequestFile;
  request: HttpRequestItem;
  result: HttpRunResult | undefined;
  running: boolean;
  busy: boolean;
  onRun: () => void;
  onEdit: () => void;
}

function RequestDetail({ file, request, result, running, busy, onRun, onEdit }: RequestDetailProps) {
  // Prefer the resolved request of the last run for curl copies; before any
  // run, fall back to the raw request ({{vars}} left as-is).
  const curlRequest: HttpResolvedRequest = result?.request ?? {
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: request.body,
  };
  return (
    <div className="hrm-detail">
      <div className="hrm-detail-head">
        <span className="hrm-detail-name" title={`${file.relFile}:${request.line}`}>
          {request.name}
        </span>
        <span className="hrm-detail-loc">
          {file.relFile}:{request.line}
        </span>
        <button className="hrm-btn small" onClick={onEdit} title={`Edit ${file.relFile}`}>
          <Icon name="edit" size={11} /> Edit
        </button>
        <CopyCurlButton
          request={curlRequest}
          title={result ? 'Copy as curl (variables resolved from the last run)' : 'Copy as curl ({{variables}} kept as written — run once to copy resolved values)'}
        />
        <button className="hrm-btn primary" onClick={onRun} disabled={busy}>
          {running ? <span className="hrm-spinner" /> : <Icon name="play" size={12} />} Run
        </button>
      </div>

      <div className="hrm-request-block">
        <div className="hrm-request-line">
          <span className="hrm-method big" style={{ color: methodColor(request.method) }}>
            {request.method}
          </span>
          <span className="hrm-url">
            <VarText text={request.url} />
          </span>
        </div>
        {request.headers.length > 0 && (
          <div className="hrm-headers-table request">
            {request.headers.map((h, i) => (
              <div key={i} className="hrm-header-line">
                <span className="hrm-header-name">{h.name}:</span> <VarText text={h.value} />
              </div>
            ))}
          </div>
        )}
        {request.body && (
          <pre className="hrm-request-body">
            <VarText text={request.body} />
          </pre>
        )}
      </div>

      {result ? (
        <ResponsePanel result={result} />
      ) : (
        <div className="hrm-response-empty">
          <Icon name="send" size={24} />
          <span>Not sent yet</span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// File editor: raw .http text editing in the right pane
// ============================================================================

interface FileEditorProps {
  relFile: string;
  text: string;
  dirty: boolean;
  busy: boolean;
  error: string | null;
  onChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function FileEditor({ relFile, text, dirty, busy, error, onChange, onSave, onCancel }: FileEditorProps) {
  return (
    <div className="hrm-editor">
      <div className="hrm-detail-head">
        <span className="hrm-editor-icon">
          <Icon name="edit" size={14} />
        </span>
        <span className="hrm-detail-name" title={relFile}>
          {relFile}
          {dirty && <span className="hrm-editor-dirty" title="Unsaved changes">●</span>}
        </span>
        <span className="hrm-detail-loc">Ctrl+S saves · Esc closes</span>
        <button className="hrm-btn primary" onClick={onSave} disabled={busy || !dirty}>
          {busy ? <span className="hrm-spinner" /> : <Icon name="save" size={12} />} Save
        </button>
        <button className="hrm-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      {error && (
        <div className="hrm-error-banner">
          <Icon name="warning-circle" size={13} /> {error}
        </div>
      )}
      <textarea
        className="hrm-editor-textarea"
        value={text}
        spellCheck={false}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Keep Escape inside the editor (the modal container closes on it).
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
            return;
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            if (dirty && !busy) onSave();
          }
        }}
      />
    </div>
  );
}

// ============================================================================
// History: previously executed requests for this folder (persisted server-side)
// ============================================================================

// Memoized so per-run state churn in the modal doesn't reconcile the list —
// it refetches only when reloadKey bumps (a run finished) or the folder changes.
const HrmHistory = memo(function HrmHistory({
  folderPath,
  reloadKey,
  onPick,
}: {
  folderPath: string;
  // Bumped by the modal whenever a run finishes so the fresh run shows up
  // without a manual refresh.
  reloadKey: number;
  onPick: (runId: string) => void;
}) {
  const [open, setOpen] = useState(() => getStorageBoolean(`http-history-open:${folderPath}`, true));
  const [rows, setRows] = useState<HttpRunSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setStorageBoolean(`http-history-open:${folderPath}`, open);
  }, [folderPath, open]);

  useEffect(() => {
    if (!folderPath) return;
    let live = true;
    setLoading(true);
    fetchHttpHistory(folderPath, 100)
      .then((runs) => live && setRows(runs))
      .catch(() => live && setRows([]))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [folderPath, reloadKey]);

  const count = rows?.length ?? 0;
  return (
    <div className="hrm-history">
      <button className="hrm-history-toggle" onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'caret-down' : 'caret-right'} size={10} />
        <span className="hrm-history-title">Previous requests</span>
        {rows !== null && <span className="hrm-history-badge">{count}</span>}
      </button>
      {open && (
        <div className="hrm-history-list">
          {loading && rows === null ? (
            <div className="hrm-history-empty">Loading history…</div>
          ) : count === 0 ? (
            <div className="hrm-history-empty">No requests executed for this folder yet.</div>
          ) : (
            rows!.map((r) => (
              <button key={r.runId} className="hrm-history-row" onClick={() => onPick(r.runId)}>
                <span className="hrm-method" style={{ color: methodColor(r.method) }}>
                  {r.method}
                </span>
                <span className="hrm-history-name" title={`${r.relFile} · ${r.url}`}>
                  {r.requestName}
                </span>
                {r.ok ? (
                  <span className="hrm-history-code" style={{ color: statusColor(r.status) }}>
                    {r.status}
                  </span>
                ) : (
                  <span className="hrm-history-code error" title={r.error}>
                    ERR
                  </span>
                )}
                <span className="hrm-history-meta">{formatTime(r.timeMs)}</span>
                {r.env && <span className="hrm-history-env">{r.env}</span>}
                <span className="hrm-history-meta when">{formatRelativeTime(r.finishedAt)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
});

/** Read-only view of a past run picked from the history list. */
function HistoryRunView({
  run,
  busy,
  canRerun,
  onRerun,
  onClose,
}: {
  run: StoredHttpRun;
  busy: boolean;
  canRerun: boolean;
  onRerun: () => void;
  onClose: () => void;
}) {
  const req = run.result.request;
  return (
    <div className="hrm-detail">
      <div className="hrm-detail-head">
        <span className="hrm-history-chip" title={new Date(run.finishedAt).toLocaleString()}>
          <Icon name="hourglass" size={11} /> {formatRelativeTime(run.finishedAt)}
        </span>
        <span className="hrm-detail-name" title={run.requestName}>
          {run.requestName}
        </span>
        <span className="hrm-detail-loc">
          {run.relFile}
          {run.env ? ` · env: ${run.env}` : ''}
        </span>
        <CopyCurlButton request={req} title="Copy this past run as a curl command (as it was sent)" />
        {canRerun && (
          <button className="hrm-btn primary" onClick={onRerun} disabled={busy}>
            <Icon name="play" size={12} /> Run again
          </button>
        )}
        <button className="hrm-btn" onClick={onClose} title="Back to the current request">
          <Icon name="close" size={12} />
        </button>
      </div>

      <div className="hrm-request-block">
        <div className="hrm-request-line">
          <span className="hrm-method big" style={{ color: methodColor(req.method) }}>
            {req.method}
          </span>
          <span className="hrm-url">{req.url}</span>
        </div>
        {req.headers.length > 0 && (
          <div className="hrm-headers-table request">
            {req.headers.map((h, i) => (
              <div key={i} className="hrm-header-line">
                <span className="hrm-header-name">{h.name}:</span> {h.value}
              </div>
            ))}
          </div>
        )}
        {req.body && <pre className="hrm-request-body">{req.body}</pre>}
      </div>

      <ResponsePanel result={run.result} />
    </div>
  );
}

// ============================================================================
// Browser content — shared by the modal and the dockable bottom panels
// ============================================================================

/**
 * The whole .http browser (toolbar + file tree + detail/response + history)
 * without any window chrome, so it can live either inside the full modal or
 * docked as a compact panel under the Guake/flat terminal input. All state is
 * local, so docking/undocking remounts it — selection and env survive via
 * localStorage; run results just re-fetch from the persisted history.
 */
export function HttpRequestsBrowser({
  building,
  autoFocusSearch = true,
  onBusyChange,
}: {
  building: Building;
  /** Disable in panel mode so opening the dock doesn't steal the terminal input's focus. */
  autoFocusSearch?: boolean;
  /** Lets the host pulse its globe icon while a request/run is in flight. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const folderPath = building.folderPath ?? '';

  const [scan, setScan] = useState<HttpRequestsScanResult | null>(null);
  const [scanning, setScanning] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Expanded files survive close/reopen AND modal↔dock swaps (the swap
  // remounts this component).
  const expandedKey = `http-building-expanded-${building.id}`;
  const [expanded, setExpanded] = useState<Set<string>>(() => getStorageStringSet(expandedKey));
  useEffect(() => {
    setStorageStringSet(expandedKey, expanded);
  }, [expandedKey, expanded]);
  const [selectedKey, setSelectedKey] = useState<RequestKey | null>(null);
  const [results, setResults] = useState<Map<RequestKey, HttpRunResult>>(new Map());
  const [runningKey, setRunningKey] = useState<RequestKey | null>(null);
  const [runningFile, setRunningFile] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  // A past run being viewed (picked from the history list); takes precedence
  // over the live request detail in the right pane until dismissed.
  const [historyRun, setHistoryRun] = useState<StoredHttpRun | null>(null);
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  // Raw .http file being edited in the right pane (wins over everything else).
  const [editing, setEditing] = useState<{ relFile: string; text: string; original: string } | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [env, setEnv] = useState<string>(() => localStorage.getItem(`http-building-env-${building.id}`) ?? '');
  // Draggable list/detail split, persisted per building (shared modal↔dock).
  const { leftPct: splitLeftPct, bodyRef: splitBodyRef, onSplitMouseDown } = useSplitPane(`http-building-split-${building.id}`);
  const searchRef = useRef<HTMLInputElement>(null);
  // The env the NEXT run uses — reading state inside the sequential run-file
  // loop would go stale.
  const envRef = useRef(env);
  envRef.current = env;
  // Unmount guard for the sequential run-file loop. The effect body must
  // reset it: under StrictMode the mount effect runs mount → cleanup → mount,
  // and a cleanup-only ref would stay true forever, silently swallowing every
  // post-run state update (eternal spinner, dead history clicks).
  const closedRef = useRef(false);
  useEffect(() => {
    closedRef.current = false;
    return () => {
      closedRef.current = true;
    };
  }, []);

  const doScan = useCallback(async () => {
    if (!folderPath) {
      setScanning(false);
      setScanError('This building has no folder configured. Edit the building to set one.');
      return;
    }
    setScanning(true);
    setScanError(null);
    try {
      const result = await scanHttpRequests(folderPath);
      if (!result.ok) {
        setScan(null);
        setScanError(result.error || 'Scan failed');
      } else {
        setScan(result);
        // Auto-expand everything when the corpus is small — but never override
        // a fold state the user already saved.
        if (result.files.length <= 6 && localStorage.getItem(expandedKey) === null) {
          setExpanded(new Set(result.files.map((f) => f.relFile)));
        }
        // Auto-pick the only environment.
        if (result.environments.length > 0 && !result.environments.includes(envRef.current)) {
          setEnv(result.environments.length === 1 ? result.environments[0] : '');
        }
      }
    } catch (err: any) {
      setScan(null);
      setScanError(err?.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  }, [folderPath, expandedKey]);

  useEffect(() => {
    void doScan();
    if (!autoFocusSearch) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 150);
    return () => window.clearTimeout(t);
  }, [doScan, autoFocusSearch]);

  useEffect(() => {
    localStorage.setItem(`http-building-env-${building.id}`, env);
  }, [env, building.id]);

  // Remember the last selected request across modal open/close.
  useEffect(() => {
    if (selectedKey) localStorage.setItem(`http-building-selected-${building.id}`, selectedKey);
  }, [selectedKey, building.id]);

  // Restore it once the first scan lands (only if it still exists).
  const restoredSelectionRef = useRef(false);
  useEffect(() => {
    if (!scan || restoredSelectionRef.current) return;
    restoredSelectionRef.current = true;
    const saved = localStorage.getItem(`http-building-selected-${building.id}`);
    if (!saved) return;
    const hash = saved.lastIndexOf('#');
    if (hash <= 0) return;
    const relFile = saved.slice(0, hash);
    const index = Number(saved.slice(hash + 1));
    const file = scan.files.find((f) => f.relFile === relFile);
    if (!file || !file.requests[index]) return;
    setSelectedKey(saved);
    setExpanded((prev) => new Set(prev).add(relFile));
  }, [scan, building.id]);

  // Search filters by request name, method, url and file name.
  const filteredFiles = useMemo((): HttpRequestFile[] => {
    if (!scan) return [];
    const q = search.trim().toLowerCase();
    if (!q) return scan.files;
    const out: HttpRequestFile[] = [];
    for (const file of scan.files) {
      if (file.relFile.toLowerCase().includes(q)) {
        out.push(file);
        continue;
      }
      const requests = file.requests.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.url.toLowerCase().includes(q) ||
          r.method.toLowerCase() === q,
      );
      if (requests.length > 0) out.push({ ...file, requests });
    }
    return out;
  }, [scan, search]);

  const requestCount = useMemo(
    () => filteredFiles.reduce((acc, f) => acc + f.requests.length, 0),
    [filteredFiles],
  );

  const selected = useMemo((): { file: HttpRequestFile; request: HttpRequestItem } | null => {
    if (!scan || !selectedKey) return null;
    const hash = selectedKey.lastIndexOf('#');
    const relFile = selectedKey.slice(0, hash);
    const index = Number(selectedKey.slice(hash + 1));
    const file = scan.files.find((f) => f.relFile === relFile);
    const request = file?.requests[index];
    return file && request ? { file, request } : null;
  }, [scan, selectedKey]);

  const busy = runningKey !== null || runningFile !== null || runningAll;

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const runOne = useCallback(
    async (relFile: string, index: number): Promise<boolean> => {
      const key = keyOf(relFile, index);
      setRunningKey(key);
      setSelectedKey(key);
      setHistoryRun(null);
      setRunError(null);
      try {
        const result = await runHttpRequest({
          path: folderPath,
          relFile,
          requestIndex: index,
          env: envRef.current || undefined,
        });
        if (!closedRef.current) {
          setResults((prev) => new Map(prev).set(key, result));
          setHistoryReloadKey((k) => k + 1);
        }
        return true;
      } catch (err: any) {
        if (!closedRef.current) setRunError(err?.message || 'Failed to run request');
        return false;
      } finally {
        if (!closedRef.current) setRunningKey(null);
      }
    },
    [folderPath],
  );

  const handleRun = useCallback(
    (relFile: string, index: number) => {
      if (busy) return;
      void runOne(relFile, index);
    },
    [busy, runOne],
  );

  // IntelliJ's "Run all requests in file": sequential, keeps going on HTTP
  // errors, stops on API failures (bad path etc.).
  const handleRunFile = useCallback(
    (relFile: string) => {
      if (busy || !scan) return;
      const file = scan.files.find((f) => f.relFile === relFile);
      if (!file) return;
      setRunningFile(relFile);
      setExpanded((prev) => new Set(prev).add(relFile));
      void (async () => {
        try {
          for (const req of file.requests) {
            if (closedRef.current) return;
            const ok = await runOne(relFile, req.index);
            if (!ok) break;
          }
        } finally {
          if (!closedRef.current) setRunningFile(null);
        }
      })();
    },
    [busy, scan, runOne],
  );

  // Run every request of every (filtered) file, sequentially, expanding each
  // file as it starts. HTTP errors keep going; API failures stop the sweep.
  const handleRunAll = useCallback(() => {
    if (busy || !scan) return;
    const files = filteredFiles;
    if (files.length === 0) return;
    setRunningAll(true);
    void (async () => {
      try {
        for (const file of files) {
          if (closedRef.current) return;
          setRunningFile(file.relFile);
          setExpanded((prev) => new Set(prev).add(file.relFile));
          for (const req of file.requests) {
            if (closedRef.current) return;
            const ok = await runOne(file.relFile, req.index);
            if (!ok) return;
          }
        }
      } finally {
        if (!closedRef.current) {
          setRunningFile(null);
          setRunningAll(false);
        }
      }
    })();
  }, [busy, scan, filteredFiles, runOne]);

  const ENV_TEMPLATE = `{
  "dev": {
    "baseUrl": "http://localhost:8080",
    "token": "your-token-here"
  }
}
`;

  // Create http-client.env.json in the folder and open it in the editor.
  const handleCreateEnvFile = useCallback(async () => {
    setRunError(null);
    try {
      const res = await authFetch(apiUrl('/api/files/create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentDir: folderPath, name: 'http-client.env.json' }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to create env file');
      if (closedRef.current) return;
      setEditing({ relFile: 'http-client.env.json', text: ENV_TEMPLATE, original: '' });
      setHistoryRun(null);
    } catch (err: any) {
      if (!closedRef.current) setRunError(err?.message || 'Failed to create env file');
    }
  }, [folderPath, ENV_TEMPLATE]);

  const handleSelect = useCallback((relFile: string, index: number) => {
    setSelectedKey(keyOf(relFile, index));
    setHistoryRun(null);
  }, []);

  const handlePickHistory = useCallback((runId: string) => {
    void fetchHttpRun(runId).then((run) => {
      if (closedRef.current || !run) return;
      setHistoryRun(run);
      setSelectedKey(keyOf(run.relFile, run.requestIndex));
    });
  }, []);

  const handleEditFile = useCallback(
    async (relFile: string) => {
      setEditorError(null);
      try {
        const res = await authFetch(apiUrl(`/api/files/read?path=${encodeURIComponent(`${folderPath}/${relFile}`)}`));
        const data = (await res.json().catch(() => ({}))) as { content?: string; error?: string };
        if (!res.ok) throw new Error(data.error || 'Failed to read file');
        if (closedRef.current) return;
        const text = data.content ?? '';
        setEditing({ relFile, text, original: text });
        setHistoryRun(null);
      } catch (err: any) {
        if (!closedRef.current) setRunError(err?.message || 'Failed to open file for editing');
      }
    },
    [folderPath],
  );

  const handleSaveEdit = useCallback(async () => {
    if (!editing) return;
    setEditorBusy(true);
    setEditorError(null);
    try {
      const res = await authFetch(apiUrl('/api/files/write'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `${folderPath}/${editing.relFile}`, content: editing.text }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to save file');
      if (closedRef.current) return;
      setEditing(null);
      await doScan(); // re-parse so names/indices/vars reflect the edit
    } catch (err: any) {
      if (!closedRef.current) setEditorError(err?.message || 'Failed to save file');
    } finally {
      if (!closedRef.current) setEditorBusy(false);
    }
  }, [editing, folderPath, doScan]);

  const handleCancelEdit = useCallback(() => {
    if (editing && editing.text !== editing.original && !window.confirm('Discard unsaved changes?')) return;
    setEditing(null);
    setEditorError(null);
  }, [editing]);

  const handleToggleFile = useCallback((relFile: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(relFile)) next.delete(relFile);
      else next.add(relFile);
      return next;
    });
  }, []);

  return (
    <>
      {/* Toolbar */}
      <div className="hrm-toolbar">
        <div className="hrm-search">
          <Icon name="search" size={13} />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search requests, URLs and files…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="hrm-search-clear" onClick={() => setSearch('')} title="Clear search">
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
        <span className="hrm-scan-counts">
          {scan ? `${filteredFiles.length} files · ${requestCount} requests` : ''}
        </span>
        {scan && scan.environments.length > 0 && (
          <label className="hrm-env">
            <span>Env</span>
            <select value={env} onChange={(e) => setEnv(e.target.value)}>
              <option value="">(none)</option>
              {scan.environments.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="hrm-btn" onClick={() => void doScan()} disabled={scanning} title="Re-scan .http files">
          <Icon name="refresh" size={12} /> {scanning ? 'Scanning…' : 'Rescan'}
        </button>
        <button
          className="hrm-btn primary"
          onClick={handleRunAll}
          disabled={busy || scanning || !scan || requestCount === 0}
          title={
            busy
              ? 'A run is already in progress'
              : `Run all ${requestCount} requests${search.trim() ? ' (filtered)' : ''}, file by file`
          }
        >
          {runningAll ? <span className="hrm-spinner" /> : <Icon name="play" size={12} />} Run all
        </button>
      </div>

      {runError && (
        <div className="hrm-error-banner banner">
          <Icon name="warning-circle" size={13} /> {runError}
        </div>
      )}

      {/* Body */}
      <div className="hrm-body" ref={splitBodyRef}>
        <div className="hrm-left" style={{ width: `${splitLeftPct}%` }}>
          {/* Environment files — click to edit variables (private overlay wins) */}
          {scan && !scanning && (
            <div className="hrm-env-files">
              <span className="hrm-env-files-label">
                <Icon name="gear" size={11} /> Env
              </span>
              {scan.envFiles.map((f) => (
                <button key={f} className="hrm-env-file-chip" title={`Edit ${f}`} onClick={() => void handleEditFile(f)}>
                  <Icon name="edit" size={10} /> {f.split('/').pop()}
                </button>
              ))}
              {scan.envFiles.length === 0 && (
                <button
                  className="hrm-env-file-chip create"
                  title="Create http-client.env.json in this folder"
                  onClick={() => void handleCreateEnvFile()}
                >
                  <Icon name="file-add" size={10} /> Create http-client.env.json
                </button>
              )}
            </div>
          )}
          {scanning ? (
            <div className="hrm-browser-empty">
              <span className="hrm-spinner large" /> Scanning .http files…
            </div>
          ) : scanError ? (
            <div className="hrm-browser-empty error">
              <Icon name="warning-circle" size={16} /> {scanError}
              <button className="hrm-btn" onClick={() => void doScan()}>
                <Icon name="refresh" size={12} /> Retry
              </button>
            </div>
          ) : (
            <RequestBrowser
              files={filteredFiles}
              searching={search.trim().length > 0}
              expanded={expanded}
              selectedKey={selectedKey}
              results={results}
              runningKey={runningKey}
              runningFile={runningFile}
              onToggleFile={handleToggleFile}
              onSelect={handleSelect}
              onRun={handleRun}
              onRunFile={handleRunFile}
              onEditFile={handleEditFile}
            />
          )}
        </div>

        <div
          className="hrm-split"
          onMouseDown={onSplitMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize request list"
        />

        <div className="hrm-right">
          {editing ? (
            <FileEditor
              relFile={editing.relFile}
              text={editing.text}
              dirty={editing.text !== editing.original}
              busy={editorBusy}
              error={editorError}
              onChange={(text) => setEditing((prev) => (prev ? { ...prev, text } : prev))}
              onSave={() => void handleSaveEdit()}
              onCancel={handleCancelEdit}
            />
          ) : historyRun ? (
            <HistoryRunView
              run={historyRun}
              busy={busy}
              canRerun={!!scan?.files.find((f) => f.relFile === historyRun.relFile)?.requests[historyRun.requestIndex]}
              onRerun={() => handleRun(historyRun.relFile, historyRun.requestIndex)}
              onClose={() => setHistoryRun(null)}
            />
          ) : selected ? (
            <RequestDetail
              file={selected.file}
              request={selected.request}
              result={selectedKey ? results.get(selectedKey) : undefined}
              running={runningKey === selectedKey}
              busy={busy}
              onRun={() => selected && handleRun(selected.file.relFile, selected.request.index)}
              onEdit={() => void handleEditFile(selected.file.relFile)}
            />
          ) : (
            <div className="hrm-response-empty">
              <Icon name="globe" size={30} />
              <span>No request selected</span>
              <p>Pick a request on the left, or hit its play button to fire it.</p>
            </div>
          )}
          <HrmHistory folderPath={folderPath} reloadKey={historyReloadKey} onPick={handlePickHistory} />
        </div>
      </div>
    </>
  );
}

// ============================================================================
// Modal shell
// ============================================================================

function HttpRequestsBuildingModal({ building, onClose }: { building: Building; onClose: () => void }) {
  const folderPath = building.folderPath ?? '';
  const [busy, setBusy] = useState(false);
  return (
    <ModalPortal>
      <div className="modal-overlay visible" onClick={onClose}>
        <div
          className="http-requests-building-modal"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        >
          {/* Header */}
          <div className="modal-header">
            <div className="hrm-title">
              <span className={`hrm-title-globe ${busy ? 'working' : ''}`}>
                <Icon name="globe" size={16} />
              </span>
              <span className="hrm-title-text">{building.name}</span>
              <span className="hrm-title-path" title={folderPath}>
                {folderPath}
              </span>
            </div>
            <div className="hrm-header-actions">
              <button
                className="modal-close"
                onClick={() => {
                  dockBuilding(building.id, 'http');
                  onClose();
                }}
                aria-label="Dock below the terminal input"
                title="Minimize — dock below the terminal input"
              >
                <Icon name="arrow-down" size={16} />
              </button>
              <button className="modal-close" onClick={onClose} aria-label="Close">
                <Icon name="close" size={16} />
              </button>
            </div>
          </div>
          <HttpRequestsBrowser building={building} onBusyChange={setBusy} />
        </div>
      </div>
    </ModalPortal>
  );
}

/**
 * App-wide mount, driven by the store (`httpBuildingId`). The `key` resets all
 * browser state when switching between different http buildings.
 */
export function GlobalHttpRequestsBuildingModal() {
  const buildingId = useHttpBuildingId();
  const buildings = useBuildings();
  const building = buildingId ? buildings.get(buildingId) : undefined;
  useModalStackRegistration('http-requests-building-modal', !!(buildingId && building), () => store.closeHttpBuilding());
  if (!buildingId || !building) return null;
  return <HttpRequestsBuildingModal key={buildingId} building={building} onClose={() => store.closeHttpBuilding()} />;
}
