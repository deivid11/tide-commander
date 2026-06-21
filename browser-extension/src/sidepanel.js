/* sidepanel.js — two-way chat with the agent assigned to the active page.
 * Sends via background (POST /message), streams replies over the commander's
 * WebSocket, and lets you attach a picked DOM element as context. */

const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));

const els = {
  wsDot: $('ws-dot'),
  commander: $('commander'),
  agentCombo: $('agentCombo'),
  agentInput: $('agentInput'),
  agentAv: $('agentAv'),
  agentCaret: $('agentCaret'),
  agentAreaTag: $('agentAreaTag'),
  agentPop: $('agentPop'),
  agentArea: $('agentArea'),
  agentAreaList: $('agentAreaList'),
  agentSort: $('agentSort'),
  agentList: $('agentList'),
  agentMeta: $('agent-meta'),
  origin: $('origin'),
  refresh: $('refresh'),
  clearCtx: $('clear-ctx'),
  compact: $('compact'),
  pick: $('pick'),
  shot: $('shot'),
  chat: $('chat'),
  hint: $('hint'),
  input: $('input'),
  sendBtn: $('send'),
  attach: $('attach'),
  fileInput: $('fileInput'),
  attachments: $('attachments'),
  pgctx: $('pgctx'),
  errBtn: $('err-btn'),
  errPop: $('err-pop'),
  errCount: $('err-count'),
  errClear: $('err-clear'),
  errList: $('err-list'),
  errEmpty: $('err-empty'),
  netBtn: $('net-btn'),
  netPop: $('net-pop'),
  netCount: $('net-count'),
  netFilter: $('net-filter'),
  netClear: $('net-clear'),
  netList: $('net-list'),
  netEmpty: $('net-empty'),
  conBtn: $('con-btn'),
  conPop: $('con-pop'),
  conCount: $('con-count'),
  conFilter: $('con-filter'),
  conClear: $('con-clear'),
  conList: $('con-list'),
  conEmpty: $('con-empty'),
  reproBtn: $('repro-btn'),
  reproPop: $('repro-pop'),
  reproCount: $('repro-count'),
  reproTitle: $('repro-title'),
  reproStop: $('repro-stop'),
  reproDiscard: $('repro-discard'),
  reproList: $('repro-list'),
  reproEmpty: $('repro-empty'),
  lightbox: $('lightbox'),
  lightboxImg: $('lightbox-img'),
  resizeHandle: $('resize-handle'),
  incstyles: $('incstyles'),
  incheaders: $('incheaders'),
  hidesvg: $('hidesvg'),
  pinbar: $('pinbar'),
  pinToggle: $('pin-toggle'),
  workingBar: $('working-bar'),
  workingAv: $('working-av'),
  workingText: $('working-text'),
  workingStop: $('working-stop'),
  compactingBar: $('compacting-bar'),
  openBuildings: $('open-buildings'),
  buildingsOverlay: $('buildings-overlay'),
  bldRefresh: $('bld-refresh'),
  bldClose: $('bld-close'),
  bldSearch: $('bld-search'),
  bldMsg: $('bld-msg'),
  bldList: $('bld-list'),
  bldEmpty: $('bld-empty'),
};

let config = null;
let currentOrigin; // undefined until first resolve
let activeTabId = null;
let selectedCommander = '';
let selectedAgent = '';
let agentsList = []; // fetched agents (unsorted; renderAgentList sorts on demand)
let agentSortMode = 'name'; // 'name' (A–Z) | 'active' (last active, newest first)
let agentAreaFilter = ''; // '' = all areas; otherwise a lowercased area-name substring to match
let activeIdx = -1; // keyboard-highlighted item in the agent combo
let customClasses = {}; // id -> { icon, iconPath, color } from WS custom_agent_classes_update
// Everything queued for the NEXT message — all multi-attach arrays now.
let pendingElements = []; // [{ context, image, mode }] picked elements / screenshots
let pendingFiles = []; // [{ dataUrl, name, type, isImage }] attached files/images
let pendingNets = []; // [net record] captured requests attached to the next message
let pendingErrors = []; // [error record] captured errors attached to the next message
let pendingConsole = []; // [console record] console logs attached to the next message
const ATTACH_MAX = 12; // per-kind cap on queued attachments
let pickMode = 'pick'; // 'pick' (attach context) | 'shot' (attach + send image)
let netRecords = []; // captured network requests (newest first), fed live by background
let errorRecords = []; // last-rendered error list, for attach-by-fingerprint lookups
let netFilterText = ''; // text filter over method/url/status in the Network section
const netExpanded = new Set(); // netIds whose request/response detail is expanded
let netRenderScheduled = false; // coalesces live re-renders under request bursts
let consoleRecords = []; // captured console.* logs (newest first), fed live by background
let conFilterText = ''; // text filter over level/text in the Console section
let conRenderScheduled = false; // coalesces live console re-renders under bursts
let reproRecording = false; // true while a reproduction is being recorded
let reproSteps = []; // live steps for the in-progress recording (mirrors background)
let reproStartUrl = ''; // page URL where the current recording began
let pendingRepros = []; // [{ steps, screenshotPath, startUrl, count }] queued for the next message
let pinnedIds = []; // agent ids pinned for the active commander (thumbnail bar)
let pinDragging = false; // true while a pin is being drag-reordered
const compactingAgents = new Set(); // agent ids currently compacting context (live WS state)
// Browser-style visited-agent history for the mouse back/forward buttons.
let agentHistory = []; // ids in the order they were visited
let agentHistoryIdx = -1; // pointer into agentHistory (current agent)
let historyCommander = ''; // commander the current stack belongs to (reset on change)
let buildingsList = []; // commander's buildings (services/links/docker/terminals)
let bldFilterText = ''; // search text in the buildings overlay
let bldLoading = false; // true while the buildings list is (re)loading

// built-in agent class → emoji (mirrors BUILT_IN_AGENT_CLASSES in shared/agent-types.ts)
const BUILT_IN_ICONS = {
  scout: '🔍', builder: '🔨', debugger: '🐛', architect: '📐', warrior: '⚔️', support: '💚', boss: '👑',
};

let ws = null;
let wsCommanderId = '';
let wsReconnectTimer = null;
let liveProse = null; // current streaming assistant prose bubble
let liveProseBuf = ''; // raw markdown accumulated for the live bubble
let liveRenderRaf = 0; // rAF handle coalescing live markdown re-renders
let liveStick = true; // whether to keep the live bubble pinned to the bottom
let liveTools = null; // current streaming tool-chip row
let streamIdleTimer = null;

// History pagination: we load the newest `historyLimit` messages (offset 0,
// anchored to the bottom) and grow the window by HISTORY_PAGE when the user
// scrolls to the top. Growing the limit (rather than prepending pages) keeps the
// periodic settle-reload showing every message the user has revealed.
const HISTORY_PAGE = 80;
let historyLimit = HISTORY_PAGE;
let historyHasMore = false;
let loadingMore = false;
let lastHistoryAgent = ''; // reset the window when the selected agent changes
let pendingScrollAdjust = null; // {h, top} → restore reading position after a grow

// ── theme (dark default, light optional) ──
const THEME_KEY = 'tc_theme';
function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  const btn = $('theme-toggle');
  if (btn) {
    btn.textContent = t === 'light' ? '☀' : '🌙';
    btn.title = t === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  }
}
async function loadTheme() {
  let theme = 'dark';
  try {
    const r = await chrome.storage.local.get([THEME_KEY]);
    if (r && r[THEME_KEY]) theme = r[THEME_KEY];
  } catch (_e) {
    /* default dark */
  }
  applyTheme(theme);
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try {
    chrome.storage.local.set({ [THEME_KEY]: next });
  } catch (_e) {
    /* ignore */
  }
}

// ── interface zoom (configurable, persisted) ──
// The A-/A+ stepper scales the WHOLE side panel. Every rule in the stylesheet
// uses absolute px, so a `font-size` bump won't cascade — instead we `zoom` the
// document body as a unit (Chromium scales text, controls and spacing
// proportionally and rewraps within the panel width).
const FONT_SCALE_KEY = 'tc_font_scale';
const FONT_MIN = 0.7;
const FONT_MAX = 1.8;
const FONT_STEP = 0.1;
const FONT_DEFAULT = 1;
let fontScale = FONT_DEFAULT;
function applyFontScale(scale, persist) {
  fontScale = Math.round(Math.max(FONT_MIN, Math.min(FONT_MAX, Number(scale) || FONT_DEFAULT)) * 10) / 10;
  document.body.style.zoom = String(fontScale);
  const pct = Math.round(fontScale * 100);
  const dec = $('font-dec');
  const inc = $('font-inc');
  if (dec) {
    dec.disabled = fontScale <= FONT_MIN + 1e-9;
    dec.title = `Smaller interface — ${pct}% (right-click to reset)`;
  }
  if (inc) {
    inc.disabled = fontScale >= FONT_MAX - 1e-9;
    inc.title = `Larger interface — ${pct}% (right-click to reset)`;
  }
  if (persist) {
    try {
      chrome.storage.local.set({ [FONT_SCALE_KEY]: fontScale });
    } catch (_e) {
      /* ignore */
    }
  }
}
function stepFontScale(delta) {
  applyFontScale(fontScale + delta, true);
}
async function loadFontScale() {
  try {
    const r = await chrome.storage.local.get([FONT_SCALE_KEY]);
    if (r && typeof r[FONT_SCALE_KEY] === 'number') {
      applyFontScale(r[FONT_SCALE_KEY], false);
      return;
    }
  } catch (_e) {
    /* fall through to default */
  }
  applyFontScale(FONT_DEFAULT, false);
}

// ── helpers ──
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

