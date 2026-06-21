/**
 * ExtensionContextCard
 *
 * Pretty cards for the context blocks the Tide Commander browser extension sends
 * to agents. Mirrors the vanilla-JS renderers in browser-extension/src/renderers.js
 * (parseElementContext / parseNetworkContext / parseErrorContext / parseAttachedFiles),
 * ported to React for the Guake terminal.
 *
 * Handles four block types:
 *   [UI element the user selected on the page]   → element card (collapsible HTML)
 *   [Network request captured in the browser]    → request card (method/status, bodies)
 *   [Browser error captured]                     → error card (message, stack, body)
 *   [Attached file(s)]                           → file card (image thumbnails + chips)
 */

import React, { useState } from 'react';
import { getImageWebUrl } from './contentRendering';

// ── parsing (ported from the extension's renderers.js) ───────────────────────

function grabField(text: string, label: string, nextAlt: string): string {
  const re = new RegExp(
    '^[ \\t]*' + label + '[ \\t]*:[ \\t]*([\\s\\S]*?)(?=\\n[ \\t]*' + nextAlt + '|(?![\\s\\S]))',
    'm'
  );
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

/** Pretty-print a JSON body; leave non-JSON untouched. */
function prettyJson(s: string): string {
  const t = (s || '').trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return s;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return s;
  }
}

const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;

interface ElementCtx {
  kind: 'element';
  isShot: boolean;
  page: string;
  selector: string;
  tag: string;
  rect: { w: number; h: number } | null;
  text: string;
  html: string;
  shotPath: string;
  request: string;
}
interface NetworkCtx {
  kind: 'network';
  method: string;
  url: string;
  status: string;
  statusText: string;
  ms: string;
  page: string;
  reqHeaders: string;
  reqBody: string;
  resHeaders: string;
  resBody: string;
  request: string;
}
interface ErrorCtx {
  kind: 'error';
  errKind: string;
  status: string;
  count: string;
  method: string;
  url: string;
  page: string;
  message: string;
  reqBody: string;
  resBody: string;
  stack: string;
  request: string;
}
interface AttachedCtx {
  kind: 'attached';
  files: { name: string; path: string; isImage: boolean }[];
  request: string;
}
export type ExtensionContext = ElementCtx | NetworkCtx | ErrorCtx | AttachedCtx;

const UIELEM_MARKER = '[UI element the user selected on the page]';
const UIELEM_SHOT = '[Screenshot of a UI element the user selected]';
const UIELEM_NEXT = '(?:Page|Selector|Tag|Box|Text|Computed styles|outerHTML|Request)[ \\t]*:';

