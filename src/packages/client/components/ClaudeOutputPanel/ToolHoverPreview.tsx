/**
 * Ctrl+hover preview popup for guake terminal tool rows.
 *
 * Hold Ctrl (or Meta) while hovering a Read/Write/Edit/Bash row — or any
 * clickable file path — and a small panel shows what it points at: the file's
 * first lines, the edit's diff, the command's captured output, or the image
 * itself, without opening the full modal.
 *
 * Mounted exactly once (App.tsx) and driven by the `toolPreviewHover` singleton,
 * so rows stay render-free while hovering. The panel is interactive: the pointer
 * can move onto it and scroll it, which is why it reports enter/leave back to
 * the hover store instead of being pointer-transparent.
 *
 * Gated by the `toolHoverPreview` setting (Config → General).
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useSettings } from '../../store';
import { apiUrl, authFetch } from '../../utils/storage';
import { getIconForExtension } from '../FileExplorerPanel/fileUtils';
import {
  ensureLanguageLoaded,
  getLanguageForExtension,
  highlightCode,
  isLanguageSupported,
} from '../FileExplorerPanel/syntaxHighlighting';
import { Icon } from '../Icon';
import { isThumbnailableImagePath, getLocalFileImageUrl } from './contentRendering';
import {
  buildBashPreviewLines,
  buildEditPreview,
  buildFilePreviewLines,
  parseUnifiedDiffPreview,
  previewStartLine,
  type EditPreview,
} from './toolPreviewContent';
import {
  setToolPreviewEnabled,
  TOOL_PREVIEW_CLASS,
  toolPreviewPopupEnter,
  toolPreviewPopupLeave,
  useToolPreview,
  type ToolPreviewAnchor,
  type ToolPreviewState,
  type ToolPreviewTarget,
} from './toolPreviewHover';

const PREVIEW_WIDTH = 560;
const PREVIEW_MARGIN = 10;
// No gap: the popup's edge must touch the row's, or the pointer crosses a
// neighbouring row on its way in and that row hijacks the preview.
const PREVIEW_GAP = 0;
// The body scrolls, so these caps are about how much is worth *fetching and
// highlighting* per hover, not about what fits on screen.
const FILE_PREVIEW_LINES = 60;
const BASH_PREVIEW_LINES = 80;
const EDIT_PREVIEW_ROWS = 60;

// ---------------------------------------------------------------------------
// File content fetching
// ---------------------------------------------------------------------------

interface FilePreviewData {
  content: string;
  startLine: number;
  totalLines: number;
}

/**
 * Short-lived cache so sweeping the mouse back over the same row (or re-hovering
 * the same file two rows down) doesn't refire the request. Kept tiny and
 * time-boxed — a stale preview of a file the agent just rewrote is worse than
 * a second fetch.
 */
const CACHE_TTL_MS = 10_000;
const CACHE_MAX = 40;
const previewCache = new Map<string, { data: FilePreviewData; ts: number }>();

function readCache(key: string): FilePreviewData | null {
  const hit = previewCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    previewCache.delete(key);
    return null;
  }
  return hit.data;
}

function writeCache(key: string, data: FilePreviewData): void {
  if (previewCache.size >= CACHE_MAX) {
    const oldest = previewCache.keys().next().value;
    if (oldest !== undefined) previewCache.delete(oldest);
  }
  previewCache.set(key, { data, ts: Date.now() });
}

function extOf(filePath: string): string {
  const base = filePath.substring(filePath.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.substring(dot).toLowerCase() : '';
}

function basenameOf(filePath: string): string {
  const clean = filePath.replace(/\/+$/, '');
  return clean.substring(clean.lastIndexOf('/') + 1) || clean;
}

function dirnameOf(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx > 0 ? filePath.substring(0, idx) : '';
}

/** Load the first `FILE_PREVIEW_LINES` of a file (server slices it — never ships the whole blob). */
function useFilePreview(path: string | null, baseDir: string | undefined, startLine: number) {
  const [data, setData] = useState<FilePreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path) return;
    const key = `${path}|${startLine}`;
    const cached = readCache(key);
    if (cached) {
      setData(cached);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);

    const params = new URLSearchParams({
      path,
      previewLines: String(FILE_PREVIEW_LINES + 1),
      previewOffset: String(startLine),
    });
    if (baseDir) params.set('baseDir', baseDir);

    authFetch(apiUrl(`/api/files/read?${params.toString()}`), { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setError(typeof json?.error === 'string' ? json.error : 'Unable to read file');
          return;
        }
        const next: FilePreviewData = {
          content: typeof json.content === 'string' ? json.content : '',
          startLine: json?.preview?.startLine ?? startLine,
          totalLines: json?.preview?.totalLines ?? 0,
        };
        writeCache(key, next);
        setData(next);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [path, baseDir, startLine]);

  return { data, error, loading };
}