// ── minimal, XSS-safe markdown → HTML (no deps) ──
// Source is HTML-escaped up front; transforms only ADD tags. Fenced/inline code
// is protected from inline formatting. Links are scheme-whitelisted.
function renderInline(text) {
  const codes = [];
  text = text.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(c);
    return ' C' + (codes.length - 1) + ' ';
  });
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t, u) => {
    const safe = /^(https?:|mailto:)/i.test(u) ? u.replace(/"/g, '%22') : '#';
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${t}</a>`;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  text = text.replace(/ C(\d+) /g, (_m, i) => `<code class="ic">${codes[i]}</code>`);
  return text;
}
function mdToHtml(src) {
  const lines = esc(src).split('\n');
  let html = '';
  let i = 0;
  let inList = false;
  let listType = '';
  const closeList = () => {
    if (inList) {
      html += listType === 'ol' ? '</ol>' : '</ul>';
      inList = false;
      listType = '';
    }
  };
  // GFM table helpers: split a row into trimmed cells (honoring escaped \|),
  // and recognize a delimiter row like `| --- | :--: |`.
  const splitRow = (row) => {
    const r = row.trim().replace(/^\|/, '').replace(/\|$/, '');
    return r.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  };
  const isDelimRow = (l) =>
    l != null && /-/.test(l) && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      closeList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      const lang = fence[1] ? ` data-lang="${fence[1]}"` : '';
      html += `<pre class="cb"${lang}><code>${buf.join('\n')}</code></pre>`;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      html += `<div class="h h${h[1].length}">${renderInline(h[2])}</div>`;
      i++;
      continue;
    }
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) {
      closeList();
      html += '<hr/>';
      i++;
      continue;
    }
    if (/^\s*&gt;\s?/.test(line)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*&gt;\s?/, ''));
      html += `<blockquote>${renderInline(buf.join(' '))}</blockquote>`;
      continue;
    }
    if (line.includes('|') && isDelimRow(lines[i + 1])) {
      closeList();
      const headers = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => {
        const l = c.startsWith(':');
        const r = c.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
      });
      i += 2;
      const cell = (tag, txt, ci) => {
        const a = aligns[ci] ? ` style="text-align:${aligns[ci]}"` : '';
        return `<${tag}${a}>${renderInline(txt || '')}</${tag}>`;
      };
      let t = '<table class="md-tbl"><thead><tr>';
      headers.forEach((hh, ci) => (t += cell('th', hh, ci)));
      t += '</tr></thead><tbody>';
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
        const cells = splitRow(lines[i]);
        t += '<tr>';
        for (let ci = 0; ci < headers.length; ci++) t += cell('td', cells[ci], ci);
        t += '</tr>';
        i++;
      }
      html += t + '</tbody></table>';
      continue;
    }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      const t = ol ? 'ol' : 'ul';
      if (!inList || listType !== t) {
        closeList();
        html += t === 'ol' ? '<ol>' : '<ul>';
        inList = true;
        listType = t;
      }
      html += `<li>${renderInline(ul ? ul[1] : ol[1])}</li>`;
      i++;
      continue;
    }
    if (/^\s*$/.test(line)) {
      closeList();
      i++;
      continue;
    }
    closeList();
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^\s*[-*+]\s/.test(lines[i]) &&
      !/^\s*\d+\.\s/.test(lines[i]) &&
      !/^\s*&gt;\s?/.test(lines[i]) &&
      !(lines[i].includes('|') && isDelimRow(lines[i + 1]))
    ) {
      buf.push(lines[i++]);
    }
    html += `<p>${renderInline(buf.join('\n')).replace(/\n/g, '<br/>')}</p>`;
  }
  closeList();
  return html;
}
function atBottom() {
  return els.chat.scrollHeight - els.chat.scrollTop - els.chat.clientHeight < 60;
}
function scrollDown() {
  els.chat.scrollTop = els.chat.scrollHeight;
}
function commanderBy(id) {
  return (config.commanders || []).find((c) => c.id === id);
}

// ── rendering ──
function clearChat() {
  els.chat.innerHTML = '';
  resetLiveProse();
  liveTools = null;
}
// Reset the streaming prose bubble + its pending markdown render.
function resetLiveProse() {
  liveProse = null;
  liveProseBuf = '';
  if (liveRenderRaf) {
    cancelAnimationFrame(liveRenderRaf);
    liveRenderRaf = 0;
  }
}
// Render the accumulated markdown into the live bubble, coalesced to one paint
// per frame. Rendering markdown *live* (instead of swapping plain text → md only
// at settle) removes the visible "conversion" flicker mid-stream.
function scheduleLiveRender() {
  if (liveRenderRaf) return;
  liveRenderRaf = requestAnimationFrame(() => {
    liveRenderRaf = 0;
    if (!liveProse) return;
    const body = liveProse.querySelector('.body');
    if (body) body.innerHTML = mdToHtml(liveProseBuf);
    if (liveStick) scrollDown();
  });
}
function toolSummary(name, input) {
  if (!input) return name;
  const i = input;
  const v = i.command || i.file_path || i.path || i.pattern || i.url || '';
  return `${name}${v ? ': ' + String(v).slice(0, 120) : ''}`;
}
// Absolute date + time a message was sent/answered (from the session timestamp).
// Accepts an ISO string or epoch ms; returns '' when unparseable.
function fmtMsgTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
// Tack a muted timestamp line onto a rendered message bubble.
function appendMsgTime(el, ts) {
  if (!el) return;
  const label = fmtMsgTime(ts);
  if (!label) return;
  const t = document.createElement('div');
  t.className = 'msgtime';
  t.textContent = label;
  el.appendChild(t);
}
function addMessage(type, content, toolName, toolInput, timestamp) {
  const stick = atBottom();

  if (type === 'tool_use') {
    const div = document.createElement('div');
    div.className = 'msg tool';
    div.innerHTML = `🔧 <span class="tname">${esc(toolSummary(toolName || 'tool', toolInput))}</span>`;
    els.chat.appendChild(div);
    if (stick) scrollDown();
    return div;
  }

  if (type !== 'assistant' && type !== 'user') return null;

  // First chance: the ported Guake renderers turn special blocks (task
  // notifications, agent/WhatsApp/Slack/Gmail messages, boss delegations, …)
  // into pretty cards. Falls through to the plain bubble when nothing matches.
  const special = window.TCRenderers
    ? window.TCRenderers.renderSpecial(content || '', type, rendererDeps())
    : null;
  if (window.TCRenderers && special === window.TCRenderers.HIDE) return null; // e.g. /compact echo
  if (special) {
    appendMsgTime(special, timestamp);
    els.chat.appendChild(special);
    if (stick) scrollDown();
    return special;
  }

  const div = document.createElement('div');
  if (type === 'assistant') {
    div.className = 'msg assistant';
    div.innerHTML = assistantRoleHtml();
    const body = window.TCRenderers ? window.TCRenderers.renderRichBody(content || '', rendererDeps()) : null;
    if (body) {
      div.appendChild(body);
    } else {
      div.insertAdjacentHTML('beforeend', '<div class="md">' + mdToHtml(content || '') + '</div>');
    }
  } else {
    div.className = 'msg user';
    const utext = document.createElement('div');
    utext.className = 'utext';
    utext.innerHTML = '<span class="prompt">❯</span>';
    const body = window.TCRenderers ? window.TCRenderers.renderRichBody(content || '', rendererDeps()) : null;
    if (body) {
      utext.appendChild(body);
    } else {
      utext.insertAdjacentHTML('beforeend', '<div class="md">' + mdToHtml(content || '') + '</div>');
    }
    div.innerHTML = '<div class="role">user</div>';
    div.appendChild(utext);
  }
  appendMsgTime(div, timestamp);
  els.chat.appendChild(div);
  if (stick) scrollDown();
  return div;
}
// ── compact tool chips (light terminal — no verbose command dumps) ──
const TOOL_ICON = {
  Bash: '$', Read: '≡', Edit: '✎', Write: '✎', MultiEdit: '✎', NotebookEdit: '✎',
  Grep: '⌕', Glob: '⌕', Task: '⊹', WebFetch: '↯', WebSearch: '↯', TodoWrite: '☑',
};
function basename(p) {
  if (!p) return '';
  const s = String(p).split(/[\\/]/).filter(Boolean);
  return s[s.length - 1] || String(p);
}
function chipHtml(name, input) {
  const i = input || {};
  const icon = TOOL_ICON[name] || '•';
  let label = name || 'tool';
  if (name === 'Bash') label = (String(i.command || '').trim().split(/\s+/)[0] || 'bash');
  else if (['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name)) label = basename(i.file_path || i.path || i.notebook_path) || name;
  else if (name === 'Grep' || name === 'Glob') label = String(i.pattern || i.query || name).slice(0, 18);
  else if (name === 'Task') label = String(i.subagent_type || i.description || 'task').slice(0, 18);
  else if (name === 'WebFetch' || name === 'WebSearch') label = String(i.url || i.query || name).slice(0, 22);
  const full = i.command || i.file_path || i.path || i.pattern || i.query || i.url || '';
  const title = esc((name || 'tool') + (full ? ': ' + String(full).slice(0, 400) : '')).replace(/"/g, '&quot;');
  return `<span class="tchip" title="${title}"><i>${esc(icon)}</i>${esc(label)}</span>`;
}
// A live `output` chunk that is tool noise (not assistant prose). The server emits
// these as separate messages: "Using tool:" carries payload.toolName; the follow-up
// "Tool input:" / "<Tool> output:" chunks only have the text prefix.
function isToolChunk(p) {
  if (p.toolName) return true;
  return /^(Using tool:|Tool input:|Tool result:|Tool output:|[\w.-]+ output:)/.test(p.text || '');
}
function renderHistory(messages) {
  // Preserve the reader's position across reloads: only snap to the newest
  // message if they were already at the bottom. If they've scrolled up to read
  // earlier messages, keep their view where it is (the settle-timer reload fires
  // ~1.3s after each streamed chunk, and used to yank them back down every time).
  const stick = atBottom();
  const prevScroll = els.chat.scrollTop;
  clearChat();
  if (!messages || messages.length === 0) {
    els.chat.innerHTML = '<div class="hint">No conversation yet. Say hi 👋</div>';
    renderPendingPrompts(); // a prompt may be pending even with no history yet
    pendingScrollAdjust = null;
    return;
  }
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.type === 'tool_result') {
      i++;
      continue;
    }
    if (m.type === 'tool_use') {
      // coalesce a run of tool calls into one compact chip row
      const chips = [];
      while (i < messages.length && (messages[i].type === 'tool_use' || messages[i].type === 'tool_result')) {
        if (messages[i].type === 'tool_use') chips.push(chipHtml(messages[i].toolName, messages[i].toolInput));
        i++;
      }
      const row = document.createElement('div');
      row.className = 'msg tools';
      row.innerHTML = chips.join('');
      els.chat.appendChild(row);
      continue;
    }
    addMessage(m.type, m.content, m.toolName, m.toolInput, m.timestamp);
    i++;
  }
  renderPendingPrompts(); // re-mount any unanswered interactive prompts
  if (pendingScrollAdjust) {
    // Keep the previously-top message at the same viewport position after older
    // messages were prepended above it (scrollHeight grew by their height).
    els.chat.scrollTop = els.chat.scrollHeight - pendingScrollAdjust.h + pendingScrollAdjust.top;
    pendingScrollAdjust = null;
  } else if (stick) scrollDown();
  else els.chat.scrollTop = prevScroll; // restore the scrolled-up reading position
}
function showErr(text) {
  const stick = atBottom();
  const d = document.createElement('div');
  d.className = 'err';
  d.textContent = text;
  els.chat.appendChild(d);
  if (stick) scrollDown();
}

// ── data flow ──
async function loadConfig() {
  const state = await send({ type: 'getState' });
  config = state.config;
  els.pgctx.checked = !!config.includePageContext;
  els.incstyles.checked = config.includeComputedStyles !== false; // default on
  els.incheaders.checked = config.includeNetworkHeaders !== false; // default on
  els.hidesvg.checked = config.hideSvg !== false; // default on (strip svg noise)
  els.commander.innerHTML = '';
  for (const c of config.commanders || []) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name || c.baseUrl;
    els.commander.appendChild(o);
  }
}

async function resolveForActiveTab() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_e) {
    return;
  }
  if (!tab) return;
  let origin = '';
  try {
    origin = new URL(tab.url).origin;
  } catch (_e) {
    /* chrome:// etc. */
  }
  if (origin === currentOrigin) {
    activeTabId = tab.id;
    return;
  }
  currentOrigin = origin;
  activeTabId = tab.id;
  els.origin.textContent = origin || tab.url || '—';

  if (!origin) {
    agentsList = [];
    selectedAgent = '';
    updateAgentDisplay();
    els.agentInput.placeholder = '(no web page)';
    return;
  }
  const { target } = await send({ type: 'resolveTarget', origin });
  if (target) {
    flushCompose(); // persist the outgoing agent's draft before re-resolving
    selectedCommander = target.commanderId;
    els.commander.value = target.commanderId;
    await loadAgents(target.agentId);
  }
}

async function loadAgents(preferId) {
  const res = await send({ type: 'fetchAgents', commanderId: selectedCommander });
  if (!res || !res.ok) {
    agentsList = [];
    selectedAgent = '';
    updateAgentDisplay();
    els.agentInput.placeholder = res && res.error ? 'error: ' + res.error : 'no agents';
    return;
  }
  // sorted by name for a stable default pick; renderAgentList re-sorts per mode
  agentsList = res.agents
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
  const ids = agentsList.map((a) => a.id);
  selectedAgent = preferId && ids.includes(preferId) ? preferId : agentsList[0] ? agentsList[0].id : '';
  // History: a new commander starts a fresh stack rooted at the picked agent;
  // within the same commander, a load that lands on a different agent (e.g. a
  // tab-assigned origin) is recorded as a visit so Back can return.
  if (selectedCommander !== historyCommander) {
    seedAgentHistory(selectedAgent);
  } else if (selectedAgent && agentHistory[agentHistoryIdx] !== selectedAgent) {
    pushAgentHistory(selectedAgent);
  }
  populateAreaFilter();
  await loadPins();
  updateAgentDisplay();
  await loadCompose(); // restore this agent's saved draft + queued attachments
  if (currentOrigin && selectedAgent) {
    await send({ type: 'assignOrigin', origin: currentOrigin, commanderId: selectedCommander, agentId: selectedAgent });
  }
  connectWs();
  await loadHistory();
}

// ── unified search/select agent combobox ──
function selectedAgentObj() {
  return agentsList.find((x) => x.id === selectedAgent);
}
function currentCommander() {
  return (config.commanders || []).find((c) => c.id === selectedCommander);
}
// Deep-link into the commander app focused on an agent (selects it + opens its
// terminal — see App.tsx's agentId/agentName/openTerminal query handler). Same
// origin as the panel's API calls, so the app's stored auth token carries over.
function commanderAppUrl(agent) {
  const c = currentCommander();
  if (!c) return '';
  // Per-commander override for where agent links open (the web app may live at a
  // different host/port/path than the API baseUrl); fall back to baseUrl.
  const base = String(c.appUrl || c.baseUrl || '').replace(/\/+$/, '');
  if (!base) return '';
  const params = new URLSearchParams();
  if (agent && agent.id) params.set('agentId', agent.id);
  if (agent && agent.name) params.set('agentName', agent.name);
  params.set('openTerminal', '1');
  return `${base}/?${params.toString()}`;
}
// Assistant message header: agent avatar + name, linked to the commander app.
function assistantRoleHtml() {
  const a = selectedAgentObj();
  const name = (a && a.name) || 'assistant';
  const inner = `<span class="role-av">${iconInner(a)}</span>${esc(name)}`;
  const url = commanderAppUrl(a);
  return url
    ? `<a class="role agent-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Open ${esc(name)} in the commander app">${inner}</a>`
    : `<div class="role">${inner}</div>`;
}
// Resolve an image/file path the agent referenced ([Image: …]) to a web URL the
// panel can load. Mirrors contentRendering.getImageWebUrl: http stays as-is,
// /uploads/ and tide-commander-uploads paths route through the commander.
function resolveImage(path) {
  if (!path) return path;
  if (/^https?:/i.test(path)) return path;
  const c = currentCommander();
  const base = c ? (c.baseUrl || '').replace(/\/+$/, '') : '';
  if (!base) return path;
  // Carry the token (harmless on the public /uploads mount; required if the
  // commander is auth-gated or behind a proxy) — same scheme the avatars use.
  const tok = c && c.token ? `?token=${encodeURIComponent(c.token)}` : '';
  if (path.startsWith('/uploads/')) return `${base}${path}${tok}`;
  if (path.includes('tide-commander-uploads')) return `${base}/uploads/${path.split('/').pop()}${tok}`;
  // Browser-extension attachments / element shots are served at /attachments.
  if (path.includes('browser-errors/attachments/')) return `${base}/attachments/${path.split('/').pop()}${tok}`;
  return path;
}
// Dependencies handed to the ported Guake renderers (window.TCRenderers).
function rendererDeps() {
  return { md: mdToHtml, esc, resolveImage };
}

// ── interactive agent prompts (AskUserQuestion / ExitPlanMode) ──
// Forwarded by the server as `agent_prompt_request` WS events while the agent
// blocks waiting for the user. We keep two maps: `pendingPrompts` drives whether
// a card should exist; `promptCards` holds the live card element so its
// in-progress picks survive the history reloads that wipe the chat.
const pendingPrompts = new Map(); // requestId -> prompt { id, agentId, tool, input }
const promptCards = new Map(); // requestId -> card element (state preserved)

// Send the user's answer back through the background proxy (carries the token).
async function respondToPrompt(requestId, approved, opts) {
  opts = opts || {};
  const res = await send({
    type: 'respondPrompt',
    commanderId: selectedCommander,
    requestId,
    approved,
    answers: opts.answers,
    reason: opts.reason,
  });
  if (res && res.ok) {
    // Answered here: drop it from the pending set so a history reload won't
    // recreate a fresh card. The card keeps its "sent" confirmation until the
    // next render naturally clears it.
    pendingPrompts.delete(requestId);
    promptCards.delete(requestId);
  }
  return res || { ok: false, error: 'no response' };
}
function promptDeps() {
  return { md: mdToHtml, esc, respond: respondToPrompt };
}

// Ensure every still-pending prompt for the active agent has its card mounted at
// the bottom of the chat. Re-appends the SAME element (preserving picks) when a
// history reload has detached it. Called after each renderHistory.
function renderPendingPrompts() {
  if (!window.TCRenderers || !window.TCRenderers.renderAgentPrompt) return;
  const stick = atBottom();
  let added = false;
  for (const prompt of pendingPrompts.values()) {
    if (prompt.agentId !== selectedAgent) continue;
    let card = promptCards.get(prompt.id);
    if (!card) {
      card = window.TCRenderers.renderAgentPrompt(prompt, promptDeps());
      if (!card) continue;
      promptCards.set(prompt.id, card);
    }
    if (card.parentElement !== els.chat) {
      const hint = els.chat.querySelector('.hint');
      if (hint) hint.remove();
      els.chat.appendChild(card);
      added = true;
    }
  }
  if (added && stick) scrollDown();
}

// A prompt was resolved (by us, by another client, or via timeout). Forget it;
// remove the card unless it's already showing our own "sent" confirmation.
function resolvePromptCard(requestId) {
  pendingPrompts.delete(requestId);
  const card = promptCards.get(requestId);
  promptCards.delete(requestId);
  if (card && !card.classList.contains('resolved') && card.parentElement) card.remove();
}
// Resolve an agent's class icon → { emoji } or { imgUrl } (custom uploaded icon).
function agentIcon(a) {
  if (!a) return { emoji: '🤖' };
  if (a.isBoss || a.class === 'boss') return { emoji: '👑' };
  if (BUILT_IN_ICONS[a.class]) return { emoji: BUILT_IN_ICONS[a.class] };
  const cc = customClasses[a.class];
  if (cc && cc.iconPath) {
    const c = currentCommander();
    if (c) {
      const base = (c.baseUrl || '').replace(/\/+$/, '');
      return { imgUrl: `${base}/api/custom-class-icons/${encodeURIComponent(cc.iconPath)}?token=${encodeURIComponent(c.token || '')}` };
    }
  }
  if (cc && cc.icon) return { emoji: cc.icon };
  return { emoji: '🤖' };
}
function iconInner(a) {
  const ic = agentIcon(a);
  return ic.imgUrl ? `<img src="${esc(ic.imgUrl)}" alt="" />` : esc(ic.emoji);
}
function isWorking(a) {
  const s = a && String(a.status || '').toLowerCase();
  return s === 'working' || s === 'thinking';
}
// An agent's "area" = the project it works in (its working directory). Classes
// here are often 1:1 with agents, so grouping by class just lists agents —
// grouping by cwd groups agents that share a project. The key is the full path;
// the label is the trailing folder name.
function areaKey(a) {
  const cwd = a && a.cwd ? String(a.cwd).replace(/[\\/]+$/, '') : '';
  return cwd;
}
function areaOf(a) {
  const key = areaKey(a);
  if (!key) return 'No project';
  const parts = key.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || key;
}
// Stable accent color per area, hashed from the path so each project is
// consistently tinted across renders.
function areaColor(a) {
  const key = areaKey(a);
  if (!key) return '';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 50% 62%)`;
}
// Compact token count: 1234 → "1k", 162464 → "162k", 1000000 → "1M".
function fmtTokens(n) {
  n = +n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}
// Context usage → { pct, text } or null when unknown.
function ctxInfo(a) {
  const used = +(a && a.contextUsed) || 0;
  const limit = +(a && a.contextLimit) || 0;
  if (!limit) return null;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return { pct, text: pct + '% · ' + fmtTokens(used) };
}
// Relative "time ago" for lastActivity timestamps.
function fmtAgo(ts) {
  if (!ts) return '';
  let s = Math.floor((Date.now() - ts) / 1000);
  if (s < 0) s = 0;
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 30) return d + 'd ago';
  return Math.floor(d / 30) + 'mo ago';
}
// Distinct areas present in the current agent list, label+id, sorted by label.
function agentAreas() {
  const seen = new Map();
  for (const a of agentsList) {
    const key = areaKey(a);
    if (!seen.has(key)) seen.set(key, areaOf(a));
  }
  return Array.from(seen.entries())
    .map(([id, label]) => ({ id, label }))
    .sort((x, y) => x.label.localeCompare(y.label, undefined, { sensitivity: 'base' }));
}
// Refresh the area-filter datalist with the distinct area names, so typing in
// the text input gets native autocomplete suggestions. The actual filtering is
// done by renderAgentList() via a case-insensitive substring match, so the input
// is free-text (no need to select an exact suggestion).
function populateAreaFilter() {
  if (!els.agentAreaList) return;
  const labels = Array.from(new Set(agentAreas().map((ar) => ar.label)));
  els.agentAreaList.innerHTML = labels.map((l) => `<option value="${esc(l)}"></option>`).join('');
}
function sortLabel() {
  return agentSortMode === 'active' ? '↓ Recent' : '↓ A–Z';
}
// Shared ordering for the dropdown and for mouse back/forward agent cycling, so
// "previous / next agent" matches the order shown in the list.
function agentSortCmp(a, b) {
  return agentSortMode === 'active'
    ? (b.lastActivity || 0) - (a.lastActivity || 0)
    : String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
}
// The input shows the selected agent's NAME when not actively searching (focus
// runs .select() over it). Treat that as "no filter" so the sort / area toggles
// re-list every agent instead of collapsing to the one selected agent.
function effectiveAgentFilter() {
  const v = els.agentInput.value;
  const a = selectedAgentObj();
  if (!v || (a && v === a.name)) return '';
  return v;
}
function updateAgentDisplay() {
  const a = selectedAgentObj();
  els.agentInput.value = a ? a.name : '';
  els.agentInput.placeholder = agentsList.length ? 'Search agents…' : 'no agents';
  els.agentInput.disabled = !agentsList.length;
  els.agentAv.innerHTML = a ? iconInner(a) : '';
  els.agentCombo.classList.toggle('working', isWorking(a));
  updateWorkingIndicator(a);
  updateCompactingIndicator();
  updateAgentMeta(a);
  updateAgentAreaTag();
  renderPinBar();
  renderPinToggle();
}
// Show the sweep-bar while the SELECTED agent is compacting its context.
function updateCompactingIndicator() {
  if (!els.compactingBar) return;
  els.compactingBar.hidden = !(selectedAgent && compactingAgents.has(selectedAgent));
}
// Composer pin toggle — reflects whether the currently-open agent is pinned.
// Hidden when no agent is selected; filled/accent when pinned.
function renderPinToggle() {
  const btn = els.pinToggle;
  if (!btn) return;
  const a = selectedAgentObj();
  if (!a) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  const pinned = isPinned(a.id);
  btn.classList.toggle('on', pinned);
  btn.title = `${pinned ? 'Unpin' : 'Pin'} ${a.name || a.id}`;
  btn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
}
// Selected ("open") agent's context — area, context-window usage, status, last
// active — mirroring the dropdown row meta so it's visible without opening the list.
function updateAgentMeta(a) {
  if (!els.agentMeta) return;
  if (!a) {
    els.agentMeta.hidden = true;
    els.agentMeta.innerHTML = '';
    return;
  }
  const col = areaColor(a);
  const areaChip = `<span class="ci-area"${col ? ` style="color:${esc(col)};border-color:${esc(col)}"` : ''}>${esc(areaOf(a))}</span>`;
  const ctx = ctxInfo(a);
  const ctxChip = ctx
    ? `<span class="ci-ctx" title="Context used"><span class="ci-bar"><i style="width:${ctx.pct}%"></i></span>${esc(ctx.text)}</span>`
    : '';
  const status = a.status && !isWorking(a) ? `<span class="am-status">${esc(a.status)}</span>` : '';
  const ago = a.lastActivity ? `<span class="ci-ago" title="Last active">${esc(fmtAgo(a.lastActivity))}</span>` : '';
  const modelChip = a.model
    ? `<span class="ci-model" title="Model: ${esc(a.model)}">${esc(modelLabel(a.model))}</span>`
    : '';
  els.agentMeta.innerHTML = areaChip + modelChip + ctxChip + status + ago;
  els.agentMeta.hidden = false;
}
// Read-only area chip pinned to the right of the agent selector, so the open
// agent's project shows beside its name without opening the dropdown. Hidden
// while the user is typing a search (the input reclaims the full width). The
// matching right padding keeps a long name from sliding under the chip.
function updateAgentAreaTag() {
  const el = els.agentAreaTag;
  if (!el) return;
  const a = selectedAgentObj();
  const searching = effectiveAgentFilter() !== '';
  if (!a || searching) {
    el.hidden = true;
    els.agentInput.style.paddingRight = '';
    return;
  }
  const col = areaColor(a);
  el.textContent = areaOf(a);
  el.title = `Project: ${areaOf(a)}`;
  el.style.color = col || '';
  el.style.borderColor = col || '';
  el.hidden = false;
  // Measure once visible, then reserve room (chip width + caret gap).
  els.agentInput.style.paddingRight = (el.offsetWidth + 30) + 'px';
}
// Prominent in-chat "agent is working" bar, driven by the selected agent's live
// status (working/thinking). Shown above the composer so it's always visible.
function updateWorkingIndicator(a) {
  if (!els.workingBar) return;
  const agent = a || selectedAgentObj();
  const working = isWorking(agent);
  els.workingBar.hidden = !working;
  if (working) {
    els.workingAv.innerHTML = iconInner(agent);
    els.workingText.textContent = `${agent && agent.name ? agent.name : 'Agent'} is working`;
  }
}