function parseElementContext(text: string): ElementCtx | null {
  const isShot = text.indexOf(UIELEM_SHOT) !== -1;
  if (!isShot && text.indexOf(UIELEM_MARKER) === -1) return null;
  const g = (l: string) => grabField(text, l, UIELEM_NEXT);
  const box = g('Box');
  const bm = box.match(/x=(-?\d+)\s+y=(-?\d+)\s+w=(\d+)\s+h=(\d+)/);
  const html = g('outerHTML')
    .replace(/^```\w*\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
  return {
    kind: 'element',
    isShot,
    page: g('Page'),
    selector: g('Selector'),
    tag: g('Tag'),
    rect: bm ? { w: +bm[3], h: +bm[4] } : null,
    text: g('Text'),
    html,
    shotPath: ((text.match(/Saved screenshot:\s*([^\n]+)/) || [])[1] || '').trim(),
    request: g('Request'),
  };
}

const NET_MARKER = '[Network request captured in the browser]';
const NET_NEXT = '(?:Page|Request headers|Request body|Response headers|Response body|Request)[ \\t]*:';

function parseNetworkContext(text: string): NetworkCtx | null {
  if (text.indexOf(NET_MARKER) === -1) return null;
  const lines = text.slice(text.indexOf(NET_MARKER)).split('\n');
  const statusLine = (lines[1] || '').trim();
  const sm = statusLine.match(/^(\S+)\s+(.*?)\s+→\s+(\S+)\s*(.*)$/);
  let method = '', url = '', status = '', statusText = '', ms = '';
  if (sm) {
    method = sm[1];
    url = sm[2];
    status = sm[3];
    let tail = sm[4] || '';
    const mm = tail.match(/\((\d+)ms\)\s*$/);
    if (mm) { ms = mm[1]; tail = tail.slice(0, mm.index).trim(); }
    statusText = tail.trim();
  }
  const g = (l: string) => grabField(text, l, NET_NEXT);
  return {
    kind: 'network',
    method, url, status, statusText, ms,
    page: g('Page'),
    reqHeaders: g('Request headers'),
    reqBody: g('Request body'),
    resHeaders: g('Response headers'),
    resBody: g('Response body'),
    request: g('Request'),
  };
}

const ERR_MARKER = '[Browser error captured]';
const ERR_NEXT = '(?:Page|Message|Request body|Response body|Stack|Request)[ \\t]*:';

function parseErrorContext(text: string): ErrorCtx | null {
  if (text.indexOf(ERR_MARKER) === -1) return null;
  const lines = text.slice(text.indexOf(ERR_MARKER)).split('\n');
  const kindLine = (lines[1] || '').trim();
  const km = kindLine.match(/^(\S+?)(?:\s+(\d{3}))?(?:\s+×(\d+))?\s*$/);
  let method = '', url = '';
  for (const l of lines) {
    const mu = l.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S.*)$/);
    if (mu) { method = mu[1]; url = mu[2].trim(); break; }
    const uu = l.match(/^URL:\s*(\S.*)$/);
    if (uu) { url = uu[1].trim(); break; }
  }
  const g = (l: string) => grabField(text, l, ERR_NEXT);
  return {
    kind: 'error',
    errKind: km ? km[1] : (kindLine || 'error'),
    status: km && km[2] ? km[2] : '',
    count: km && km[3] ? km[3] : '',
    method, url,
    page: ((text.match(/^[ \t]*Page[ \t]*:[ \t]*(.*)$/m) || [])[1] || '').trim(),
    message: g('Message'),
    reqBody: g('Request body'),
    resBody: g('Response body'),
    stack: g('Stack'),
    request: g('Request'),
  };
}

const ATT_MARKER_RE = /\[Attached files?\]/;
const ATT_FILE_RE = /^-\s+(.+?):\s+(\/.+?)\s*$/gm;

function parseAttachedFiles(text: string): AttachedCtx | null {
  if (!ATT_MARKER_RE.test(text)) return null;
  const files: AttachedCtx['files'] = [];
  let m: RegExpExecArray | null;
  ATT_FILE_RE.lastIndex = 0;
  while ((m = ATT_FILE_RE.exec(text)) !== null) {
    const name = m[1].trim();
    const path = m[2].trim();
    files.push({ name, path, isImage: IMG_EXT_RE.test(name) || IMG_EXT_RE.test(path) });
  }
  if (!files.length) return null;
  const rm = text.match(/^[ \t]*Request[ \t]*:[ \t]*([\s\S]*?)(?![\s\S])/m);
  return { kind: 'attached', files, request: rm ? rm[1].trim() : '' };
}

/** Dispatcher: returns the parsed block, or null when `text` has no ext-context. */
export function parseExtensionContext(text: string): ExtensionContext | null {
  if (!text) return null;
  return (
    parseElementContext(text) ||
    parseNetworkContext(text) ||
    parseErrorContext(text) ||
    parseAttachedFiles(text)
  );
}

// ── rendering ────────────────────────────────────────────────────────────────

function elementTagLabel(tag: string): string {
  if (!tag) return 'element';
  const name = (tag.match(/<\s*([\w-]+)/) || [])[1] || 'element';
  const idM = tag.match(/id="([^"]+)"/);
  if (idM) return name + '#' + idM[1].trim().split(/\s+/)[0];
  const clsM = tag.match(/class="([^"]+)"/);
  if (clsM) return name + '.' + clsM[1].trim().split(/\s+/)[0];
  return name;
}

function Section({ label, content, json }: { label: string; content: string; json?: boolean }) {
  if (!content) return null;
  return (
    <div className="ext-sec">
      <div className="ext-sec-label">{label}</div>
      <pre className="ext-pre"><code>{json ? prettyJson(content) : content}</code></pre>
    </div>
  );
}

interface CardProps {
  ctx: ExtensionContext;
  onImageClick?: (url: string, name: string) => void;
}

function ElementCard({ ctx }: { ctx: ElementCtx }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`ext-card ext-card--element${open ? ' open' : ''}`}>
      <button type="button" className="ext-head" onClick={() => setOpen((o) => !o)}>
        <span className="ext-chip ext-chip--element">{ctx.isShot ? 'Element shot' : 'UI element'}</span>
        <span className="ext-tag" title={ctx.tag}>{elementTagLabel(ctx.tag)}</span>
        {ctx.rect && <span className="ext-dim">{ctx.rect.w} × {ctx.rect.h}</span>}
        {(ctx.html || ctx.text) && <span className="ext-toggle">{open ? '▾' : '▸'}</span>}
      </button>
      {ctx.request && <div className="ext-req">{ctx.request}</div>}
      <div className="ext-meta">
        {ctx.selector && <div className="ext-row"><span className="ext-k">selector</span><code className="ext-sel">{ctx.selector}</code></div>}
        {ctx.page && <div className="ext-row"><span className="ext-k">page</span><span className="ext-v">{ctx.page}</span></div>}
        {ctx.shotPath && <div className="ext-row"><span className="ext-k">📷</span><code className="ext-sel">{ctx.shotPath}</code></div>}
      </div>
      {open && (
        <>
          {ctx.text && <pre className="ext-pre ext-text"><code>{ctx.text}</code></pre>}
          {ctx.html && <pre className="ext-pre"><code>{ctx.html}</code></pre>}
        </>
      )}
    </div>
  );
}

function statusClass(status: string): string {
  if (!status || status === 'ERR') return 's-err';
  return 's-' + (String(status)[0] || '') + 'xx';
}

function NetworkCard({ ctx }: { ctx: NetworkCtx }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!(ctx.reqHeaders || ctx.reqBody || ctx.resHeaders || ctx.resBody || ctx.page);
  return (
    <div className={`ext-card ext-card--net${open ? ' open' : ''}`}>
      <button type="button" className="ext-head" onClick={() => setOpen((o) => !o)}>
        <span className={`ext-method m-${ctx.method}`}>{ctx.method || '?'}</span>
        <span className={`ext-status ${statusClass(ctx.status)}`}>{(ctx.status || 'ERR') + (ctx.statusText ? ' ' + ctx.statusText : '')}</span>
        {ctx.ms && <span className="ext-ms">{ctx.ms}ms</span>}
        {hasDetail && <span className="ext-toggle">{open ? '▾' : '▸'}</span>}
      </button>
      {ctx.url && <div className="ext-url">{ctx.url}</div>}
      {ctx.request && <div className="ext-req">{ctx.request}</div>}
      {open && (
        <div className="ext-detail">
          {ctx.page && <div className="ext-row"><span className="ext-k">page</span><span className="ext-v">{ctx.page}</span></div>}
          <Section label="Request headers" content={ctx.reqHeaders} />
          <Section label="Request body" content={ctx.reqBody} json />
          <Section label="Response headers" content={ctx.resHeaders} />
          <Section label="Response body" content={ctx.resBody} json />
        </div>
      )}
    </div>
  );
}

function ErrorCard({ ctx }: { ctx: ErrorCtx }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!(ctx.reqBody || ctx.resBody || ctx.stack || ctx.page);
  return (
    <div className={`ext-card ext-card--err${open ? ' open' : ''}`}>
      <button type="button" className="ext-head" onClick={() => setOpen((o) => !o)}>
        <span className="ext-chip ext-chip--err">⚠ error</span>
        <span className="ext-errkind">{ctx.errKind}</span>
        {ctx.status && <span className="ext-status s-err">{ctx.status}</span>}
        {ctx.count && ctx.count !== '1' && <span className="ext-ms">×{ctx.count}</span>}
        {hasDetail && <span className="ext-toggle">{open ? '▾' : '▸'}</span>}
      </button>
      {ctx.url && <div className="ext-url">{(ctx.method ? ctx.method + ' ' : '') + ctx.url}</div>}
      {ctx.message && <div className="ext-errmsg">{ctx.message}</div>}
      {ctx.request && <div className="ext-req">{ctx.request}</div>}
      {open && (
        <div className="ext-detail">
          {ctx.page && <div className="ext-row"><span className="ext-k">page</span><span className="ext-v">{ctx.page}</span></div>}
          <Section label="Request body" content={ctx.reqBody} json />
          <Section label="Response body" content={ctx.resBody} json />
          <Section label="Stack" content={ctx.stack} json />
        </div>
      )}
    </div>
  );
}

function AttachedCard({ ctx, onImageClick }: { ctx: AttachedCtx; onImageClick?: (url: string, name: string) => void }) {
  const n = ctx.files.length;
  return (
    <div className="ext-card ext-card--att">
      <div className="ext-head ext-head--static">
        <span className="ext-chip ext-chip--att">📎 {n} attachment{n > 1 ? 's' : ''}</span>
      </div>
      {ctx.request && <div className="ext-req">{ctx.request}</div>}
      <div className="ext-att-list">
        {ctx.files.map((f, i) => {
          if (f.isImage) {
            const url = getImageWebUrl(f.path);
            return (
              <figure key={i} className="ext-att-img-wrap">
                <img
                  className="ext-att-img"
                  src={url}
                  alt={f.name}
                  title={`${f.name} — click to enlarge`}
                  loading="lazy"
                  onClick={() => onImageClick?.(url, f.name)}
                />
                <figcaption>{f.name}</figcaption>
              </figure>
            );
          }
          return (
            <div key={i} className="ext-att-doc" title={f.path}>
              <span className="ext-att-doc-ic">📄</span>
              <span className="ext-att-doc-name">{f.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ExtensionContextCard({ ctx, onImageClick }: CardProps) {
  switch (ctx.kind) {
    case 'element':
      return <ElementCard ctx={ctx} />;
    case 'network':
      return <NetworkCard ctx={ctx} />;
    case 'error':
      return <ErrorCard ctx={ctx} />;
    case 'attached':
      return <AttachedCard ctx={ctx} onImageClick={onImageClick} />;
    default:
      return null;
  }
}