/**
 * Prism grammar for a language, loading lazy ones on demand. Returns the
 * language only once it is actually usable so we never highlight against a
 * grammar that isn't registered yet (which silently renders escaped plain text).
 */
function useHighlightLanguage(extension: string): string {
  const wanted = useMemo(() => getLanguageForExtension(extension), [extension]);
  const [ready, setReady] = useState(() => isLanguageSupported(wanted));

  useEffect(() => {
    if (isLanguageSupported(wanted)) {
      setReady(true);
      return;
    }
    setReady(false);
    let cancelled = false;
    ensureLanguageLoaded(wanted).then((ok) => {
      if (!cancelled && ok) setReady(true);
    });
    return () => { cancelled = true; };
  }, [wanted]);

  return ready ? wanted : 'plaintext';
}

// ---------------------------------------------------------------------------
// Body renderers
// ---------------------------------------------------------------------------

function CodeLine({ text, language }: { text: string; language: string }) {
  if (language === 'plaintext') return <span className="tool-preview-code">{text}</span>;
  return (
    <span
      className="tool-preview-code"
      dangerouslySetInnerHTML={{ __html: highlightCode(text, language) }}
    />
  );
}

function DiffRows({ preview, language }: { preview: EditPreview; language: string }) {
  return (
    <div className="tool-preview-diff">
      {preview.rows.map((row, i) => {
        if (row.type === 'gap') {
          return (
            <div key={`gap-${i}`} className="tool-preview-diff-row is-gap">
              <span className="tool-preview-diff-marker">⋯</span>
              <span className="tool-preview-code">
                {row.skipped > 0 ? `${row.skipped} unchanged lines` : ''}
              </span>
            </div>
          );
        }
        return (
          <div key={`row-${i}`} className={`tool-preview-diff-row is-${row.type}`}>
            <span className="tool-preview-diff-marker">
              {row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '}
            </span>
            <CodeLine text={row.text} language={language} />
          </div>
        );
      })}
    </div>
  );
}

function FilePreviewBody({ target }: { target: Extract<ToolPreviewTarget, { kind: 'file' }> }) {
  const { t } = useTranslation(['tools']);
  const extension = extOf(target.path);
  const isImage = isThumbnailableImagePath(target.path);
  const startLine = previewStartLine(target.highlightRange);
  const { data, error, loading } = useFilePreview(isImage ? null : target.path, target.baseDir, startLine);
  const language = useHighlightLanguage(extension);

  if (isImage) {
    return (
      <div className="tool-preview-image">
        <img src={getLocalFileImageUrl(target.path)} alt={basenameOf(target.path)} loading="lazy" />
      </div>
    );
  }

  if (loading && !data) return <div className="tool-preview-status">{t('tools:preview.loading')}</div>;
  if (error) return <div className="tool-preview-status is-error">{error}</div>;
  if (!data) return null;

  const { lines, truncated } = buildFilePreviewLines(data.content, {
    maxLines: FILE_PREVIEW_LINES,
    startLine: data.startLine,
  });

  if (lines.length === 0) return <div className="tool-preview-status">{t('tools:preview.emptyFile')}</div>;

  const highlightFrom = target.highlightRange?.offset ?? 0;
  const highlightTo = target.highlightRange
    ? target.highlightRange.offset + target.highlightRange.limit - 1
    : -1;

  return (
    <>
      <div className="tool-preview-lines">
        {lines.map((line) => (
          <div
            key={line.n}
            className={`tool-preview-line ${line.n >= highlightFrom && line.n <= highlightTo ? 'is-highlighted' : ''}`}
          >
            <span className="tool-preview-lineno">{line.n}</span>
            <CodeLine text={line.text} language={language} />
          </div>
        ))}
      </div>
      {(truncated || data.totalLines > lines.length + data.startLine - 1) && (
        <div className="tool-preview-more">
          {t('tools:preview.moreLines', {
            count: Math.max(0, data.totalLines - (data.startLine - 1) - lines.length),
          })}
        </div>
      )}
    </>
  );
}

function EditPreviewBody({ target }: { target: Extract<ToolPreviewTarget, { kind: 'edit' }> }) {
  const { t } = useTranslation(['tools']);
  const language = useHighlightLanguage(extOf(target.path));

  const preview = useMemo<EditPreview | null>(() => {
    if (target.unifiedDiff) return parseUnifiedDiffPreview(target.unifiedDiff, { maxRows: EDIT_PREVIEW_ROWS });
    if (target.oldString !== undefined || target.newString !== undefined) {
      return buildEditPreview(target.oldString ?? '', target.newString ?? '', { maxRows: EDIT_PREVIEW_ROWS });
    }
    return null;
  }, [target.unifiedDiff, target.oldString, target.newString]);

  if (!preview || preview.rows.length === 0) {
    return <div className="tool-preview-status">{t('tools:preview.noDiff')}</div>;
  }

  return (
    <>
      <DiffRows preview={preview} language={language} />
      {preview.truncated && <div className="tool-preview-more">{t('tools:preview.diffTruncated')}</div>}
    </>
  );
}

function BashPreviewBody({ target }: { target: Extract<ToolPreviewTarget, { kind: 'bash' }> }) {
  const { t } = useTranslation(['tools']);
  const output = target.output?.trim() ?? '';

  const body = useMemo(() => buildBashPreviewLines(output, BASH_PREVIEW_LINES), [output]);

  return (
    <>
      <div className="tool-preview-command">
        <span
          className="tool-preview-code"
          dangerouslySetInnerHTML={{ __html: highlightCode(target.command, 'bash') }}
        />
      </div>
      {target.isRunning ? (
        <div className="tool-preview-status">{t('tools:display.running')}</div>
      ) : !output ? (
        <div className="tool-preview-status">{t('tools:display.noOutputCaptured')}</div>
      ) : (
        <div className="tool-preview-lines is-output">
          {body.lines.map((line, i) => (
            <div key={`out-${i}`}>
              {body.skipped > 0 && i === body.tailStart && (
                <div className="tool-preview-skipped">
                  {t('tools:preview.skippedLines', { count: body.skipped })}
                </div>
              )}
              <div className="tool-preview-line">
                <span className="tool-preview-code">{line}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Popup shell
// ---------------------------------------------------------------------------

function PreviewHeader({ target }: { target: ToolPreviewTarget }) {
  const { t } = useTranslation(['tools']);

  if (target.kind === 'bash') {
    return (
      <div className="tool-preview-header">
        <Icon name="terminal" size={13} />
        <span className="tool-preview-title">Bash</span>
        {target.isRunning && <span className="tool-preview-dir">{t('tools:display.running')}</span>}
      </div>
    );
  }

  const iconPath = getIconForExtension(extOf(target.path));
  const dir = dirnameOf(target.path);
  return (
    <div className="tool-preview-header">
      {iconPath ? <img className="tool-preview-file-icon" src={iconPath} alt="" /> : <Icon name="file-text" size={13} />}
      <span className="tool-preview-title">{basenameOf(target.path)}</span>
      {dir && <span className="tool-preview-dir">{dir}</span>}
    </div>
  );
}

function computePosition(anchor: ToolPreviewAnchor, height: number): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = anchor.left;
  if (left + PREVIEW_WIDTH > vw - PREVIEW_MARGIN) left = vw - PREVIEW_WIDTH - PREVIEW_MARGIN;
  if (left < PREVIEW_MARGIN) left = PREVIEW_MARGIN;

  // Below the row by default; flip above when it would run off the bottom.
  let top = anchor.bottom + PREVIEW_GAP;
  if (top + height > vh - PREVIEW_MARGIN) {
    const above = anchor.top - PREVIEW_GAP - height;
    top = above >= PREVIEW_MARGIN ? above : Math.max(PREVIEW_MARGIN, vh - height - PREVIEW_MARGIN);
  }

  return { left, top };
}

function ToolPreviewPopup({ state }: { state: ToolPreviewState }) {
  const { target, anchor } = state;
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Reposition on mount and whenever the body grows (async fetch, image load).
  // Only `left`/`top` change here, so this can't feed back into a resize loop.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reposition = () => setPos(computePosition(anchor, el.getBoundingClientRect().height));
    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchor]);

  return (
    <div
      ref={ref}
      className={TOOL_PREVIEW_CLASS}
      style={{
        width: PREVIEW_WIDTH,
        left: pos?.left ?? anchor.left,
        top: pos?.top ?? anchor.bottom + PREVIEW_GAP,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onMouseEnter={toolPreviewPopupEnter}
      onMouseLeave={toolPreviewPopupLeave}
    >
      <PreviewHeader target={target} />
      <div className="tool-preview-body">
        {target.kind === 'file' && <FilePreviewBody target={target} />}
        {target.kind === 'edit' && <EditPreviewBody target={target} />}
        {target.kind === 'bash' && <BashPreviewBody target={target} />}
      </div>
    </div>
  );
}

/** Mount once, near the App root. Renders nothing until Ctrl+hover activates a row. */
export function ToolHoverPreviewHost() {
  const settings = useSettings();
  const state = useToolPreview();

  // The hover store is a plain module (no store import), so the setting is
  // pushed into it from here — the one component that both subscribes to
  // settings and owns the popup.
  const previewEnabled = settings.toolHoverPreview === true;
  useEffect(() => {
    setToolPreviewEnabled(previewEnabled);
  }, [previewEnabled]);

  if (!previewEnabled || !state || typeof document === 'undefined') return null;
  return createPortal(<ToolPreviewPopup state={state} />, document.body);
}