// ── pinned agents (quick-select thumbnail bar above the composer) ──
// Pins are stored per-commander in chrome.storage.local under `tc_pins`:
//   { [commanderId]: [agentId, …] }
const PINS_KEY = 'tc_pins';
function isPinned(id) {
  return pinnedIds.includes(id);
}
async function loadPins() {
  pinnedIds = [];
  try {
    const r = await chrome.storage.local.get([PINS_KEY]);
    const map = (r && r[PINS_KEY]) || {};
    if (Array.isArray(map[selectedCommander])) pinnedIds = map[selectedCommander].slice();
  } catch (_e) {
    /* ignore */
  }
}
async function savePins() {
  try {
    const r = await chrome.storage.local.get([PINS_KEY]);
    const map = (r && r[PINS_KEY]) || {};
    map[selectedCommander] = pinnedIds;
    await chrome.storage.local.set({ [PINS_KEY]: map });
  } catch (_e) {
    /* ignore */
  }
}
function togglePin(id) {
  if (!id) return;
  const i = pinnedIds.indexOf(id);
  if (i >= 0) pinnedIds.splice(i, 1);
  else pinnedIds.push(id);
  savePins();
  renderPinBar();
  renderPinToggle();
  if (!els.agentPop.hidden) renderAgentList(els.agentInput.value);
}
// Thumbnail strip of pinned agents (in pin order). Hidden when nothing pinned.
function renderPinBar() {
  if (!els.pinbar) return;
  // Don't rebuild mid-drag — a live agents_update would wipe the dragged node.
  if (pinDragging) return;
  const pins = pinnedIds.map((id) => agentsList.find((a) => a.id === id)).filter(Boolean);
  if (!pins.length) {
    els.pinbar.hidden = true;
    els.pinbar.innerHTML = '';
    return;
  }
  els.pinbar.hidden = false;
  // Past the configured count the named chips overflow the bar, so collapse to
  // thumbnail-only (avatar + tooltip). The CSS `.pinbar.compact` rule hides .pin-name.
  // Threshold is set in extension Settings (pinThumbnailThreshold); 0 = always compact.
  const _pinT = config && Number.isFinite(config.pinThumbnailThreshold) ? config.pinThumbnailThreshold : 5;
  els.pinbar.classList.toggle('compact', pins.length > _pinT);
  els.pinbar.innerHTML = pins
    .map((a) => {
      const sel = a.id === selectedAgent ? ' sel' : '';
      const working = isWorking(a) ? ' working' : '';
      const label = esc(a.name || a.id) + (a.status ? ` — ${esc(a.status)}` : '');
      // Tint the chip by the agent's area (project) so pins cluster visually.
      const col = areaColor(a);
      const areaCls = col ? ' has-area' : '';
      const areaStyle = col ? ` style="--area-col:${col}"` : '';
      return (
        `<button class="pin${sel}${working}${areaCls}" data-id="${esc(a.id)}" draggable="true"${areaStyle} title="${label}">` +
        `<span class="pin-av">${iconInner(a)}</span>` +
        `<span class="pin-name">${esc(a.name || a.id)}</span>` +
        `<span class="pin-x" data-unpin title="Unpin">×</span>` +
        `</button>`
      );
    })
    .join('');
}
// Pretty short model label: "claude-opus-4-8[1m]" → "Opus 4.8 · 1M".
// Falls back to a cleaned-up version of whatever the backend reports.
function modelLabel(model) {
  if (!model) return '';
  let m = String(model).trim();
  let ctx = '';
  const mm = m.match(/\[([^\]]+)\]\s*$/);
  if (mm) {
    ctx = mm[1];
    m = m.slice(0, mm.index).trim();
  }
  let label;
  const cm = m.match(/^claude-(opus|sonnet|haiku|fable)-(\d+)-(\d+)/i);
  if (cm) {
    label = cm[1][0].toUpperCase() + cm[1].slice(1) + ' ' + cm[2] + '.' + cm[3];
  } else {
    label = m.replace(/^claude-/i, '').replace(/-/g, ' ');
  }
  return ctx ? label + ' · ' + ctx.toUpperCase() : label;
}
function renderAgentList(filter) {
  const prevScroll = els.agentList.scrollTop; // preserve across live re-renders
  const f = String(filter || '').trim().toLowerCase();
  const items = agentsList
    .filter((a) => {
      if (agentAreaFilter && !areaOf(a).toLowerCase().includes(agentAreaFilter)) return false;
      if (!f) return true;
      return (
        String(a.name || '').toLowerCase().includes(f) ||
        String(a.id || '').toLowerCase().includes(f) ||
        areaOf(a).toLowerCase().includes(f)
      );
    })
    .sort(agentSortCmp);
  els.agentList.innerHTML = items.length
    ? items
        .map((a) => {
          const working = isWorking(a);
          // Working agents get animated typing dots in place of the status text.
          const tail = working
            ? `<span class="ci-typing" aria-label="working"><i></i><i></i><i></i></span>`
            : (a.status ? `<span class="ci-status">${esc(a.status)}</span>` : '');
          const col = areaColor(a);
          const areaChip = `<span class="ci-area"${col ? ` style="color:${esc(col)};border-color:${esc(col)}"` : ''}>${esc(areaOf(a))}</span>`;
          const ctx = ctxInfo(a);
          const ctxChip = ctx
            ? `<span class="ci-ctx" title="Context used"><span class="ci-bar"><i style="width:${ctx.pct}%"></i></span>${esc(ctx.text)}</span>`
            : '';
          const ago = a.lastActivity ? `<span class="ci-ago" title="Last active">${esc(fmtAgo(a.lastActivity))}</span>` : '';
          const modelChip = a.model
            ? `<span class="ci-model" title="Model: ${esc(a.model)}">${esc(modelLabel(a.model))}</span>`
            : '';
          const pinned = isPinned(a.id);
          return (
            `<div class="combo-item${a.id === selectedAgent ? ' sel' : ''}${working ? ' working' : ''}" data-id="${esc(a.id)}">` +
            `<span class="ci-av">${iconInner(a)}</span>` +
            `<span class="ci-main">` +
            `<span class="ci-top"><span class="ci-name">${esc(a.name)}</span>${tail}</span>` +
            `<span class="ci-meta">${areaChip}${modelChip}${ctxChip}${ago}</span>` +
            `</span>` +
            `<button class="ci-pin${pinned ? ' on' : ''}" data-pin="${esc(a.id)}" title="${pinned ? 'Unpin' : 'Pin'} agent">📌</button>` +
            `</div>`
          );
        })
        .join('')
    : '<div class="combo-empty">No match</div>';
  els.agentList.scrollTop = prevScroll; // restore scroll after innerHTML rebuild
}
function comboItems() {
  return Array.from(els.agentList.querySelectorAll('.combo-item'));
}
function highlight(idx) {
  const items = comboItems();
  items.forEach((el, i) => el.classList.toggle('active', i === idx));
  if (items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
  activeIdx = idx;
}
function openAgentCombo(showAll) {
  if (!agentsList.length) return;
  els.agentPop.hidden = false;
  els.agentInput.setAttribute('aria-expanded', 'true');
  els.agentSort.textContent = sortLabel();
  renderAgentList(showAll ? '' : els.agentInput.value);
  activeIdx = -1;
}
function closeAgentCombo() {
  els.agentPop.hidden = true;
  els.agentInput.setAttribute('aria-expanded', 'false');
  activeIdx = -1;
}
// ── visited-agent history (mouse back/forward) ──
// Record a freshly-visited agent. Like a browser: visiting a new agent after
// going Back drops the forward entries; consecutive duplicates are ignored.
function pushAgentHistory(id) {
  if (!id) return;
  if (agentHistory[agentHistoryIdx] === id) return; // already current
  if (agentHistoryIdx < agentHistory.length - 1) {
    agentHistory = agentHistory.slice(0, agentHistoryIdx + 1); // truncate forward
  }
  agentHistory.push(id);
  agentHistoryIdx = agentHistory.length - 1;
}
// Reset/seed the stack when the commander (agent universe) changes.
function seedAgentHistory(id) {
  agentHistory = id ? [id] : [];
  agentHistoryIdx = id ? 0 : -1;
  historyCommander = selectedCommander;
}
function goAgentBack() {
  navigateHistory(-1);
}
function goAgentForward() {
  navigateHistory(1);
}
// Step the history pointer, skipping any agents that no longer exist, and select
// the resulting one without recording a new visit.
function navigateHistory(dir) {
  let i = agentHistoryIdx + dir;
  while (i >= 0 && i < agentHistory.length && !agentsList.some((a) => a.id === agentHistory[i])) {
    i += dir;
  }
  if (i < 0 || i >= agentHistory.length) return; // nothing visitable that way
  agentHistoryIdx = i;
  const id = agentHistory[i];
  if (id && id !== selectedAgent) selectAgent(id, { fromHistory: true });
}
async function selectAgent(id, opts) {
  closeAgentCombo();
  if (!id || id === selectedAgent) {
    updateAgentDisplay();
    els.agentInput.blur();
    return;
  }
  flushCompose(); // persist the OUTGOING agent's draft + attachments before switching
  selectedAgent = id;
  // Record the visit unless this select came FROM a back/forward navigation.
  if (!(opts && opts.fromHistory)) pushAgentHistory(id);
  resetClearBtn(); // don't carry an armed "confirm clear" across agents
  updateAgentDisplay();
  els.agentInput.blur();
  await loadCompose(); // restore the INCOMING agent's draft + attachments
  if (currentOrigin) {
    await send({ type: 'assignOrigin', origin: currentOrigin, commanderId: selectedCommander, agentId: selectedAgent });
  }
  await loadHistory({ spinner: true });
  // Selecting an agent drops the user straight into the message box.
  if (els.input && !els.input.disabled) els.input.focus();
}

// Spinner shown while a fresh history loads (switching agents / manual refresh).
// Not used by the settle-timer reload, which must not wipe streamed content.
function showChatLoading() {
  clearChat();
  els.chat.innerHTML = '<div class="chat-loading"><span class="cl-spin"></span><span>Loading conversation…</span></div>';
}
async function loadHistory(opts) {
  if (streamIdleTimer) {
    clearTimeout(streamIdleTimer);
    streamIdleTimer = null;
  }
  if (!selectedAgent) {
    renderHistory([]);
    return;
  }
  // Switching agents starts a fresh one-page window; same agent keeps whatever
  // the user has scrolled open.
  if (selectedAgent !== lastHistoryAgent) {
    historyLimit = HISTORY_PAGE;
    historyHasMore = false;
    pendingScrollAdjust = null; // a switch should snap to newest, not preserve
    lastHistoryAgent = selectedAgent;
  }
  if (opts && opts.spinner) showChatLoading();
  const res = await send({ type: 'getHistory', commanderId: selectedCommander, agentId: selectedAgent, limit: historyLimit });
  if (!res || !res.ok) {
    clearChat();
    showErr(res && res.error ? 'history: ' + res.error : 'history failed');
    return;
  }
  historyHasMore = !!res.hasMore;
  renderHistory(res.messages);
}

// Grow the history window when the user scrolls to the top, preserving their
// reading position (older messages are prepended above the current view).
async function loadMoreHistory() {
  if (loadingMore || !historyHasMore || !selectedAgent) return;
  loadingMore = true;
  // Anchor BEFORE adding the transient indicator so the delta math is exact
  // (the indicator is wiped by the re-render's clearChat).
  pendingScrollAdjust = { h: els.chat.scrollHeight, top: els.chat.scrollTop };
  const ind = document.createElement('div');
  ind.className = 'hint more-loading';
  ind.textContent = 'Loading older messages…';
  els.chat.insertBefore(ind, els.chat.firstChild);
  historyLimit += HISTORY_PAGE;
  try {
    await loadHistory();
  } finally {
    loadingMore = false;
  }
}

// ── websocket (live streaming) ──
function setWsDot(state) {
  els.wsDot.className = 'dot ' + state;
}
function connectWs() {
  const c = commanderBy(selectedCommander);
  if (!c) return;
  if (ws && wsCommanderId === selectedCommander && (ws.readyState === 0 || ws.readyState === 1)) return;
  if (ws) {
    try {
      ws.close();
    } catch (_e) {
      /* ignore */
    }
    ws = null;
  }
  wsCommanderId = selectedCommander;
  const base = (c.baseUrl || '').replace(/\/+$/, '');
  const wsUrl = base.replace(/^http/, 'ws') + '/ws' + (c.token ? '?token=' + encodeURIComponent(c.token) : '');
  setWsDot('');
  try {
    ws = new WebSocket(wsUrl);
  } catch (_e) {
    setWsDot('bad');
    return;
  }
  ws.addEventListener('open', () => {
    setWsDot('ok');
    // Register this panel as a browser-command target so server-side agents can
    // read the live page (DOM/console/network/screenshot) through the bridge.
    try {
      ws.send(JSON.stringify({ type: 'browser_register', payload: { origin: currentOrigin || '' } }));
    } catch (_e) {
      /* ignore */
    }
  });
  ws.addEventListener('close', () => {
    setWsDot('bad');
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    if (wsCommanderId === selectedCommander) wsReconnectTimer = setTimeout(connectWs, 2500);
  });
  ws.addEventListener('error', () => setWsDot('bad'));
  ws.addEventListener('message', onWsMessage);
}
function onWsMessage(ev) {
  let msg;
  try {
    msg = JSON.parse(ev.data);
  } catch (_e) {
    return;
  }
  if (!msg || !msg.type) return;

  // Browser bridge: a server-side agent asked us to read the live page. Execute
  // and reply with the result (correlated by reqId).
  if (msg.type === 'browser_command' && msg.payload && msg.payload.reqId) {
    handleBrowserCommand(msg.payload);
    return;
  }

  // custom class icons (sent on connect + on change)
  if (msg.type === 'custom_agent_classes_update' && Array.isArray(msg.payload)) {
    customClasses = {};
    for (const c of msg.payload) customClasses[c.id] = c;
    populateAreaFilter(); // area labels/colors come from these classes
    updateAgentDisplay();
    if (!els.agentPop.hidden) renderAgentList(els.agentInput.value);
    return;
  }
  // live agent status/context/activity → drives the working animation + meta row
  if (msg.type === 'agents_update' && Array.isArray(msg.payload)) {
    const byId = new Map(msg.payload.map((a) => [a.id, a]));
    let changed = false;
    for (const a of agentsList) {
      const u = byId.get(a.id);
      if (!u) continue;
      for (const k of ['status', 'lastActivity', 'contextUsed', 'contextLimit']) {
        if (u[k] != null && u[k] !== a[k]) {
          a[k] = u[k];
          changed = true;
        }
      }
    }
    if (changed) {
      updateAgentDisplay();
      if (!els.agentPop.hidden) renderAgentList(els.agentInput.value);
    }
    return;
  }
  if (msg.type === 'agent_updated' && msg.payload && msg.payload.id) {
    const a = agentsList.find((x) => x.id === msg.payload.id);
    if (a && msg.payload.status != null && a.status !== msg.payload.status) {
      a.status = msg.payload.status;
      updateAgentDisplay();
      if (!els.agentPop.hidden) renderAgentList(els.agentInput.value);
    }
    return;
  }
  // live context-compaction state → drives the sweep-bar indicator
  if (msg.type === 'compacting_status' && msg.payload && msg.payload.agentId) {
    if (msg.payload.active) compactingAgents.add(msg.payload.agentId);
    else compactingAgents.delete(msg.payload.agentId);
    updateCompactingIndicator();
    return;
  }

  // Interactive prompt from the agent (AskUserQuestion / ExitPlanMode): the
  // agent is blocked waiting for the user. Mount the answerable card.
  if (msg.type === 'agent_prompt_request' && msg.payload && msg.payload.id) {
    pendingPrompts.set(msg.payload.id, msg.payload);
    if (msg.payload.agentId === selectedAgent) renderPendingPrompts();
    return;
  }
  if (msg.type === 'agent_prompt_resolved' && msg.payload && msg.payload.requestId) {
    resolvePromptCard(msg.payload.requestId);
    return;
  }

  if (msg.type === 'output' && msg.payload && msg.payload.agentId === selectedAgent) {
    const p = msg.payload;
    // Any activity resets the settle timer that swaps the live view for the
    // canonical (markdown-rendered) history.
    if (streamIdleTimer) clearTimeout(streamIdleTimer);
    streamIdleTimer = setTimeout(loadHistory, 1300);

    const stick = atBottom();
    if (isToolChunk(p)) {
      // Render one compact chip per tool start; drop the verbose input/output
      // chunks entirely (they were the "expanded then compacted" noise).
      if (p.toolName) {
        if (!liveTools) {
          liveTools = document.createElement('div');
          // `live` opts the freshly-streamed chips into the pop-in animation; the
          // settle-time history reload renders plain `.msg.tools` rows (no replay).
          liveTools.className = 'msg tools live';
          els.chat.appendChild(liveTools);
        }
        liveTools.insertAdjacentHTML('beforeend', chipHtml(p.toolName, p.toolInput));
        resetLiveProse(); // a following prose chunk starts a fresh bubble (keeps order)
        if (stick) scrollDown();
      }
      return;
    }

    const text = p.text || '';
    if (!text) return;
    liveStick = stick;
    if (!liveProse) {
      liveProse = document.createElement('div');
      liveProse.className = 'msg assistant streaming';
      // Mirror the final history bubble (role + avatar + `.md` body) so the
      // settle-time reload swaps in identical-looking markup — no flicker.
      liveProse.innerHTML = assistantRoleHtml() + '<div class="md body"></div>';
      els.chat.appendChild(liveProse);
      liveTools = null;
      liveProseBuf = '';
    }
    liveProseBuf += text;
    scheduleLiveRender();
    return;
  }
  if (msg.type === 'session_updated' && msg.payload && msg.payload.agentId === selectedAgent) {
    if (streamIdleTimer) clearTimeout(streamIdleTimer);
    streamIdleTimer = setTimeout(loadHistory, 400);
  }
}

// ── browser bridge: execute a relayed read command from a server-side agent ──
async function handleBrowserCommand(payload) {
  const { reqId, cmd } = payload;
  const args = payload.args || {};
  let ok = true;
  let result = null;
  let error = '';
  try {
    result = await execBrowserCommand(cmd, args);
  } catch (e) {
    ok = false;
    error = (e && e.message) || String(e) || 'command failed';
  }
  try {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'browser_result', payload: { reqId, ok, result, error } }));
    }
  } catch (_e) {
    /* socket gone — the server request will time out */
  }
}
// Map a bridge command to the existing capture/inspection plumbing. Reads run in
// the active tab of the user's live session.
async function execBrowserCommand(cmd, args) {
  switch (cmd) {
    case 'page': {
      const t = await activePageInfo();
      return { url: t && t.url, title: t && t.title };
    }
    case 'console': {
      const res = await send({ type: 'getConsole' });
      let recs = (res && res.records) || [];
      if (args.level) recs = recs.filter((r) => String(r.level || '') === String(args.level));
      recs = recs.slice(0, Math.min(Number(args.limit) || 50, 200));
      return recs.map((r) => ({ level: r.level, text: r.text, pageUrl: r.pageUrl, ts: r.ts }));
    }
    case 'network': {
      const res = await send({ type: 'getNetwork' });
      let recs = (res && res.records) || [];
      if (args.filter) {
        const f = String(args.filter).toLowerCase();
        recs = recs.filter((r) => `${r.method} ${r.url} ${r.status}`.toLowerCase().includes(f));
      }
      recs = recs.slice(0, Math.min(Number(args.limit) || 30, 200));
      return recs.map((r) => ({
        method: r.method, url: r.url, status: r.status, statusText: r.statusText,
        contentType: r.contentType, durationMs: r.durationMs, pageUrl: r.pageUrl, ts: r.ts,
      }));
    }
    case 'errors': {
      const st = await send({ type: 'getState' });
      let errs = (st && st.errors) || [];
      errs = errs.slice(0, Math.min(Number(args.limit) || 30, 200));
      return errs.map((e) => ({
        kind: e.kind, subtype: e.subtype, status: e.status, method: e.method, url: e.url,
        message: e.message, count: e.count, pageUrl: e.pageUrl,
      }));
    }
    case 'dom': {
      if (activeTabId == null) throw new Error('no active web page');
      const r = await chrome.tabs.sendMessage(activeTabId, { type: 'getDom', selector: args.selector || '', all: !!args.all });
      if (!r || !r.ok) throw new Error((r && r.error) || 'DOM read failed');
      return args.all ? { nodes: r.nodes } : { node: r.node };
    }
    case 'screenshot': {
      let rect = null;
      if (args.selector && activeTabId != null) {
        try {
          const r = await chrome.tabs.sendMessage(activeTabId, { type: 'getDom', selector: args.selector });
          if (r && r.ok && r.node && r.node.rect) rect = Object.assign({}, r.node.rect, { dpr: r.node.dpr });
        } catch (_e) {
          /* fall back to a full-viewport shot */
        }
      }
      const res = await send({ type: 'bridgeScreenshot', commanderId: selectedCommander, rect, selector: args.selector || 'page' });
      if (!res || !res.ok) throw new Error((res && res.error) || 'screenshot failed');
      return { path: res.path };
    }
    default:
      throw new Error('unknown browser command: ' + cmd);
  }
}

// ── captured errors (the trigger feed, surfaced inside the chat) ──
function errAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return s + 's ago';
  const m = Math.round(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}
// Short, readable label for the page that triggered an error (host + path).
function pageLabel(u) {
  try {
    const url = new URL(u);
    const tail = (url.pathname || '') + (url.search || '');
    return url.host + (tail && tail !== '/' ? tail : '');
  } catch (_e) {
    return u || '(unknown page)';
  }
}
function errRowHtml(e) {
  const code = e.status && e.status > 0 ? `<span class="estatus">${e.status}</span>` : '';
  const label = e.subtype ? `${e.kind}/${e.subtype}` : e.kind;
  let sent = '';
  if (e.lastSendResult) {
    const bad = String(e.lastSendResult).startsWith('error');
    sent = `<span class="esent ${bad ? 'bad' : 'ok'}">${esc(e.lastSendResult)}</span>`;
  }
  return (
    `<div class="erow ${e.muted ? 'muted' : ''}" data-fp="${esc(e.fingerprint)}">` +
    `<div class="erow-top">` +
    `<span class="ebadge ${esc(e.kind)}">${esc(label)}</span>${code}` +
    `<span class="ecount">×${e.count}</span></div>` +
    `<div class="emsg">${esc(e.message)}</div>` +
    `<div class="esub">` +
    (e.method ? `<span>${esc(e.method)}</span>` : '') +
    `<span>${errAgo(e.lastSeen)}</span>${sent}</div>` +
    `<div class="erow-actions">` +
    `<button class="ebtn primary" data-eact="attach">Attach</button>` +
    `<button class="ebtn" data-eact="send">Send now</button>` +
    `<button class="ebtn" data-eact="mute">${e.muted ? 'Unmute' : 'Mute'}</button>` +
    `<button class="ebtn danger" data-eact="delete">Delete</button>` +
    `</div></div>`
  );
}
// One collapsible block per triggering page: a sticky page header + its rows.
function errGroupHtml(pageUrl, items) {
  const active = items.filter((e) => !e.muted).length;
  return (
    `<div class="egroup">` +
    `<div class="egroup-hd" title="${esc(pageUrl || '(unknown page)')}">` +
    `<span class="egroup-page">${esc(pageLabel(pageUrl))}</span>` +
    `<span class="egroup-count${active ? ' has' : ''}">${items.length}</span>` +
    `</div>` +
    items.map(errRowHtml).join('') +
    `</div>`
  );
}
function renderErrors(errors, cfg) {
  const list = errors || [];
  errorRecords = list; // for attach-by-fingerprint
  const active = list.filter((e) => !e.muted).length;
  els.errCount.textContent = String(list.length);
  els.errCount.hidden = list.length === 0;
  els.errCount.classList.toggle('has', active > 0);
  if (list.length === 0) {
    els.errList.innerHTML = '';
    els.errEmpty.hidden = false;
    return;
  }
  els.errEmpty.hidden = true;
  // Group by the page that triggered each error; newest-active group first,
  // newest row first within a group.
  const groups = new Map();
  for (const e of list) {
    const key = e.pageUrl || e.origin || '(unknown page)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const lastSeenOf = (items) => items.reduce((mx, e) => Math.max(mx, e.lastSeen || 0), 0);
  const ordered = Array.from(groups.entries()).sort((a, b) => lastSeenOf(b[1]) - lastSeenOf(a[1]));
  els.errList.innerHTML = ordered
    .map(([page, items]) => errGroupHtml(page, items.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))))
    .join('');
}
async function refreshErrors() {
  const state = await send({ type: 'getState' });
  renderErrors(state.errors || [], state.config);
}

// ── network log (all requests for the active page) ──
// Records arrive from every tab; show only the page the panel is pointed at.
function netForActiveTab() {
  // Match by live tab id OR by origin: origin keeps persisted records visible
  // after a restart/SW recycle, when the old tab ids no longer match.
  return netRecords.filter(
    (r) => (activeTabId != null && r.tabId === activeTabId) || (currentOrigin && r.origin === currentOrigin),
  );
}
function netStatusClass(r) {
  const s = r.status || 0;
  if (s === 0) return 'fail';
  if (s >= 500) return 's5';
  if (s >= 400) return 's4';
  if (s >= 300) return 's3';
  return 's2';
}
function netUrlLabel(u) {
  try {
    const url = new URL(u);
    return url.pathname + (url.search || '');
  } catch (_e) {
    return u || '';
  }
}
function netHost(u) {
  try {
    return new URL(u).host;
  } catch (_e) {
    return '';
  }
}
function headersBlock(h) {
  if (!h || typeof h !== 'object') return '';
  const keys = Object.keys(h);
  if (!keys.length) return '';
  return keys.map((k) => `${esc(k)}: ${esc(String(h[k]))}`).join('\n');
}
function netDetailHtml(r) {
  const sec = (title, body) => (body ? `<div class="nd-h">${esc(title)}</div><pre class="nd-pre">${esc(body)}</pre>` : '');
  return (
    `<div class="net-detail">` +
    `<div class="nd-line">${esc(r.method)} <span class="nd-url" title="${esc(r.url)}">${esc(r.url)}</span></div>` +
    `<div class="nd-line nd-dim">${r.status || 0} ${esc(r.statusText || '')}${
      typeof r.durationMs === 'number' ? ' · ' + r.durationMs + 'ms' : ''
    }${r.contentType ? ' · ' + esc(r.contentType) : ''}</div>` +
    sec('Request headers', headersBlock(r.requestHeaders)) +
    sec('Request body', r.requestBody) +
    sec('Response headers', headersBlock(r.responseHeaders)) +
    sec('Response body', r.responseBody) +
    `<div class="net-actions">` +
    `<button class="nbtn primary" data-nact="send">Attach</button>` +
    `<button class="nbtn" data-nact="copy">Copy</button>` +
    `</div></div>`
  );
}
function netRowHtml(r) {
  const open = netExpanded.has(r.netId);
  return (
    `<div class="nrow ${open ? 'open' : ''}" data-nid="${esc(r.netId)}">` +
    `<div class="nrow-top">` +
    `<span class="nmethod">${esc(r.method)}</span>` +
    `<span class="nstatus ${netStatusClass(r)}">${r.status || 'ERR'}</span>` +
    `<span class="nurl" title="${esc(netHost(r.url) + netUrlLabel(r.url))}">${esc(netUrlLabel(r.url))}</span>` +
    (typeof r.durationMs === 'number' ? `<span class="ndur">${r.durationMs}ms</span>` : '') +
    `</div>` +
    (open ? netDetailHtml(r) : '') +
    `</div>`
  );
}
function renderNetwork() {
  const all = netForActiveTab();
  const f = netFilterText.trim().toLowerCase();
  const items = !f
    ? all
    : all.filter(
        (r) =>
          String(r.url || '').toLowerCase().includes(f) ||
          String(r.method || '').toLowerCase().includes(f) ||
          String(r.status || '').includes(f),
      );
  els.netCount.textContent = String(all.length);
  els.netCount.hidden = all.length === 0;
  els.netCount.classList.toggle('has', all.length > 0);
  if (els.netPop.hidden) return; // body hidden — count only
  if (!items.length) {
    els.netList.innerHTML = '';
    els.netEmpty.hidden = false;
    els.netEmpty.textContent = all.length ? 'No requests match the filter.' : 'No requests captured yet for this page.';
    return;
  }
  els.netEmpty.hidden = true;
  els.netList.innerHTML = items.map(netRowHtml).join('');
}
function scheduleNetRender() {
  if (netRenderScheduled) return;
  netRenderScheduled = true;
  requestAnimationFrame(() => {
    netRenderScheduled = false;
    renderNetwork();
  });
}
async function loadNetwork() {
  const res = await send({ type: 'getNetwork' });
  netRecords = (res && res.records) || [];
  renderNetwork();
}
function netRecordById(id) {
  return netRecords.find((r) => r.netId === id);
}

// ── console log (all console.* output for the active page) ──
function consoleForActiveTab() {
  return consoleRecords.filter(
    (r) => (activeTabId != null && r.tabId === activeTabId) || (currentOrigin && r.origin === currentOrigin),
  );
}
function consoleRecordById(id) {
  return consoleRecords.find((r) => r.conId === id);
}
function conIsPending(id) {
  return pendingConsole.some((x) => x.conId === id);
}
// Context block describing one captured console log (doSend adds the shared "Request:").
function consoleContextBlock(r) {
  return [
    '[Console log captured in the browser]',
    `${String(r.level || 'log').toUpperCase()} ${r.text || ''}`.trim(),
    r.pageUrl ? `Page: ${r.pageUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
function conRowHtml(r) {
  const sel = conIsPending(r.conId);
  const text = String(r.text || '');
  return (
    `<div class="crow lvl-${esc(r.level || 'log')}${sel ? ' sel' : ''}" data-cid="${esc(r.conId)}" title="Click to ${sel ? 'remove' : 'attach'}">` +
    `<span class="clevel">${esc(String(r.level || 'log').toUpperCase())}</span>` +
    `<span class="ctext">${esc(text)}</span>` +
    `<span class="cmark">${sel ? '✓' : '+'}</span>` +
    `</div>`
  );
}
function renderConsole() {
  const all = consoleForActiveTab();
  const f = conFilterText.trim().toLowerCase();
  const items = !f
    ? all
    : all.filter(
        (r) => String(r.text || '').toLowerCase().includes(f) || String(r.level || '').toLowerCase().includes(f),
      );
  els.conCount.textContent = String(all.length);
  els.conCount.hidden = all.length === 0;
  els.conCount.classList.toggle('has', all.length > 0);
  if (els.conPop.hidden) return; // body hidden — count only
  if (!items.length) {
    els.conList.innerHTML = '';
    els.conEmpty.hidden = false;
    els.conEmpty.textContent = all.length ? 'No logs match the filter.' : 'No console logs captured yet for this page.';
    return;
  }
  els.conEmpty.hidden = true;
  els.conList.innerHTML = items.map(conRowHtml).join('');
}
function scheduleConRender() {
  if (conRenderScheduled) return;
  conRenderScheduled = true;
  requestAnimationFrame(() => {
    conRenderScheduled = false;
    renderConsole();
  });
}
async function loadConsole() {
  const res = await send({ type: 'getConsole' });
  consoleRecords = (res && res.records) || [];
  renderConsole();
}
// Toggle a console log in/out of the next message's attachments.
function togglePendingConsole(id) {
  const idx = pendingConsole.findIndex((x) => x.conId === id);
  if (idx >= 0) {
    pendingConsole.splice(idx, 1);
  } else {
    const r = consoleRecordById(id);
    if (!r) return;
    if (pendingConsole.length >= ATTACH_MAX) return;
    pendingConsole.push(r);
  }
  renderPending();
  renderConsole();
  saveCompose();
}

// ── reproduction recorder (record interactions → numbered repro steps) ──
// One recorded step → a human-readable line. The background captures the raw
// action; this turns it into the imperative wording an agent can follow.
function reproStepLine(s) {
  const sel = s.selector || '';
  switch (s.action) {
    case 'click':
      return `Click${s.text ? ` "${s.text}"` : ''}${sel ? ` (${sel})` : ''}`;
    case 'input':
      return `Type "${s.value || ''}" into ${sel || 'the field'}`;
    case 'change':
      return `Set ${sel || 'the field'} to "${s.text || s.value || ''}"`;
    case 'key':
      return `Press ${s.text || 'a key'}${sel ? ` in ${sel}` : ''}`;
    case 'submit':
      return `Submit the form${sel ? ` (${sel})` : ''}`;
    case 'nav':
      return `Navigate to ${s.url || ''}`;
    default:
      return `${s.action}${sel ? ` (${sel})` : ''}`;
  }
}
// Context block describing a whole recorded reproduction (doSend adds the shared
// "Request:" line). Numbered steps + a final screenshot of the end state.
function reproContextBlock(rep) {
  const lines = ['[Reproduction steps recorded in the browser]'];
  if (rep.startUrl) lines.push(`Start: ${rep.startUrl}`);
  (rep.steps || []).forEach((s, i) => lines.push(`${i + 1}. ${reproStepLine(s)}`));
  if (rep.screenshotPath) {
    lines.push('', `Final screenshot: ${rep.screenshotPath}`, 'Use the Read tool on that path to see the end state.');
  }
  return lines.join('\n');
}
// Reflect recording state on the ⏺ badge: pulsing while recording, live step count.
function renderReproBtn() {
  if (!els.reproBtn) return;
  els.reproBtn.classList.toggle('recording', reproRecording);
  els.reproBtn.classList.toggle('open', !els.reproPop.hidden);
  els.reproBtn.title = reproRecording
    ? 'Recording a reproduction — click to view / stop'
    : 'Record a reproduction — clicks, typing & navigation';
  if (els.reproCount) {
    els.reproCount.textContent = String(reproSteps.length);
    els.reproCount.hidden = reproSteps.length === 0;
    els.reproCount.classList.toggle('has', reproSteps.length > 0);
  }
}
// Live list of captured steps inside the popover (rebuilt as steps stream in).
function renderRepro() {
  renderReproBtn();
  if (!els.reproList || els.reproPop.hidden) return;
  if (els.reproTitle) {
    els.reproTitle.textContent = reproRecording ? '⏺ Recording…' : 'Reproduction';
    els.reproTitle.classList.toggle('live', reproRecording);
  }
  if (!reproSteps.length) {
    els.reproList.innerHTML = '';
    els.reproEmpty.hidden = false;
    return;
  }
  els.reproEmpty.hidden = true;
  els.reproList.innerHTML = reproSteps
    .map(
      (s, i) =>
        `<div class="rrow act-${esc(s.action)}"><span class="rnum">${i + 1}</span>` +
        `<span class="rtext">${esc(reproStepLine(s))}</span></div>`,
    )
    .join('');
  els.reproList.scrollTop = els.reproList.scrollHeight; // keep newest in view
}
function openReproPop() {
  els.reproPop.hidden = false;
  els.reproBtn.classList.add('open');
  renderRepro();
}
function closeReproPop() {
  els.reproPop.hidden = true;
  els.reproBtn.classList.remove('open');
}
// Begin recording on the active page (background owns the session).
async function startReproSession() {
  if (!selectedCommander || !selectedAgent) {
    showErr('Pick an agent first.');
    return false;
  }
  const res = await send({ type: 'startRepro' });
  if (!res || !res.ok) {
    showErr('record failed: ' + ((res && res.error) || 'no active page'));
    return false;
  }
  reproRecording = true;
  reproSteps = [];
  reproStartUrl = res.startUrl || currentOrigin || '';
  renderReproBtn();
  return true;
}
// Finish recording. attach=true queues the steps (+ final screenshot) for the
// next message; attach=false throws the recording away.
async function finishReproSession(attach) {
  const res = await send({ type: 'stopRepro' });
  reproRecording = false;
  const steps = (res && Array.isArray(res.steps) && res.steps.length ? res.steps : reproSteps).slice();
  const startUrl = (res && res.startUrl) || reproStartUrl || '';
  closeReproPop();
  reproSteps = [];
  renderReproBtn();
  if (!attach) return;
  if (!steps.length) {
    const note = document.createElement('div');
    note.className = 'hint';
    note.textContent = '⏺ Nothing recorded — interact with the page, then stop.';
    els.chat.appendChild(note);
    scrollDown();
    return;
  }
  let screenshotPath = '';
  if (res && res.screenshot) {
    const saved = await send({ type: 'saveElementShot', commanderId: selectedCommander, image: res.screenshot, selector: 'repro-final' });
    if (saved && saved.ok) screenshotPath = saved.path;
  }
  if (pendingRepros.length < ATTACH_MAX) {
    pendingRepros.push({ steps, screenshotPath, startUrl, count: steps.length });
    renderPending();
    saveCompose();
    if (els.input && !els.input.disabled) els.input.focus();
  }
}
// The ⏺ badge: opening the popover starts a fresh recording; while open it's a
// view of the live steps (explicit Stop/Discard controls live in the popover).
function onReproBtn() {
  if (els.reproPop.hidden) {
    closeToolPops();
    if (!reproRecording) {
      startReproSession().then((ok) => {
        if (ok) openReproPop();
      });
    } else {
      openReproPop();
    }
  } else {
    closeReproPop();
  }
}
// Restore an in-progress recording when the panel (re)opens.
async function loadRepro() {
  const res = await send({ type: 'getRepro' });
  if (res && res.recording) {
    reproRecording = true;
    reproSteps = Array.isArray(res.steps) ? res.steps.slice() : [];
  } else {
    reproRecording = false;
    reproSteps = [];
  }
  renderReproBtn();
}
// Context block describing a captured request + response (no trailing "Request:"
// line — doSend adds ONE shared request line for the whole multi-attach message).
function netContextBlock(r) {
  const lines = [
    '[Network request captured in the browser]',
    `${r.method} ${r.url} → ${r.status || 'ERR'} ${r.statusText || ''}`.trim() +
      (typeof r.durationMs === 'number' ? ` (${r.durationMs}ms)` : ''),
    r.pageUrl ? `Page: ${r.pageUrl}` : '',
  ].filter(Boolean);
  const withHeaders = !config || config.includeNetworkHeaders !== false;
  if (withHeaders) {
    const rh = headersBlock(r.requestHeaders);
    if (rh) lines.push('', 'Request headers:', rh);
  }
  if (r.requestBody) lines.push('', 'Request body:', r.requestBody);
  if (withHeaders) {
    const sh = headersBlock(r.responseHeaders);
    if (sh) lines.push('', 'Response headers:', sh);
  }
  if (r.responseBody) lines.push('', 'Response body:', r.responseBody);
  return lines.join('\n');
}
// Context block describing a captured browser error.
function errorContextBlock(e) {
  const lines = [
    '[Browser error captured]',
    (e.subtype ? `${e.kind}/${e.subtype}` : e.kind || 'error') +
      (e.status ? ` ${e.status}` : '') +
      ` ×${e.count || 1}`,
    e.pageUrl ? `Page: ${e.pageUrl}` : '',
    e.method && e.url ? `${e.method} ${e.url}` : e.url ? `URL: ${e.url}` : '',
    e.message ? `Message: ${e.message}` : '',
  ].filter(Boolean);
  if (e.requestBody) lines.push('', 'Request body:', e.requestBody);
  if (e.responseBody) lines.push('', 'Response body:', e.responseBody);
  if (e.stack) lines.push('', 'Stack:', e.stack);
  return lines.join('\n');
}

// ── multi-attach: queue items for the next message (all removable in the tray) ──
function addPendingNet(id) {
  const r = netRecordById(id);
  if (!r) return false;
  if (pendingNets.some((x) => x.netId === r.netId)) return true; // already queued
  if (pendingNets.length >= ATTACH_MAX) return false;
  pendingNets.push(r);
  renderPending();
  saveCompose();
  els.input.focus();
  return true;
}
function addPendingError(fp) {
  const e = errorRecords.find((x) => x.fingerprint === fp);
  if (!e) return false;
  if (pendingErrors.some((x) => x.fingerprint === fp)) return true;
  if (pendingErrors.length >= ATTACH_MAX) return false;
  pendingErrors.push(e);
  renderPending();
  saveCompose();
  els.input.focus();
  return true;
}
function setPendingElement(context, image, mode) {
  if (pendingElements.length >= ATTACH_MAX) return;
  pendingElements.push({ context, image, mode: mode || 'pick' });
  renderPending();
  saveCompose();
  els.input.focus();
}
function clearAllPending() {
  pendingElements = [];
  pendingFiles = [];
  pendingNets = [];
  pendingErrors = [];
  pendingConsole = [];
  pendingRepros = [];
  renderPending();
  saveCompose();
}

// ── resize the composer/input (drag or scroll the handle) ──
// Growing the input shrinks the chat (which is flex:1) and vice-versa, so the
// one handle effectively resizes the chat. Height persists across sessions.
const INPUT_H_KEY = 'tc_input_h';
function clampInputHeight(h) {
  const max = Math.max(80, Math.round(window.innerHeight * 0.6));
  return Math.max(40, Math.min(max, Math.round(h)));
}
function setInputHeight(h, persist) {
  const v = clampInputHeight(h);
  els.input.style.height = v + 'px';
  if (persist) {
    try {
      chrome.storage.local.set({ [INPUT_H_KEY]: v });
    } catch (_e) {
      /* ignore */
    }
  }
}
async function loadInputHeight() {
  try {
    const r = await chrome.storage.local.get([INPUT_H_KEY]);
    if (r && r[INPUT_H_KEY]) setInputHeight(r[INPUT_H_KEY], false);
  } catch (_e) {
    /* keep default rows */
  }
}

// ── per-agent compose state (draft text + queued attachments) ──
// Persisted PER AGENT (keyed commanderId::agentId) under tc_drafts, so switching
// agents — or closing/reopening the panel — restores exactly what you were
// composing for THAT agent: the draft text AND every queued element / screenshot
// / network request / error / file. Debounced; the write captures the key + a
// snapshot at call time so a quick agent switch can't misfile it.
const DRAFTS_KEY = 'tc_drafts';
let composeTimer = null;
let loadingCompose = false; // true while applyCompose mutates the UI (suppresses saves)
function composeKey() {
  return selectedCommander && selectedAgent ? selectedCommander + '::' + selectedAgent : '';
}
function composeSnapshot() {
  return {
    text: els.input.value || '',
    elements: pendingElements.slice(),
    files: pendingFiles.slice(),
    nets: pendingNets.slice(),
    errors: pendingErrors.slice(),
    console: pendingConsole.slice(),
    repros: pendingRepros.slice(),
  };
}
function composeEmpty(s) {
  return (
    !s.text &&
    !s.elements.length &&
    !s.files.length &&
    !s.nets.length &&
    !s.errors.length &&
    !(s.console && s.console.length) &&
    !(s.repros && s.repros.length)
  );
}
async function writeCompose(key, snap) {
  try {
    const r = await chrome.storage.local.get([DRAFTS_KEY]);
    const map = (r && r[DRAFTS_KEY]) || {};
    if (composeEmpty(snap)) delete map[key];
    else map[key] = snap;
    await chrome.storage.local.set({ [DRAFTS_KEY]: map });
  } catch (_e) {
    /* ignore (e.g. storage quota) */
  }
}
function saveCompose() {
  if (loadingCompose) return;
  const key = composeKey();
  if (!key) return;
  const snap = composeSnapshot();
  if (composeTimer) clearTimeout(composeTimer);
  composeTimer = setTimeout(() => writeCompose(key, snap), 300);
}
// Persist immediately (before switching away from an agent), bypassing the debounce.
function flushCompose() {
  if (loadingCompose) return;
  const key = composeKey();
  if (!key) return;
  if (composeTimer) {
    clearTimeout(composeTimer);
    composeTimer = null;
  }
  writeCompose(key, composeSnapshot());
}
// Restore the selected agent's compose state into the UI, replacing whatever's
// queued. Guarded so the writes done here don't loop back into saveCompose.
async function loadCompose() {
  loadingCompose = true;
  let entry = null;
  try {
    const key = composeKey();
    if (key) {
      const r = await chrome.storage.local.get([DRAFTS_KEY]);
      entry = (r && r[DRAFTS_KEY] && r[DRAFTS_KEY][key]) || null;
    }
  } catch (_e) {
    /* ignore */
  }
  els.input.value = entry && entry.text ? entry.text : '';
  pendingElements = entry && Array.isArray(entry.elements) ? entry.elements : [];
  pendingFiles = entry && Array.isArray(entry.files) ? entry.files : [];
  pendingNets = entry && Array.isArray(entry.nets) ? entry.nets : [];
  pendingErrors = entry && Array.isArray(entry.errors) ? entry.errors : [];
  pendingConsole = entry && Array.isArray(entry.console) ? entry.console : [];
  pendingRepros = entry && Array.isArray(entry.repros) ? entry.repros : [];
  renderPending();
  loadingCompose = false;
}
// Drop the stored compose for the current agent (after a successful send).
async function clearComposeStore() {
  if (composeTimer) {
    clearTimeout(composeTimer);
    composeTimer = null;
  }
  const key = composeKey();
  if (!key) return;
  try {
    const r = await chrome.storage.local.get([DRAFTS_KEY]);
    const map = (r && r[DRAFTS_KEY]) || {};
    if (map[key]) {
      delete map[key];
      await chrome.storage.local.set({ [DRAFTS_KEY]: map });
    }
  } catch (_e) {
    /* ignore */
  }
}
function initResizeHandle() {
  const h = els.resizeHandle;
  if (!h) return;
  // Scroll over the handle: wheel up grows the input, wheel down shrinks it.
  // Also bound to the composer footer below for a much larger scroll target.
  const onWheel = (e) => {
    e.preventDefault();
    setInputHeight(els.input.offsetHeight - e.deltaY * 0.5, true);
  };
  const composer = els.input.parentElement;
  if (composer) {
    composer.addEventListener(
      'wheel',
      (e) => {
        // Resize on scroll anywhere in the footer — including over the textarea,
        // unless the textarea actually has overflowing content to scroll itself.
        if (e.target === els.input && els.input.scrollHeight > els.input.clientHeight + 1) return;
        onWheel(e);
      },
      { passive: false },
    );
  }
  h.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      setInputHeight(els.input.offsetHeight - e.deltaY * 0.4, true);
    },
    { passive: false },
  );
  // Drag the handle: up grows the input, down shrinks it.
  //  - move/up listeners live on `window` (not the handle, not document) so they
  //    fire for every pointer move inside the panel — handle-only listeners never
  //    saw moves once the cursor left the 14px strip.
  //  - setPointerCapture is best-effort on top, to also catch strays outside the
  //    panel viewport. Capture still bubbles to window, so they don\'t conflict.
  //  - a `dragging` guard de-dupes pointerdown+mousedown (both fire for a mouse),
  //    and the mouse pair is a fallback for builds where pointer events misbehave.
  let dragging = false;
  const startDrag = (e) => {
    if (dragging) return;
    if (e.button != null && e.button !== 0) return; // primary button only
    dragging = true;
    e.preventDefault();
    const startY = e.clientY;
    const startH = els.input.offsetHeight;
    h.classList.add('dragging');
    if (e.pointerId != null) {
      try {
        h.setPointerCapture(e.pointerId);
      } catch (_e) {
        /* ignore */
      }
    }
    const onMove = (ev) => setInputHeight(startH + (startY - ev.clientY), false);
    const onUp = () => {
      dragging = false;
      h.classList.remove('dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setInputHeight(els.input.offsetHeight, true); // persist final height
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  h.addEventListener('pointerdown', startDrag);
  h.addEventListener('mousedown', startDrag); // fallback; `dragging` guard de-dupes
}

// ── lightbox (click a thumbnail to view it full-size) ──
function openLightbox(src) {
  if (!src) return;
  els.lightboxImg.src = src;
  els.lightbox.hidden = false;
}
function closeLightbox() {
  els.lightbox.hidden = true;
  els.lightboxImg.removeAttribute('src');
}

// ── file attachments (images + documents) ──
// Tiny emoji icon for a non-image attachment, by extension / mime.
function fileIcon(name, type) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (type === 'application/pdf' || ext === 'pdf') return '📕';
  if (['md', 'txt', 'rtf'].includes(ext)) return '📝';
  if (['csv', 'xlsx', 'xls'].includes(ext)) return '📊';
  if (['json', 'xml', 'yaml', 'yml', 'html', 'js', 'ts', 'css'].includes(ext)) return '🧾';
  if (['zip', 'tar', 'gz', 'rar'].includes(ext)) return '🗜️';
  return '📄';
}
// Unified tray: a chip for every queued item (elements, screenshots, network
// requests, errors, files). Each chip's ✕ carries data-pk (kind) + data-i
// (index within that kind) so the click handler can splice the right array.
function renderPending() {
  const chips = [];
  const x = (pk, i) => `<button class="att-x" data-pk="${pk}" data-i="${i}" title="Remove">✕</button>`;
  pendingElements.forEach((p, i) => {
    const name = p.context.selector || p.context.tag || 'element';
    if (p.mode === 'shot' && p.image) {
      chips.push(
        `<span class="att att-shot" title="${esc('📷 ' + name)}">` +
          `<img src="${esc(p.image)}" alt="" /><span class="att-badge">📷</span>${x('el', i)}</span>`,
      );
    } else {
      chips.push(
        `<span class="att att-doc att-el" title="${esc((p.mode === 'shot' ? '📷 ' : '<' + p.context.tag + '> ') + name)}">` +
          `<span class="att-doc-ic">${p.mode === 'shot' ? '📷' : '🧩'}</span>` +
          `<span class="att-doc-name">${esc(name)}</span>${x('el', i)}</span>`,
      );
    }
  });
  pendingNets.forEach((r, i) => {
    chips.push(
      `<span class="att att-doc att-net" title="${esc(r.method + ' ' + r.url)}">` +
        `<span class="att-doc-ic">🌐</span>` +
        `<span class="att-doc-name">${esc(r.method + ' ' + netUrlLabel(r.url))}</span>${x('net', i)}</span>`,
    );
  });
  pendingErrors.forEach((e, i) => {
    const label = (e.subtype ? e.kind + '/' + e.subtype : e.kind || 'error') + (e.status ? ' ' + e.status : '');
    chips.push(
      `<span class="att att-doc att-err" title="${esc(label + ' — ' + (e.message || ''))}">` +
        `<span class="att-doc-ic">⚠️</span>` +
        `<span class="att-doc-name">${esc(label)}</span>${x('err', i)}</span>`,
    );
  });
  pendingConsole.forEach((c, i) => {
    const label = String(c.level || 'log').toUpperCase() + ' ' + String(c.text || '');
    chips.push(
      `<span class="att att-doc att-con" title="${esc(label)}">` +
        `<span class="att-doc-ic">📋</span>` +
        `<span class="att-doc-name">${esc(label.slice(0, 60))}</span>${x('con', i)}</span>`,
    );
  });
  pendingRepros.forEach((rep, i) => {
    const n = rep.count || (rep.steps ? rep.steps.length : 0);
    const label = `🔴 ${n} repro step${n === 1 ? '' : 's'}${rep.screenshotPath ? ' + screenshot' : ''}`;
    chips.push(
      `<span class="att att-doc att-repro" title="${esc(label)}">` +
        `<span class="att-doc-ic">🔴</span>` +
        `<span class="att-doc-name">${esc(n + ' repro step' + (n === 1 ? '' : 's'))}</span>${x('repro', i)}</span>`,
    );
  });
  pendingFiles.forEach((f, i) => {
    if (f.isImage) {
      chips.push(`<span class="att" title="${esc(f.name || 'image')}"><img src="${esc(f.dataUrl)}" alt="" />${x('file', i)}</span>`);
    } else {
      chips.push(
        `<span class="att att-doc" title="${esc(f.name || 'file')}">` +
          `<span class="att-doc-ic">${fileIcon(f.name, f.type)}</span>` +
          `<span class="att-doc-name">${esc(f.name || 'file')}</span>${x('file', i)}</span>`,
      );
    }
  });
  els.attachments.hidden = chips.length === 0;
  els.attachments.innerHTML = chips.join('');
}
// Remove one queued item by kind + index (from the tray's ✕ buttons).
function removePending(pk, i) {
  const arr =
    pk === 'el' ? pendingElements
    : pk === 'net' ? pendingNets
    : pk === 'err' ? pendingErrors
    : pk === 'con' ? pendingConsole
    : pk === 'repro' ? pendingRepros
    : pendingFiles;
  if (i >= 0 && i < arr.length) arr.splice(i, 1);
  renderPending();
  if (pk === 'con' && !els.conPop.hidden) renderConsole(); // refresh the ✓/+ state
  saveCompose();
}
function addAttachment(dataUrl, name, type) {
  if (!dataUrl || pendingFiles.length >= ATTACH_MAX) return;
  pendingFiles.push({ dataUrl, name: name || 'file', type: type || '', isImage: String(type || '').startsWith('image/') });
  renderPending();
  saveCompose();
}
function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(file);
  });
}
async function addFiles(files) {
  for (const f of files) {
    const url = await readFileAsDataUrl(f);
    if (url) addAttachment(url, f.name, f.type);
  }
}
// Replace each <svg>…</svg> with a compact placeholder that keeps the icon's
// identity (data-icon / aria-label / class) but drops the bulky path geometry.
function stripSvg(html) {
  return String(html || '').replace(/<svg\b([^>]*)>[\s\S]*?<\/svg>/gi, (_m, attrs) => {
    const pick = (re) => {
      const m = re.exec(attrs);
      return m ? m[1] : '';
    };
    const icon = pick(/\bdata-icon="([^"]*)"/i);
    const label = pick(/\baria-label="([^"]*)"/i);
    const tag = icon || label || 'icon';
    return `<svg data-icon="${tag}">…</svg>`;
  });
}
function formatElementContext(ctx) {
  // Computed styles are bulky; omit them when the "🎨 styles" toggle is off.
  const withStyles = !config || config.includeComputedStyles !== false;
  const styles = withStyles
    ? Object.entries(ctx.styles || {})
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n')
    : '';
  // Strip <svg> markup when the "✂️ svg" toggle is on (default) — icon path data
  // is long, low-signal noise that bloats the picked-element HTML. Cap length
  // AFTER stripping so the budget holds real markup, not discarded svg paths.
  const hideSvg = !config || config.hideSvg !== false;
  const html = (hideSvg ? stripSvg(ctx.outerHTML) : ctx.outerHTML || '').slice(0, 4000);
  return [
    '[UI element the user selected on the page]',
    `Page: ${ctx.pageUrl}`,
    `Selector: ${ctx.selector}`,
    `Tag: <${ctx.tag}>${ctx.id ? ` id="${ctx.id}"` : ''}${ctx.classes && ctx.classes.length ? ` class="${ctx.classes.join(' ')}"` : ''}`,
    `Box: x=${ctx.rect.x} y=${ctx.rect.y} w=${ctx.rect.w} h=${ctx.rect.h}`,
    ctx.text ? `Text: ${ctx.text}` : '',
    styles ? 'Computed styles:\n' + styles : '',
    'outerHTML:',
    '```html',
    html,
    '```',
  ]
    .filter(Boolean)
    .join('\n');
}

async function pickElement(mode) {
  pickMode = mode || 'pick';
  if (activeTabId == null) return;
  try {
    await chrome.tabs.sendMessage(activeTabId, { type: 'startPicker' }, { frameId: 0 });
  } catch (_e) {
    showErr('Cannot pick on this page (try a normal web page).');
  }
}

// ── send ──
async function activePageInfo() {
  try {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    return t ? { url: t.url, title: t.title } : null;
  } catch (_e) {
    return null;
  }
}

async function doSend() {
  const text = els.input.value.trim();
  const hasAny =
    pendingElements.length ||
    pendingFiles.length ||
    pendingNets.length ||
    pendingErrors.length ||
    pendingConsole.length ||
    pendingRepros.length;
  if (!text && !hasAny) return;
  if (!selectedCommander || !selectedAgent) {
    showErr('Pick a commander and agent first.');
    return;
  }

  const blocks = []; // context blocks (each without its own request line)
  let elCount = 0;
  let shotCount = 0;

  // Picked elements + screenshots, in the order they were queued.
  for (const p of pendingElements) {
    if (p.mode === 'shot') {
      shotCount++;
      let note;
      if (p.image) {
        const saved = await send({
          type: 'saveElementShot',
          commanderId: selectedCommander,
          image: p.image,
          selector: p.context.selector,
        });
        note =
          saved && saved.ok
            ? `Saved screenshot: ${saved.path}\nUse the Read tool on that path to view the element.`
            : `(screenshot could not be saved: ${(saved && saved.error) || 'unknown'})`;
      } else {
        note = '(no image captured — the element may have been off-screen)';
      }
      blocks.push(
        ['[Screenshot of a UI element the user selected]', `Page: ${p.context.pageUrl}`, `Selector: ${p.context.selector}`, note].join(
          '\n',
        ),
      );
    } else {
      elCount++;
      blocks.push(formatElementContext(p.context));
    }
  }
  // Network requests + console logs + errors + recorded reproductions.
  for (const r of pendingNets) blocks.push(netContextBlock(r));
  for (const c of pendingConsole) blocks.push(consoleContextBlock(c));
  for (const e of pendingErrors) blocks.push(errorContextBlock(e));
  for (const rep of pendingRepros) blocks.push(reproContextBlock(rep));

  // Files: save each to disk, reference by path.
  const files = pendingFiles.slice();
  if (files.length) {
    const saved = [];
    for (const f of files) {
      const r = await send({ type: 'saveAttachment', commanderId: selectedCommander, dataUrl: f.dataUrl, filename: f.name });
      if (r && r.ok) saved.push({ path: r.path, name: f.name, isImage: f.isImage });
    }
    if (saved.length) {
      blocks.push(
        '[Attached file' + (saved.length > 1 ? 's' : '') + ']\n' +
          saved.map((s) => `- ${s.name}: ${s.path}`).join('\n') +
          '\nUse the Read tool on ' + (saved.length > 1 ? 'these paths' : 'that path') + ' to view.',
      );
    }
  }

  // Assemble: all context blocks, then ONE shared request line — but only when
  // the user actually typed something. With an empty input we send the bare
  // context (no placeholder "Request:" line).
  let message = blocks.length
    ? blocks.join('\n\n') + (text ? '\n\nRequest: ' + text : '')
    : text;

  if (els.pgctx.checked) {
    const pi = await activePageInfo();
    if (pi && pi.url) message = `[Current page: ${pi.title || ''} — ${pi.url}]\n\n` + message;
  }

  // Compact label for the user's turn in the chat.
  let userLabel = text;
  if (!userLabel) {
    const parts = [];
    if (elCount) parts.push('🧩 ' + elCount + ' element' + (elCount > 1 ? 's' : ''));
    if (shotCount) parts.push('📷 ' + shotCount + ' screenshot' + (shotCount > 1 ? 's' : ''));
    if (pendingNets.length) parts.push('🌐 ' + pendingNets.length + ' request' + (pendingNets.length > 1 ? 's' : ''));
    if (pendingConsole.length) parts.push('📋 ' + pendingConsole.length + ' log' + (pendingConsole.length > 1 ? 's' : ''));
    if (pendingErrors.length) parts.push('⚠️ ' + pendingErrors.length + ' error' + (pendingErrors.length > 1 ? 's' : ''));
    if (pendingRepros.length) {
      const reproSteps2 = pendingRepros.reduce((n, r) => n + (r.count || (r.steps ? r.steps.length : 0)), 0);
      parts.push('🔴 ' + reproSteps2 + ' repro step' + (reproSteps2 === 1 ? '' : 's'));
    }
    if (files.length) parts.push('📎 ' + files.length + ' file' + (files.length > 1 ? 's' : ''));
    userLabel = parts.join(' · ') || '(attachment)';
  }

  els.input.value = '';
  addMessage('user', userLabel, null, null, new Date().toISOString());
  scrollDown();
  loadingCompose = true; // clearing the tray here must not re-save the (now-sent) compose
  clearAllPending();
  loadingCompose = false;
  clearComposeStore();

  const res = await send({ type: 'sendChat', commanderId: selectedCommander, agentId: selectedAgent, message });
  if (!res || !res.ok) showErr(res && res.error ? 'send failed: ' + res.error : 'send failed');
}

// Interrupt the selected agent's current run (the Stop button / Esc). No-op
// unless the agent is actually working; the WS status update hides the bar.
async function doStop() {
  if (!selectedCommander || !selectedAgent) return;
  if (!isWorking(selectedAgentObj())) return;
  els.workingStop.disabled = true;
  els.workingStop.textContent = 'Stopping…';
  const res = await send({ type: 'stopAgent', commanderId: selectedCommander, agentId: selectedAgent });
  els.workingStop.disabled = false;
  els.workingStop.textContent = '■ Stop';
  if (!res || !res.ok) showErr(res && res.error ? 'stop failed: ' + res.error : 'stop failed');
}

// ── clear context (archive session + reset, like the commander's 🧹) ──
// The commander clears over the WebSocket ({type:'clear_context'}), not HTTP, so
// we reuse the panel's live `ws`. Guarded by a two-click confirm (matches the
// commander's "click again to confirm" — no modal).
function wsSend(obj) {
  if (ws && ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch (_e) {
      return false;
    }
  }
  return false;
}
let clearArmed = false;
let clearConfirmTimer = null;
// There are two clear-context buttons (header + bottom tools); keep them in sync.
function eachClearBtn(fn) {
  document.querySelectorAll('.clear-ctx').forEach(fn);
}
function resetClearBtn() {
  if (clearConfirmTimer) {
    clearTimeout(clearConfirmTimer);
    clearConfirmTimer = null;
  }
  clearArmed = false;
  eachClearBtn((b) => {
    b.classList.remove('confirm');
    b.textContent = '🧹';
    b.title = 'Clear context — archives the session & starts fresh';
  });
}
function armOrClearContext() {
  if (!selectedCommander || !selectedAgent) return;
  if (clearArmed) {
    resetClearBtn();
    doClearContext();
    return;
  }
  clearArmed = true;
  eachClearBtn((b) => {
    b.classList.add('confirm');
    b.textContent = '⚠';
    b.title = 'Click again to confirm — clears this conversation';
  });
  clearConfirmTimer = setTimeout(resetClearBtn, 3000);
}
// Compact (Claude Code's /compact): summarise + shrink the agent's context
// without losing the session. Routed through the dedicated collapse-context
// endpoint (a plain message can't carry the slash command).
async function doCompactContext() {
  if (!selectedCommander || !selectedAgent) return;
  if (els.compact) els.compact.disabled = true;
  const res = await send({ type: 'collapseContext', commanderId: selectedCommander, agentId: selectedAgent });
  if (els.compact) els.compact.disabled = false;
  if (!res || !res.ok) {
    showErr('compact failed: ' + ((res && res.error) || 'unknown'));
    return;
  }
  const a = selectedAgentObj();
  const name = (a && a.name) || 'agent';
  const note = document.createElement('div');
  note.className = 'hint';
  note.textContent = res.status === 'queued'
    ? `🗜️ /compact queued — runs when ${name} goes idle`
    : `🗜️ /compact sent — ${name} is compacting its context…`;
  els.chat.appendChild(note);
  scrollDown();
}
function doClearContext() {
  if (!wsSend({ type: 'clear_context', payload: { agentId: selectedAgent } })) {
    showErr('clear failed: not connected — try again in a moment');
    return;
  }
  // The server archives the old session, resets context, and broadcasts the
  // update. Reflect it immediately: empty the chat + zero the local context meta.
  resetLiveProse();
  liveTools = null;
  els.chat.innerHTML = '<div class="hint">Context cleared — a new session starts on your next message. The old one is archived.</div>';
  const a = selectedAgentObj();
  if (a) {
    a.contextUsed = 0;
    a.status = 'idle';
    updateAgentDisplay();
  }
}

// ── buildings cockpit (services / links / docker / terminals) ──
// Buildings belong to the commander, not the selected agent. The overlay is
// opened on demand from the header so it never crowds the chat.
const BLD_ICON = {
  server: '🖥️', link: '🔗', database: '🗄️', docker: '🐳',
  monitor: '📊', folder: '📁', boss: '👑', terminal: '💻',
};
const BLD_CONTROLLABLE = new Set(['server', 'docker', 'terminal']);
// running → green; starting/stopping → pulsing; error → red; else dim.
function bldStatusClass(s) {
  s = String(s || '').toLowerCase();
  if (s === 'running') return 'run';
  if (s === 'starting' || s === 'stopping') return 'busy';
  if (s === 'error') return 'err';
  return 'stop';
}
// Trailing folder name of a raw path (project label for a building's cwd).
function areaFromPath(p) {
  const key = String(p || '').replace(/[\\/]+$/, '');
  if (!key) return '';
  const parts = key.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || key;
}
// Buildings run on the same host as the commander API; detected ports open there.
function commanderHost() {
  const c = currentCommander();
  if (!c) return 'localhost';
  try {
    return new URL(c.baseUrl).hostname || 'localhost';
  } catch (_e) {
    return 'localhost';
  }
}
// All browser-openable links: custom urls (as-is) + detected ports (→ host:port)
// + the ttyd terminal url. Ports are de-duped across pm2/docker.
function bldLinks(b) {
  const out = [];
  for (const u of b.urls || []) out.push({ label: u.label || netHost(u.url) || u.url, url: u.url });
  const host = commanderHost();
  const seen = new Set();
  for (const p of (b.pm2Ports || []).concat(b.dockerPorts || [])) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push({ label: ':' + p, url: `http://${host}:${p}` });
  }
  if (b.terminalUrl) out.push({ label: '💻 terminal', url: b.terminalUrl });
  return out;
}
function bldRowHtml(b) {
  const icon = BLD_ICON[b.type] || '•';
  const running = String(b.status || '').toLowerCase() === 'running';
  const links = bldLinks(b)
    .map(
      (l) =>
        `<a class="bld-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}">${esc(l.label)} ↗</a>`,
    )
    .join('');
  let ctrl = '';
  if (BLD_CONTROLLABLE.has(b.type)) {
    ctrl = running
      ? `<button class="bld-btn" data-bact="restart" title="Restart">⟳</button>` +
        `<button class="bld-btn danger" data-bact="stop" title="Stop">■</button>`
      : `<button class="bld-btn ok" data-bact="start" title="Start">▶</button>`;
  }
  const cwd = b.cwd ? `<span class="bld-cwd" title="${esc(b.cwd)}">${esc(areaFromPath(b.cwd))}</span>` : '';
  return (
    `<div class="bld-row" data-bid="${esc(b.id)}">` +
    `<div class="bld-row-top">` +
    `<span class="bld-dot ${bldStatusClass(b.status)}" title="${esc(b.status || 'unknown')}"></span>` +
    `<span class="bld-ic">${esc(icon)}</span>` +
    `<span class="bld-name" title="${esc(b.name)}">${esc(b.name)}</span>` +
    cwd +
    `<span class="bld-ctrl">${ctrl}</span>` +
    `</div>` +
    (links ? `<div class="bld-links">${links}</div>` : '') +
    (b.lastError ? `<div class="bld-err" title="${esc(b.lastError)}">${esc(b.lastError)}</div>` : '') +
    `</div>`
  );
}
function renderBuildings() {
  if (bldLoading) {
    els.bldList.innerHTML = '<div class="chat-loading"><span class="cl-spin"></span><span>Loading buildings…</span></div>';
    els.bldEmpty.hidden = true;
    return;
  }
  const f = bldFilterText.trim().toLowerCase();
  const items = !f
    ? buildingsList
    : buildingsList.filter(
        (b) =>
          String(b.name || '').toLowerCase().includes(f) ||
          String(b.type || '').toLowerCase().includes(f) ||
          String(b.cwd || '').toLowerCase().includes(f) ||
          (b.urls || []).some((u) => String(u.url || '').toLowerCase().includes(f)),
      );
  if (!items.length) {
    els.bldList.innerHTML = '';
    els.bldEmpty.hidden = false;
    els.bldEmpty.textContent = buildingsList.length ? 'No buildings match.' : 'No buildings.';
    return;
  }
  els.bldEmpty.hidden = true;
  els.bldList.innerHTML = items.map(bldRowHtml).join('');
}
function showBldMsg(text) {
  if (!els.bldMsg) return;
  els.bldMsg.textContent = text;
  els.bldMsg.hidden = !text;
}
async function loadBuildings() {
  if (!selectedCommander) return;
  showBldMsg('');
  bldLoading = true;
  renderBuildings();
  const res = await send({ type: 'fetchBuildings', commanderId: selectedCommander });
  bldLoading = false;
  if (!res || !res.ok) {
    buildingsList = [];
    els.bldList.innerHTML = '';
    els.bldEmpty.hidden = false;
    els.bldEmpty.textContent = res && res.error ? 'Error: ' + res.error : 'Failed to load buildings.';
    return;
  }
  // Running first, then A–Z — the things you'd act on float to the top.
  buildingsList = (res.buildings || []).slice().sort((a, b) => {
    const ra = String(a.status || '').toLowerCase() === 'running' ? 0 : 1;
    const rb = String(b.status || '').toLowerCase() === 'running' ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  });
  renderBuildings();
}
function openBuildings() {
  if (!els.buildingsOverlay) return;
  els.buildingsOverlay.hidden = false;
  els.bldSearch.value = bldFilterText;
  loadBuildings();
  setTimeout(() => els.bldSearch.focus(), 0);
}
function closeBuildings() {
  if (els.buildingsOverlay) els.buildingsOverlay.hidden = true;
}
async function doBuildingCommand(buildingId, command, btn) {
  if (!selectedCommander || !buildingId) return;
  const prev = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '…';
  }
  showBldMsg('');
  const res = await send({ type: 'buildingCommand', commanderId: selectedCommander, buildingId, command });
  if (!res || !res.ok) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prev;
    }
    showBldMsg((res && res.error ? res.error : command + ' failed'));
    return;
  }
  await loadBuildings(); // reflect the new status
}

// ── events ──
els.commander.addEventListener('change', async () => {
  flushCompose(); // persist the outgoing agent's draft before changing commander
  selectedCommander = els.commander.value;
  await loadAgents();
});
els.agentInput.addEventListener('focus', () => {
  if (!agentsList.length) return;
  els.agentInput.select();
  openAgentCombo(true);
});
els.agentInput.addEventListener('input', () => {
  openAgentCombo(false);
  renderAgentList(els.agentInput.value);
  updateAgentAreaTag();
  activeIdx = -1;
});
els.agentInput.addEventListener('keydown', (e) => {
  const items = comboItems();
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (els.agentPop.hidden) openAgentCombo(true);
    highlight(Math.min(items.length - 1, activeIdx + 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlight(Math.max(0, activeIdx - 1));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const el = items[activeIdx] || items[0];
    if (el) selectAgent(el.dataset.id);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeAgentCombo();
    updateAgentDisplay();
    els.agentInput.blur();
  }
});
els.agentInput.addEventListener('blur', () => {
  // Close after the click settles; restore the label if a filter was typed but
  // nothing selected. (mousedown-preventDefault on the popup keeps item clicks
  // alive.) Stay open while focus is on the in-popup tools (area filter / sort).
  setTimeout(() => {
    if (els.agentCombo.contains(document.activeElement)) return;
    closeAgentCombo();
    updateAgentDisplay();
  }, 120);
});
// Keep the input focused when clicking list items, but let the native <select>
// and sort button in the tools row receive real clicks.
els.agentPop.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.combo-tools')) e.preventDefault();
});
els.agentList.addEventListener('click', (e) => {
  const pinBtn = e.target.closest('[data-pin]');
  if (pinBtn) {
    e.stopPropagation();
    togglePin(pinBtn.dataset.pin);
    return;
  }
  const item = e.target.closest('.combo-item');
  if (item) selectAgent(item.dataset.id);
});
// pinned-agent thumbnail bar: click a thumbnail to select; click its × to unpin
els.pinbar.addEventListener('click', (e) => {
  const btn = e.target.closest('.pin');
  if (!btn) return;
  if (e.target.closest('[data-unpin]')) togglePin(btn.dataset.id);
  else selectAgent(btn.dataset.id);
});
// The pinbar only overflows horizontally, but a normal mouse wheel scrolls
// vertically — translate vertical wheel into horizontal scroll so the wheel
// always pans the pins. Native horizontal trackpad swipes (deltaX) pass through.
els.pinbar.addEventListener(
  'wheel',
  (e) => {
    if (els.pinbar.scrollWidth <= els.pinbar.clientWidth) return; // nothing to scroll
    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (!delta) return;
    els.pinbar.scrollLeft += delta;
    e.preventDefault();
  },
  { passive: false },
);
// ── drag-to-reorder pinned agents ──
// Native HTML5 DnD: the dragged pin is moved through the DOM live (so you see
// the new order), and on drop we read the DOM order back into `pinnedIds` and
// persist it. A plain click (no drag) still selects, since DnD only fires once
// the pointer actually moves.
function pinAfterElement(x) {
  const others = Array.from(els.pinbar.querySelectorAll('.pin:not(.dragging)'));
  let best = { offset: Number.NEGATIVE_INFINITY, el: null };
  for (const child of others) {
    const box = child.getBoundingClientRect();
    const offset = x - (box.left + box.width / 2);
    if (offset < 0 && offset > best.offset) best = { offset, el: child };
  }
  return best.el;
}
els.pinbar.addEventListener('dragstart', (e) => {
  const pin = e.target.closest('.pin');
  if (!pin) return;
  pinDragging = true;
  pin.classList.add('dragging');
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', pin.dataset.id || ''); // Firefox needs data
  }
});
els.pinbar.addEventListener('dragover', (e) => {
  if (!pinDragging) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  const dragging = els.pinbar.querySelector('.pin.dragging');
  if (!dragging) return;
  const after = pinAfterElement(e.clientX);
  if (after == null) els.pinbar.appendChild(dragging);
  else els.pinbar.insertBefore(dragging, after);
});
els.pinbar.addEventListener('drop', (e) => {
  if (pinDragging) e.preventDefault();
});
els.pinbar.addEventListener('dragend', () => {
  const dragging = els.pinbar.querySelector('.pin.dragging');
  if (dragging) dragging.classList.remove('dragging');
  pinDragging = false;
  // Read the new DOM order back into pinnedIds (keep ids no longer rendered).
  const domOrder = Array.from(els.pinbar.querySelectorAll('.pin'))
    .map((el) => el.dataset.id)
    .filter(Boolean);
  const extras = pinnedIds.filter((id) => !domOrder.includes(id));
  pinnedIds = domOrder.concat(extras);
  savePins();
  renderPinBar(); // re-render clean (restores sel/working classes & order)
});
// Mouse back/forward buttons → previous / next agent. MouseEvent.button: 3 = back
// (X1), 4 = forward (X2). We act on mouseup and suppress the default panel
// navigation on every related event so the side panel never tries to go back.
function suppressNavButtons(e) {
  if (e.button === 3 || e.button === 4) e.preventDefault();
}
window.addEventListener('mousedown', suppressNavButtons);
window.addEventListener('auxclick', suppressNavButtons);
window.addEventListener('mouseup', (e) => {
  if (e.button === 3) {
    e.preventDefault();
    goAgentBack(); // back → previously visited agent
  } else if (e.button === 4) {
    e.preventDefault();
    goAgentForward(); // forward → re-visit a backed-out-of agent
  }
});
els.agentArea.addEventListener('input', () => {
  agentAreaFilter = els.agentArea.value.trim().toLowerCase();
  renderAgentList(effectiveAgentFilter());
  activeIdx = -1;
});
els.agentSort.addEventListener('click', () => {
  agentSortMode = agentSortMode === 'active' ? 'name' : 'active';
  els.agentSort.textContent = sortLabel();
  renderAgentList(effectiveAgentFilter());
  activeIdx = -1;
});
// Close the popup when clicking anywhere outside the combo (covers the case
// where focus is parked on the area <select> rather than the input).
document.addEventListener('pointerdown', (e) => {
  if (!els.agentPop.hidden && !els.agentCombo.contains(e.target)) {
    closeAgentCombo();
    updateAgentDisplay();
  }
});
els.refresh.addEventListener('click', () => loadHistory({ spinner: true }));
// Infinite scroll: near the top, pull the next older page into the window.
els.chat.addEventListener('scroll', () => {
  if (els.chat.scrollTop < 48 && historyHasMore && !loadingMore) loadMoreHistory();
});
eachClearBtn((b) => b.addEventListener('click', armOrClearContext));
if (els.compact) els.compact.addEventListener('click', doCompactContext);
els.pick.addEventListener('click', () => pickElement('pick'));
els.shot.addEventListener('click', () => pickElement('shot'));
els.pgctx.addEventListener('change', () => send({ type: 'setConfig', patch: { includePageContext: els.pgctx.checked } }));
els.incstyles.addEventListener('change', () => {
  if (config) config.includeComputedStyles = els.incstyles.checked;
  send({ type: 'setConfig', patch: { includeComputedStyles: els.incstyles.checked } });
});
els.incheaders.addEventListener('change', () => {
  if (config) config.includeNetworkHeaders = els.incheaders.checked;
  send({ type: 'setConfig', patch: { includeNetworkHeaders: els.incheaders.checked } });
});
els.hidesvg.addEventListener('change', () => {
  if (config) config.hideSvg = els.hidesvg.checked;
  send({ type: 'setConfig', patch: { hideSvg: els.hidesvg.checked } });
});

// lightbox: click backdrop or Esc to close (tray image chips open it — see the
// attachments click handler below)
els.lightbox.addEventListener('click', closeLightbox);
// Attachment thumbnails inside rendered chat cards open the lightbox popup.
els.chat.addEventListener('click', (e) => {
  const img = e.target.closest('.tc-att-img');
  if (img && img.src) openLightbox(img.src);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.lightbox.hidden) {
    e.preventDefault();
    closeLightbox();
  } else if (e.key === 'Escape' && els.buildingsOverlay && !els.buildingsOverlay.hidden) {
    e.preventDefault();
    closeBuildings();
  }
});

// buildings cockpit: open from header 🏢, search, refresh, per-row start/stop/restart
els.openBuildings.addEventListener('click', openBuildings);
els.bldClose.addEventListener('click', closeBuildings);
els.bldRefresh.addEventListener('click', loadBuildings);
els.bldSearch.addEventListener('input', () => {
  bldFilterText = els.bldSearch.value;
  renderBuildings();
});
els.bldList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-bact]');
  if (!btn) return;
  const row = btn.closest('.bld-row');
  const id = row && row.dataset.bid;
  if (id) doBuildingCommand(id, btn.dataset.bact, btn);
});

// ── errors / network badge popovers ──
// Each badge in the actions bar opens its popover (the lists live there now,
// not in top accordions). Only one popover is open at a time.
function closeToolPops() {
  els.errPop.hidden = true;
  els.netPop.hidden = true;
  els.conPop.hidden = true;
  els.errBtn.classList.remove('open');
  els.netBtn.classList.remove('open');
  els.conBtn.classList.remove('open');
  // Hide the repro popover too (one popover at a time) — but DON'T stop an
  // in-progress recording; the ⏺ badge keeps pulsing and reopens the live list.
  if (els.reproPop) els.reproPop.hidden = true;
  if (els.reproBtn) els.reproBtn.classList.remove('open');
}
els.errBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = els.errPop.hidden;
  closeToolPops();
  if (willOpen) {
    els.errPop.hidden = false;
    els.errBtn.classList.add('open');
    refreshErrors();
  }
});
els.netBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = els.netPop.hidden;
  closeToolPops();
  if (willOpen) {
    els.netPop.hidden = false;
    els.netBtn.classList.add('open');
    loadNetwork();
  }
});
els.conBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = els.conPop.hidden;
  closeToolPops();
  if (willOpen) {
    els.conPop.hidden = false;
    els.conBtn.classList.add('open');
    loadConsole();
  }
});
// ⏺ record badge: open = start a fresh recording + show live steps; click again to
// hide. Explicit Stop & attach / Discard controls live inside the popover.
els.reproBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  onReproBtn();
});
els.reproStop.addEventListener('click', (e) => {
  e.stopPropagation();
  finishReproSession(true);
});
els.reproDiscard.addEventListener('click', (e) => {
  e.stopPropagation();
  finishReproSession(false);
});
// Pointerdown (not click) outside either popover closes them. Pointerdown fires
// BEFORE a row-expand click rebuilds the list — so e.target is still attached and
// its `closest()` check is reliable. (On click, the rebuild detaches the node and
// closest() wrongly reports "outside", which closed the popover on every expand.)
document.addEventListener('pointerdown', (e) => {
  if (els.errPop.hidden && els.netPop.hidden && els.conPop.hidden && els.reproPop.hidden) return;
  if (e.target.closest('#err-pop, #net-pop, #con-pop, #repro-pop, #err-btn, #net-btn, #con-btn, #repro-btn')) return;
  closeToolPops();
});
els.errClear.addEventListener('click', async () => {
  await send({ type: 'clearErrors' });
  refreshErrors();
});
els.errList.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-eact]');
  if (!btn) return;
  const row = btn.closest('.erow');
  const fp = row && row.dataset.fp;
  if (!fp) return;
  const act = btn.dataset.eact;
  if (act === 'attach') {
    addPendingError(fp); // queue for the next message
    btn.textContent = 'Attached ✓';
    setTimeout(() => (btn.textContent = 'Attach'), 1200);
    return;
  }
  if (act === 'delete') {
    await send({ type: 'deleteError', fingerprint: fp });
  } else if (act === 'mute') {
    await send({ type: 'muteError', fingerprint: fp, muted: !row.classList.contains('muted') });
  } else if (act === 'send') {
    btn.textContent = 'Sending…';
    btn.disabled = true;
    await send({ type: 'sendNow', fingerprint: fp });
  }
  refreshErrors();
});
els.netFilter.addEventListener('input', () => {
  netFilterText = els.netFilter.value;
  renderNetwork();
});
els.netClear.addEventListener('click', async () => {
  await send({ type: 'clearNetwork' });
  netRecords = [];
  netExpanded.clear();
  renderNetwork();
});
els.netList.addEventListener('click', async (ev) => {
  const actBtn = ev.target.closest('button[data-nact]');
  const row = ev.target.closest('.nrow');
  const id = row && row.dataset.nid;
  if (!id) return;
  if (actBtn) {
    ev.stopPropagation();
    if (actBtn.dataset.nact === 'send') {
      addPendingNet(id); // queue for the next message (popover stays open for more)
      actBtn.textContent = 'Attached ✓';
      setTimeout(() => (actBtn.textContent = 'Attach'), 1200);
    } else if (actBtn.dataset.nact === 'copy') {
      const r = netRecordById(id);
      if (r) {
        try {
          await navigator.clipboard.writeText(netContextBlock(r));
          actBtn.textContent = 'Copied';
          setTimeout(() => (actBtn.textContent = 'Copy'), 1200);
        } catch (_e) {
          /* clipboard blocked */
        }
      }
    }
    return;
  }
  // toggle row expansion
  if (netExpanded.has(id)) netExpanded.delete(id);
  else netExpanded.add(id);
  renderNetwork();
});
els.conFilter.addEventListener('input', () => {
  conFilterText = els.conFilter.value;
  renderConsole();
});
els.conClear.addEventListener('click', async () => {
  await send({ type: 'clearConsole' });
  consoleRecords = [];
  renderConsole();
});
// Click a console row to (de)select it for the next message (multi-attach).
els.conList.addEventListener('click', (ev) => {
  const row = ev.target.closest('.crow');
  const id = row && row.dataset.cid;
  if (id) togglePendingConsole(id);
});
// live-refresh the feed when the background mutates the error store / config
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.tc_errors || changes.tc_config) refreshErrors();
  if (changes.tc_config) {
    // a commander was added/edited in Settings -> refresh the selector so every
    // configured commander (not just the active one) is immediately selectable
    send({ type: 'getState' }).then((state) => {
      config = state.config;
      const prev = selectedCommander || els.commander.value;
      els.commander.innerHTML = '';
      for (const c of config.commanders || []) {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.name || c.baseUrl;
        els.commander.appendChild(o);
      }
      if (prev && (config.commanders || []).some((c) => c.id === prev)) els.commander.value = prev;
      renderPinBar(); // re-apply compact threshold after a Settings change
    });
  }
});

// image attachments: button, file picker, paste, drag-drop, remove
els.attach.addEventListener('click', () => els.fileInput.click());
els.pinToggle.addEventListener('click', () => {
  if (selectedAgent) togglePin(selectedAgent);
});
els.fileInput.addEventListener('change', async () => {
  await addFiles(Array.from(els.fileInput.files || []));
  els.fileInput.value = '';
});
els.attachments.addEventListener('click', (e) => {
  const x = e.target.closest('.att-x');
  if (x) {
    removePending(x.dataset.pk, Number(x.dataset.i));
    return;
  }
  // click an image chip (not its ✕) to view it full-size
  const img = e.target.closest('.att img');
  if (img) openLightbox(img.src);
});
els.input.addEventListener('paste', async (e) => {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  const files = [];
  for (const it of items) {
    if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) {
    e.preventDefault();
    await addFiles(files);
  }
});
els.input.addEventListener('dragover', (e) => e.preventDefault());
els.input.addEventListener('drop', async (e) => {
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
    e.preventDefault();
    await addFiles(Array.from(e.dataTransfer.files));
  }
});
els.sendBtn.addEventListener('click', doSend);
els.workingStop.addEventListener('click', doStop);
els.input.addEventListener('input', saveCompose);
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    doSend();
  } else if (e.key === 'Escape' && isWorking(selectedAgentObj())) {
    // Esc interrupts the running agent (matches Claude's interrupt key).
    e.preventDefault();
    doStop();
  }
});
$('theme-toggle').addEventListener('click', toggleTheme);
$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('font-dec').addEventListener('click', () => stepFontScale(-FONT_STEP));
$('font-inc').addEventListener('click', () => stepFontScale(FONT_STEP));
// Right-click either stepper to snap back to 100%.
$('font-dec').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  applyFontScale(FONT_DEFAULT, true);
});
$('font-inc').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  applyFontScale(FONT_DEFAULT, true);
});
$('close-panel').addEventListener('click', () => window.close());

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'elementContext' && msg.context) {
    setPendingElement(msg.context, msg.image, pickMode);
    pickMode = 'pick'; // reset so the next context-menu pick is plain
  } else if (msg && msg.type === 'tc-net-record' && msg.record) {
    // Live request pushed by the background hub — prepend, cap, re-render.
    netRecords.unshift(msg.record);
    if (netRecords.length > 300) netRecords.length = 300;
    scheduleNetRender();
  } else if (msg && msg.type === 'tc-console-record' && msg.record) {
    consoleRecords.unshift(msg.record);
    if (consoleRecords.length > 300) consoleRecords.length = 300;
    scheduleConRender();
  } else if (msg && msg.type === 'tc-repro-record' && msg.step) {
    // Live repro step pushed by the background hub while recording — append in order.
    if (reproRecording) {
      reproSteps.push(msg.step);
      if (reproSteps.length > 300) reproSteps.shift();
      renderRepro();
    }
  }
});

let tabSwitchTimer = null;
function scheduleResolve() {
  if (tabSwitchTimer) clearTimeout(tabSwitchTimer);
  tabSwitchTimer = setTimeout(() => {
    Promise.resolve(resolveForActiveTab()).then(() => {
      renderNetwork();
      renderConsole();
    });
  }, 250);
}
chrome.tabs.onActivated.addListener(scheduleResolve);
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === activeTabId && (info.status === 'complete' || info.url)) scheduleResolve();
});

(async function init() {
  initResizeHandle(); // first: pure DOM, must attach even if a later await rejects
  await loadTheme();
  await loadFontScale();
  await loadInputHeight();
  await loadConfig(); // per-agent compose is restored later by loadAgents → loadCompose
  await resolveForActiveTab();
  await refreshErrors();
  await loadNetwork();
  await loadConsole();
  await loadRepro(); // resume an in-progress recording if the panel reopened mid-record
})();
