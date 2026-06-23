/**
 * background.js — MV3 service worker / hub.
 *
 *  - Receives + dedupes captured errors into a local store. Delivery to an agent
 *    is always user-initiated from the side panel (the "Send" button); there is
 *    no automatic page→agent path.
 *  - Multi-commander: holds a list of TC servers ({id,name,baseUrl,token}); each
 *    origin can be routed to a specific commander + agent (else the active one).
 *  - Proxies chat send / history / agent-list for the side panel (keeps tokens
 *    in one place).
 *  - Element picker: crops a thumbnail and forwards picked-element context to the
 *    side panel; registers the right-click context menus.
 */

const DEFAULT_CONFIG = {
  commanders: [], // [{ id, name, baseUrl, token }]
  activeCommanderId: '',
  defaultAgentId: '',
  originMap: {}, // origin -> { commanderId, agentId }
  enabled: true,
  captureScreenshots: true,
  includePageContext: false, // prepend current page URL/title to chat messages
  includeComputedStyles: true, // include a picked element's computed CSS when sending it
  includeNetworkHeaders: true, // include request/response headers when sending a network request
  hideSvg: true, // strip <svg> markup from a picked element's outerHTML (icon paths are noise)
  pinThumbnailThreshold: 5, // pinned-agent bar collapses to thumbnail-only past this many pins (0 = always)
  allowlist: ['http://localhost:*', 'http://127.0.0.1:*'],
  redact: true,
  redactKeys: ['authorization', 'cookie', 'token', 'password', 'secret', 'apikey', 'api_key'],
  captureNetwork: true,
  captureJs: true,
  captureConsole: true,
  captureResource: false,
  captureNetworkLog: true, // record ALL requests (not just errors) for the Network tab
  bridgeEnabled: true, // allow server-side agents to read/drive the live page via /api/browser/*
};

const MAX_ERRORS = 200;
const MAX_NETLOG = 250;

// Ring buffer of recent requests (newest first). Persisted to chrome.storage so
// it survives panel close, service-worker recycle and browser restart; seeded
// back into memory on startup. Writes are debounced to avoid thrashing storage
// under request bursts.
let netLog = [];
const netLogReady = (async () => {
  try {
    const { tc_netlog } = await chrome.storage.local.get('tc_netlog');
    if (Array.isArray(tc_netlog)) netLog = tc_netlog.slice(0, MAX_NETLOG);
  } catch (_e) {
    /* ignore */
  }
})();
let netPersistTimer = null;
function persistNetLog() {
  if (netPersistTimer) return; // coalesce bursts into one write per tick
  netPersistTimer = setTimeout(() => {
    netPersistTimer = null;
    try {
      chrome.storage.local.set({ tc_netlog: netLog });
    } catch (_e) {
      /* ignore */
    }
  }, 600);
}

// Ring buffer of recent console.* output (newest first), same persistence scheme
// as netLog — feeds the Console tab.
const MAX_CONSOLE = 300;
let consoleLog = [];
const consoleLogReady = (async () => {
  try {
    const { tc_console } = await chrome.storage.local.get('tc_console');
    if (Array.isArray(tc_console)) consoleLog = tc_console.slice(0, MAX_CONSOLE);
  } catch (_e) {
    /* ignore */
  }
})();
let consolePersistTimer = null;
function persistConsoleLog() {
  if (consolePersistTimer) return;
  consolePersistTimer = setTimeout(() => {
    consolePersistTimer = null;
    try {
      chrome.storage.local.set({ tc_console: consoleLog });
    } catch (_e) {
      /* ignore */
    }
  }, 600);
}

// ── reproduction recorder session ──
// A single in-progress recording: which tab is being recorded and the ordered
// steps captured so far. Persisted (debounced) so it survives a service-worker
// recycle mid-recording; the content script re-attaches on each page via the
// reproHello handshake below.
const MAX_REPRO_STEPS = 300;
let repro = { recording: false, tabId: null, windowId: null, startUrl: '', steps: [] };
const reproReady = (async () => {
  try {
    const { tc_repro } = await chrome.storage.local.get('tc_repro');
    if (tc_repro && typeof tc_repro === 'object') {
      repro.recording = !!tc_repro.recording;
      repro.tabId = tc_repro.tabId == null ? null : tc_repro.tabId;
      repro.windowId = tc_repro.windowId == null ? null : tc_repro.windowId;
      repro.startUrl = tc_repro.startUrl || '';
      repro.steps = Array.isArray(tc_repro.steps) ? tc_repro.steps.slice(0, MAX_REPRO_STEPS) : [];
    }
  } catch (_e) {
    /* ignore */
  }
})();
let reproPersistTimer = null;
function persistRepro() {
  if (reproPersistTimer) return;
  reproPersistTimer = setTimeout(() => {
    reproPersistTimer = null;
    try {
      chrome.storage.local.set({ tc_repro: repro });
    } catch (_e) {
      /* ignore */
    }
  }, 500);
}
// Flush the session state immediately (bypass the step-burst debounce) — used when
// the `recording` flag flips, since content scripts read it from storage on load.
function persistReproNow() {
  if (reproPersistTimer) {
    clearTimeout(reproPersistTimer);
    reproPersistTimer = null;
  }
  try {
    chrome.storage.local.set({ tc_repro: repro });
  } catch (_e) {
    /* ignore */
  }
}

// ── config (with migration from the v0.1 flat schema) ──
function normalizeConfig(stored) {
  const cfg = { ...DEFAULT_CONFIG, ...(stored || {}) };
  if (!Array.isArray(cfg.commanders)) cfg.commanders = [];
  if (cfg.commanders.length === 0) {
    if (stored && stored.endpoint) {
      cfg.commanders = [{ id: 'cmd_legacy', name: 'Local', baseUrl: stored.endpoint, token: stored.token || '' }];
      cfg.activeCommanderId = 'cmd_legacy';
      if (stored.agentId) cfg.defaultAgentId = stored.agentId;
    } else {
      cfg.commanders = [{ id: 'cmd_local', name: 'Local', baseUrl: 'http://localhost:5174', token: 'abcd' }];
      cfg.activeCommanderId = 'cmd_local';
    }
  }
  if (!cfg.activeCommanderId || !cfg.commanders.find((c) => c.id === cfg.activeCommanderId)) {
    cfg.activeCommanderId = cfg.commanders[0] ? cfg.commanders[0].id : '';
  }
  if (!cfg.originMap || typeof cfg.originMap !== 'object') cfg.originMap = {};
  return cfg;
}
async function getConfig() {
  const { tc_config } = await chrome.storage.local.get('tc_config');
  return normalizeConfig(tc_config);
}
async function setConfig(patch) {
  const next = { ...(await getConfig()), ...patch };
  await chrome.storage.local.set({ tc_config: next });
  return next;
}

// ── errors store ──
async function getErrors() {
  const { tc_errors } = await chrome.storage.local.get('tc_errors');
  return tc_errors || {};
}
async function saveErrors(errors) {
  let map = errors;
  const entries = Object.values(map);
  if (entries.length > MAX_ERRORS) {
    entries.sort((a, b) => b.lastSeen - a.lastSeen);
    map = {};
    for (const e of entries.slice(0, MAX_ERRORS)) map[e.fingerprint] = e;
  }
  await chrome.storage.local.set({ tc_errors: map });
  return map;
}

let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.then(() => undefined, () => undefined);
  return run;
}

// ── target resolution (which commander + agent for an origin) ──
function resolveTarget(cfg, origin) {
  let commander;
  let agentId;
  const map = origin && cfg.originMap[origin];
  if (map && map.commanderId && cfg.commanders.find((c) => c.id === map.commanderId)) {
    commander = cfg.commanders.find((c) => c.id === map.commanderId);
    agentId = map.agentId || cfg.defaultAgentId || '';
  } else {
    commander = cfg.commanders.find((c) => c.id === cfg.activeCommanderId) || cfg.commanders[0];
    agentId = cfg.defaultAgentId || '';
  }
  if (!commander) return null;
  return {
    commanderId: commander.id,
    name: commander.name,
    baseUrl: (commander.baseUrl || '').replace(/\/+$/, ''),
    token: commander.token || '',
    agentId,
  };
}

// ── network helpers (all TC calls funnel through here) ──
function apiFetch(baseUrl, token, pathAndQuery, init) {
  const url = baseUrl.replace(/\/+$/, '') + pathAndQuery;
  const headers = { ...(init && init.headers), 'X-Auth-Token': token || '' };
  return fetch(url, { ...init, headers });
}
function commanderById(cfg, id) {
  return cfg.commanders.find((c) => c.id === id) || cfg.commanders.find((c) => c.id === cfg.activeCommanderId);
}
async function fetchAgents(commanderId) {
  const cfg = await getConfig();
  const c = commanderById(cfg, commanderId);
  if (!c) return { ok: false, error: 'no commander', agents: [] };
  try {
    const r = await apiFetch(c.baseUrl, c.token, '/api/agents');
    if (!r.ok) return { ok: false, error: 'HTTP ' + r.status, agents: [] };
    const list = await r.json();
    return {
      ok: true,
      agents: list.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        model: a.model,
        isBoss: a.isBoss,
        class: a.class,
        cwd: a.cwd,
        lastActivity: a.lastActivity,
        contextUsed: a.contextUsed,
        contextLimit: a.contextLimit,
      })),
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), agents: [] };
  }
}
async function sendChat(commanderId, agentId, message) {
  const cfg = await getConfig();
  const c = commanderById(cfg, commanderId);
  if (!c) return { ok: false, error: 'no commander' };
  if (!agentId) return { ok: false, error: 'no agent selected' };
  try {
    const r = await apiFetch(c.baseUrl, c.token, `/api/agents/${encodeURIComponent(agentId)}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j.error || 'HTTP ' + r.status };
    return { ok: true, result: j };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
// Answer an interactive agent prompt (AskUserQuestion / ExitPlanMode). Routes
// through here so the POST carries the commander's X-Auth-Token; the server
// resolves the MCP-side HTTP wait and the agent gets the decision as the tool
// result. Mirrors store.respondToAgentPrompt in the React client.
async function respondPrompt(commanderId, requestId, approved, answers, reason) {
  const cfg = await getConfig();
  const c = commanderById(cfg, commanderId);
  if (!c) return { ok: false, error: 'no commander' };
  if (!requestId) return { ok: false, error: 'no request id' };
  try {
    const r = await apiFetch(c.baseUrl, c.token, `/api/agent-prompt/${encodeURIComponent(requestId)}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, answers, reason }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j.error || 'HTTP ' + r.status };
    return { ok: true, result: j };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
// Stop / interrupt the agent's current execution. The server exposes a bulk
// endpoint; we pass the single selected agent. Same X-Auth-Token as /message.
async function stopAgent(commanderId, agentId) {
  const cfg = await getConfig();
  const c = commanderById(cfg, commanderId);
  if (!c) return { ok: false, error: 'no commander' };
  if (!agentId) return { ok: false, error: 'no agent selected' };
  try {
    const r = await apiFetch(c.baseUrl, c.token, '/api/agents/bulk/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentIds: [agentId] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j.error || 'HTTP ' + r.status };
    return { ok: true, result: j };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
// Send Claude Code's /compact slash command to the agent's runner. Plain
// /message can't carry slash commands, so this hits the dedicated endpoint.
// waitForIdle:true → if the agent is busy, the /compact is queued and fires the
// next time it goes idle (so the button always "takes").
async function collapseContext(commanderId, agentId) {
  const cfg = await getConfig();
  const c = commanderById(cfg, commanderId);
  if (!c) return { ok: false, error: 'no commander' };
  if (!agentId) return { ok: false, error: 'no agent selected' };
  try {
    const r = await apiFetch(c.baseUrl, c.token, `/api/agents/${encodeURIComponent(agentId)}/collapse-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waitForIdle: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j.error || 'HTTP ' + r.status, status: j.status };
    return { ok: true, status: j.status };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
// List all buildings for a commander (global, not per-agent): servers with
// start/stop/restart, docker containers, terminals, and quick links. We slim the
// payload down to what the overlay renders (status + ports + urls + ttyd url).
async function fetchBuildings(commanderId) {
  const cfg = await getConfig();
  const c = commanderById(cfg, commanderId);
  if (!c) return { ok: false, error: 'no commander', buildings: [] };
  try {
    const r = await apiFetch(c.baseUrl, c.token, '/api/buildings');
    if (!r.ok) return { ok: false, error: 'HTTP ' + r.status, buildings: [] };
    const j = await r.json();
    const list = Array.isArray(j) ? j : j.buildings || [];
    return {
      ok: true,
      buildings: list.map((b) => ({
        id: b.id,
        name: b.name,
        type: b.type,
        status: b.status,
        cwd: b.cwd,
        urls: Array.isArray(b.urls) ? b.urls.filter((u) => u && u.url) : [],
        pm2Ports: b.pm2Status && Array.isArray(b.pm2Status.ports) ? b.pm2Status.ports : [],
        dockerPorts:
          b.dockerStatus && Array.isArray(b.dockerStatus.ports)
            ? b.dockerStatus.ports.map((p) => p && p.host).filter(Boolean)
            : [],
        terminalUrl: b.terminalStatus && b.terminalStatus.url ? b.terminalStatus.url : '',
        folderPath: b.folderPath,
        lastError: b.lastError,
      })),
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), buildings: [] };
  }
}
// Start / stop / restart a building. Same X-Auth-Token; the server returns
// { success, error?, logs? }.
async function buildingCommand(commanderId, buildingId, command) {
  const cfg = await getConfig();
  const c = commanderById(cfg, commanderId);
  if (!c) return { ok: false, error: 'no commander' };
  if (!buildingId) return { ok: false, error: 'no building' };
  try {
    const r = await apiFetch(c.baseUrl, c.token, `/api/buildings/${encodeURIComponent(buildingId)}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j.error || 'HTTP ' + r.status };
    return { ok: j.success !== false, result: j, error: j.error };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
async function getHistory(commanderId, agentId, limit) {
  const cfg = await getConfig();
  const c = commanderById(cfg, commanderId);
  if (!c || !agentId) return { ok: false, error: 'missing commander/agent', messages: [] };
  try {
    const r = await apiFetch(c.baseUrl, c.token, `/api/agents/${encodeURIComponent(agentId)}/history?limit=${limit || 60}&offset=0`);
    if (!r.ok) return { ok: false, error: 'HTTP ' + r.status, messages: [] };
    const j = await r.json();
    return { ok: true, messages: j.messages || [], cwd: j.cwd, sessionId: j.sessionId, hasMore: !!j.hasMore, totalCount: j.totalCount };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), messages: [] };
  }
}
async function saveElementShot(commanderId, image, selector) {
  const cfg = await getConfig();
  const c = commanderById(cfg, commanderId);
  if (!c) return { ok: false, error: 'no commander' };
  if (!image) return { ok: false, error: 'no image' };
  try {
    const r = await apiFetch(c.baseUrl, c.token, '/api/triggers/element-screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, selector }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j.error || 'HTTP ' + r.status };
    return { ok: true, path: j.path };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
// Save an arbitrary attached document (any mime) so the agent can Read it.
async function saveAttachment(commanderId, dataUrl, filename) {
  const cfg = await getConfig();
  const c = commanderById(cfg, commanderId);
  if (!c) return { ok: false, error: 'no commander' };
  if (!dataUrl) return { ok: false, error: 'no file' };
  try {
    const r = await apiFetch(c.baseUrl, c.token, '/api/triggers/attachment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, filename }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j.error || 'HTTP ' + r.status };
    return { ok: true, path: j.path };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// ── allowlist / redaction / fingerprint (capture pipeline) ──
function patternMatch(pat, origin, pageUrl) {
  if (!pat) return false;
  if (pat === '*' || pat === '<all_urls>') return true;
  const rx = new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return rx.test(origin) || rx.test(pageUrl);
}
function originAllowed(allowlist, pageUrl) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return false;
  let origin = '';
  try {
    origin = new URL(pageUrl).origin;
  } catch (_e) {
    return false;
  }
  return allowlist.some((p) => patternMatch(String(p).trim(), origin, pageUrl));
}
function redact(text, cfg) {
  if (!cfg.redact || !text) return text;
  let t = String(text);
  t = t.replace(/(bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[REDACTED]');
  t = t.replace(/eyJ[A-Za-z0-9._-]{10,}/g, '[REDACTED_JWT]');
  for (const k of cfg.redactKeys || []) {
    const esc = String(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp('(' + esc + '["\']?\\s*[:=]\\s*["\']?)([^&"\'\\s]+)', 'gi'), '$1[REDACTED]');
  }
  return t;
}
function normalizeUrl(u) {
  if (!u) return '';
  try {
    const url = new URL(u, 'http://_');
    const p = url.pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/{uuid}')
      .replace(/\/[0-9a-f]{16,}/gi, '/{hex}')
      .replace(/\/\d+/g, '/{n}');
    return (url.host || '') + p;
  } catch (_e) {
    return String(u).split('?')[0].replace(/\d+/g, '{n}');
  }
}
function normalizeMsg(m) {
  if (!m) return '';
  return String(m)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{uuid}')
    .replace(/0x[0-9a-f]+/gi, '{hex}')
    .replace(/\b\d+\b/g, '{n}')
    .replace(/(["']).*?\1/g, '{str}')
    .slice(0, 300);
}
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return 'fp_' + h.toString(36);
}
function fingerprintOf(p) {
  return hash([p.kind, p.subtype || '', p.status || '', normalizeUrl(p.url || p.pageUrl || ''), normalizeMsg(p.message || '')].join('|'));
}
function typeEnabled(cfg, kind) {
  if (kind === 'network') return cfg.captureNetwork !== false;
  if (kind === 'console') return cfg.captureConsole !== false;
  if (kind === 'js') return cfg.captureJs !== false;
  if (kind === 'resource') return cfg.captureResource === true;
  return true;
}

// ── screenshots ──
async function captureVisible(tabId, windowId) {
  try {
    if (tabId == null || windowId == null) return null;
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.active) return null;
    return (await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })) || null;
  } catch (_e) {
    return null;
  }
}
async function blobToDataUrl(blob) {
  const buf = await blob.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:' + (blob.type || 'image/png') + ';base64,' + btoa(bin);
}
async function cropScreenshot(dataUrl, rect, dpr) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const sx = Math.max(0, rect.x * dpr);
    const sy = Math.max(0, rect.y * dpr);
    const sw = Math.min(bmp.width - sx, rect.w * dpr);
    const sh = Math.min(bmp.height - sy, rect.h * dpr);
    if (sw <= 1 || sh <= 1) return null;
    const canvas = new OffscreenCanvas(Math.round(sw), Math.round(sh));
    canvas.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
    if (bmp.close) bmp.close();
    return await blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
  } catch (_e) {
    return null;
  }
}

// The active tab's live location, included with a captured error only when the
// "📍 page" (includePageContext) setting is on — mirrors the chat's behavior.
function currentLocation(cfg, tab) {
  if (!cfg.includePageContext || !tab || !tab.url) return null;
  return { url: tab.url, title: tab.title || '' };
}

// ── deliver a captured error to its commander ──
async function sendErrorToServer(target, rec, screenshot, current) {
  const body = {
    fingerprint: rec.fingerprint,
    kind: rec.kind,
    subtype: rec.subtype,
    status: rec.status,
    method: rec.method,
    url: rec.url,
    pageUrl: rec.pageUrl,
    origin: rec.origin,
    message: rec.message,
    stack: rec.stack,
    requestBody: rec.requestBody,
    responseBody: rec.responseBody,
    userAgent: rec.userAgent,
    occurrenceCount: rec.count,
    firstSeen: rec.firstSeen,
    lastSeen: rec.lastSeen,
    agentId: target.agentId || undefined,
    screenshot: screenshot || undefined,
    currentUrl: current && current.url ? current.url : undefined,
    currentTitle: current && current.title ? current.title : undefined,
  };
  try {
    const r = await apiFetch(target.baseUrl, target.token, '/api/triggers/browser-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return 'error: ' + (j.error || r.status);
    if (j.deduped) return 'deduped';
    return 'delivered' + (j.agentName ? ' → ' + j.agentName : '');
  } catch (e) {
    return 'error: ' + ((e && e.message) || e);
  }
}

async function updateBadge() {
  const errors = await getErrors();
  const n = Object.values(errors).filter((e) => !e.muted).length;
  try {
    await chrome.action.setBadgeText({ text: n ? (n > 99 ? '99+' : String(n)) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#e2483d' });
  } catch (_e) {
    /* ignore */
  }
}

async function handleError(payload, sender) {
  const cfg = await getConfig();
  if (!cfg.enabled) return;
  if (!typeEnabled(cfg, payload.kind)) return;
  // Security: attribute the record to the BROWSER-supplied frame URL (sender.url),
  // never the page-supplied payload.pageUrl. A malicious page can forge pageUrl to
  // spoof its origin past the allowlist; sender.url is set by Chrome and cannot be
  // forged from page script. Drop anything we can't tie to a real frame.
  const frameUrl = (sender && sender.url) || '';
  if (!originAllowed(cfg.allowlist, frameUrl)) return;

  const now = payload.ts || Date.now();
  let origin = '';
  try {
    origin = new URL(frameUrl).origin;
  } catch (_e) {
    /* ignore */
  }
  const tabId = sender && sender.tab ? sender.tab.id : undefined;
  const clean = {
    kind: payload.kind,
    subtype: payload.subtype || '',
    status: payload.status || 0,
    method: payload.method || '',
    url: redact(payload.url || '', cfg),
    pageUrl: frameUrl,
    origin,
    tabId,
    message: redact(payload.message || '', cfg),
    stack: redact(payload.stack || '', cfg),
    userAgent: payload.ua || '',
    requestBody: payload.requestBody ? redact(payload.requestBody, cfg) : undefined,
    responseBody: payload.responseBody ? redact(payload.responseBody, cfg) : undefined,
  };
  const fp = fingerprintOf(clean);

  // Capture + dedupe only. Delivery to an agent is ALWAYS user-initiated (the
  // "Send" button → sendNow); there is no automatic page→agent path.
  await withLock(async () => {
    const errors = await getErrors();
    let rec = errors[fp];
    if (rec) {
      rec.count += 1;
      rec.lastSeen = now;
      rec.message = clean.message;
      rec.stack = clean.stack;
      rec.requestBody = clean.requestBody;
      rec.responseBody = clean.responseBody;
      // Same error can fire in several tabs (same origin) — keep dedup by fingerprint
      // (one panel entry) but ACCUMULATE the tabs that produced it, so a per-tab read
      // can scope errors to its own tab instead of getting every same-origin tab's.
      rec.tabId = tabId; // last-seen, for legacy single-value consumers
      if (!Array.isArray(rec.tabIds)) rec.tabIds = [];
      if (tabId != null && !rec.tabIds.includes(tabId)) rec.tabIds.push(tabId);
    } else {
      rec = { fingerprint: fp, ...clean, tabIds: tabId != null ? [tabId] : [], count: 1, firstSeen: now, lastSeen: now, sentCount: 0, lastSentAt: 0, lastSendResult: null, muted: false };
      errors[fp] = rec;
    }
    await saveErrors(errors);
  });

  await updateBadge();
}

// Redact sensitive header values (Authorization/Cookie/…), then run the generic
// redactor over the rest so tokens embedded in other headers are masked too.
function redactHeaders(h, cfg) {
  if (!h || typeof h !== 'object') return {};
  if (!cfg.redact) return h;
  const keys = (cfg.redactKeys || []).map((k) => String(k).toLowerCase());
  const out = {};
  for (const k of Object.keys(h)) {
    out[k] = keys.includes(k.toLowerCase()) ? '[REDACTED]' : redact(String(h[k]), cfg);
  }
  return out;
}

// Record a captured request into the volatile network log and push it live to
// the side panel (best-effort; ignored when no panel is listening).
async function handleNet(payload, sender) {
  const cfg = await getConfig();
  if (!cfg.enabled || cfg.captureNetworkLog === false) return;
  // Security: gate on the browser-supplied frame URL, not the forgeable
  // payload.pageUrl (see handleError).
  const frameUrl = (sender && sender.url) || '';
  if (!originAllowed(cfg.allowlist, frameUrl)) return;
  let origin = '';
  try {
    origin = new URL(frameUrl).origin;
  } catch (_e) {
    /* ignore */
  }
  const rec = {
    netId: payload.netId || 'n_' + Date.now(),
    tabId: sender && sender.tab ? sender.tab.id : undefined,
    type: payload.type || 'fetch',
    method: payload.method || 'GET',
    url: redact(payload.url || '', cfg),
    status: payload.status || 0,
    statusText: payload.statusText || '',
    ok: !!payload.ok,
    contentType: payload.contentType || '',
    durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : undefined,
    requestHeaders: redactHeaders(payload.requestHeaders, cfg),
    requestBody: payload.requestBody ? redact(payload.requestBody, cfg) : undefined,
    responseHeaders: redactHeaders(payload.responseHeaders, cfg),
    responseBody: payload.responseBody ? redact(payload.responseBody, cfg) : undefined,
    pageUrl: frameUrl,
    origin,
    ts: payload.ts || Date.now(),
  };
  netLog.unshift(rec);
  if (netLog.length > MAX_NETLOG) netLog.length = MAX_NETLOG;
  persistNetLog();
  try {
    chrome.runtime.sendMessage({ type: 'tc-net-record', record: rec }, () => void chrome.runtime.lastError);
  } catch (_e) {
    /* no panel open */
  }
}

// Console.* output for the Console tab. Mirrors handleNet: gate on the
// browser-supplied frame URL (not the forgeable payload), store newest-first,
// persist, and live-push to an open panel.
async function handleConsole(payload, sender) {
  const cfg = await getConfig();
  if (!cfg.enabled || cfg.captureConsole === false) return;
  const frameUrl = (sender && sender.url) || '';
  if (!originAllowed(cfg.allowlist, frameUrl)) return;
  let origin = '';
  try {
    origin = new URL(frameUrl).origin;
  } catch (_e) {
    /* ignore */
  }
  const rec = {
    conId: payload.conId || 'c_' + Date.now(),
    tabId: sender && sender.tab ? sender.tab.id : undefined,
    level: payload.level || 'log',
    text: redact(String(payload.text || ''), cfg),
    pageUrl: frameUrl,
    origin,
    ts: payload.ts || Date.now(),
  };
  consoleLog.unshift(rec);
  if (consoleLog.length > MAX_CONSOLE) consoleLog.length = MAX_CONSOLE;
  persistConsoleLog();
  try {
    chrome.runtime.sendMessage({ type: 'tc-console-record', record: rec }, () => void chrome.runtime.lastError);
  } catch (_e) {
    /* no panel open */
  }
}

// ── reproduction recorder ──
// Append + live-broadcast one captured step. The broadcast uses a DISTINCT type
// (tc-repro-record) from the inbound tc-repro-step so the background's own
// listener doesn't loop it back into the store (same trick as net/console).
function pushReproStep(rec) {
  repro.steps.push(rec);
  if (repro.steps.length > MAX_REPRO_STEPS) repro.steps.shift();
  persistRepro();
  try {
    chrome.runtime.sendMessage({ type: 'tc-repro-record', step: rec }, () => void chrome.runtime.lastError);
  } catch (_e) {
    /* no panel open */
  }
}
// Begin a recording on the active tab: reset the step list, remember the tab, and
// tell its content script to start observing.
async function startRepro() {
  let tab = null;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_e) {
    /* ignore */
  }
  if (!tab || tab.id == null) return { ok: false, error: 'no active page' };
  const cfg = await getConfig();
  if (!originAllowed(cfg.allowlist, tab.url || '')) return { ok: false, error: 'page not in allowlist' };
  repro = { recording: true, tabId: tab.id, windowId: tab.windowId, startUrl: tab.url || '', steps: [] };
  persistReproNow();
  try {
    chrome.tabs.sendMessage(tab.id, { type: 'reproControl', on: true }, { frameId: 0 }, () => void chrome.runtime.lastError);
  } catch (_e) {
    /* ignore */
  }
  return { ok: true, startUrl: repro.startUrl };
}
// Finish a recording: stop the content observer, grab a final screenshot of the
// end state, and hand the captured steps back to the side panel.
async function stopRepro() {
  const steps = repro.steps.slice();
  const startUrl = repro.startUrl;
  let screenshot = null;
  if (repro.recording && repro.tabId != null) {
    try {
      chrome.tabs.sendMessage(repro.tabId, { type: 'reproControl', on: false }, { frameId: 0 }, () => void chrome.runtime.lastError);
    } catch (_e) {
      /* ignore */
    }
    screenshot = await captureVisible(repro.tabId, repro.windowId);
  }
  repro.recording = false;
  persistReproNow();
  return { ok: true, steps, startUrl, screenshot };
}
// One step streamed from the recorded tab's content script. Gate on the recorded
// tab id and redact text/value the same way captured errors are.
async function handleReproStep(step, sender) {
  if (!repro.recording) return;
  if (sender && sender.tab && repro.tabId != null && sender.tab.id !== repro.tabId) return;
  const cfg = await getConfig();
  const rec = {
    action: String((step && step.action) || 'event'),
    selector: String((step && step.selector) || '').slice(0, 300),
    text: redact(String((step && step.text) || ''), cfg).slice(0, 200),
    value: redact(String((step && step.value) || ''), cfg).slice(0, 200),
    url: (step && step.url) || (sender && sender.url) || '',
    ts: (step && step.ts) || Date.now(),
  };
  pushReproStep(rec);
}
// A top-frame content script (re)loaded. If it belongs to the tab we're recording
// it's a navigation: log the new URL as a step and tell the script to resume.
function reproHello(sender, sendResponse) {
  const top = sender && (sender.frameId === 0 || sender.frameId == null);
  const isTarget = repro.recording && top && sender && sender.tab && sender.tab.id === repro.tabId;
  if (isTarget) {
    const url = (sender && sender.url) || '';
    const last = repro.steps[repro.steps.length - 1];
    if (url && !(last && last.action === 'nav' && last.url === url)) {
      pushReproStep({ action: 'nav', selector: '', text: '', value: '', url, ts: Date.now() });
    }
  }
  sendResponse({ record: !!isTarget });
}

async function sendNow(fingerprint) {
  const cfg = await getConfig();
  const errors = await getErrors();
  const rec = errors[fingerprint];
  if (!rec) return { ok: false, result: 'not found' };
  const target = resolveTarget(cfg, rec.origin);
  if (!target) return { ok: false, result: 'no commander configured' };
  let shot = null;
  let activeTab = null;
  try {
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (cfg.captureScreenshots) shot = await captureVisible(activeTab && activeTab.id, activeTab && activeTab.windowId);
  } catch (_e) {
    /* ignore */
  }
  const result = await sendErrorToServer(target, rec, shot, currentLocation(cfg, activeTab));
  await withLock(async () => {
    const map = await getErrors();
    if (map[fingerprint]) {
      map[fingerprint].sentCount += 1;
      map[fingerprint].lastSentAt = Date.now();
      map[fingerprint].lastSendResult = result;
      await saveErrors(map);
    }
  });
  return { ok: !result.startsWith('error'), result };
}

// ── browser bridge: capture a screenshot for an agent ──
// Screenshots the target tab (default: active), optionally cropped to one element,
// saves it via the element-screenshot endpoint, and returns the path. The VISIBLE
// tab uses captureVisibleTab (no debugger banner); a background/targeted tab is
// captured over chrome.debugger's Page.captureScreenshot (works without focus).
async function bridgeScreenshot(commanderId, rect, selector, tabId) {
  let activeTab = null;
  try {
    [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_e) {
    /* ignore */
  }
  let target = null;
  if (tabId != null) {
    try {
      target = await chrome.tabs.get(tabId);
    } catch (_e) {
      /* ignore */
    }
  } else {
    target = activeTab;
  }
  if (!target || target.id == null) return { ok: false, error: 'no target tab' };

  let shot = null;
  const cropIf = async (s) => {
    if (s && rect && rect.w && rect.h) {
      const cropped = await cropScreenshot(s, rect, rect.dpr || 1);
      if (cropped) return cropped;
    }
    return s;
  };
  // Prefer captureVisibleTab whenever the target is the ACTIVE tab of its window —
  // the current window OR a background one. captureVisibleTab(windowId) grabs that
  // window's active tab WITHOUT focusing it (and with no debugger banner), so this
  // works on background-window tabs. Skip it only while we're mid-debug on the tab.
  if (target.active && !cdpAttached.has(target.id)) {
    shot = await cropIf(await captureVisible(target.id, target.windowId));
  }
  // Otherwise (a hidden tab not active in its window, or the capture failed) → CDP
  // Page.captureScreenshot — works without focus, but is refused when another
  // extension injected a frame into the tab (LastPass et al.).
  if (!shot) {
    try {
      shot = await cdpScreenshot(target.id, rect);
    } catch (e) {
      // Last resort: if the tab is active in some on-screen window, try that window.
      if (target.active) shot = await cropIf(await captureVisible(target.id, target.windowId));
      if (!shot) {
        return {
          ok: false,
          error:
            'screenshot failed (' +
            ((e && e.message) || 'cdp blocked') +
            '). The tab is not the active tab of an on-screen window and chrome.debugger is blocked here — bring its window on-screen, or activate the tab.',
        };
      }
    }
  }
  if (!shot) return { ok: false, error: 'capture failed' };
  const saved = await saveElementShot(commanderId, shot, selector || 'page');
  return saved && saved.ok ? { ok: true, path: saved.path } : { ok: false, error: (saved && saved.error) || 'save failed' };
}
// Capture any tab (even backgrounded) via the DevTools Protocol. `rect` (CSS px,
// viewport-relative) clips to one element.
async function cdpScreenshot(tabId, rect) {
  await cdpAttach(tabId);
  const params = { format: 'png' };
  if (rect && rect.w && rect.h) params.clip = { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 };
  const r = await cdpSend(tabId, 'Page.captureScreenshot', params);
  return r && r.data ? 'data:image/png;base64,' + r.data : null;
}

// ── chrome.debugger CDP driver (drive the real, logged-in session) ──
// Drives the page via the DevTools Protocol THROUGH the extension (chrome.debugger),
// so it works on the user's real profile without --remote-debugging-port (which
// Chrome 136+ refuses on the default profile). Shows the "…debugging this browser"
// banner while attached. Actions are gated to the capture allowlist.
const cdpAttached = new Set(); // tabIds we currently hold a debugger session on
// tabId → the Debuggee we actually attached with ({tabId} normally, or {targetId}
// when we had to fall back — see cdpAttach). cdpSend/detach must reuse it.
const cdpDebuggee = new Map();

function cdpSend(tabId, method, params) {
  return new Promise((resolve, reject) => {
    const dbg = cdpDebuggee.get(tabId) || { tabId };
    chrome.debugger.sendCommand(dbg, method, params || {}, (result) => {
      const e = chrome.runtime.lastError;
      if (e) return reject(new Error(e.message));
      resolve(result);
    });
  });
}
function cdpRawAttach(dbg) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(dbg, '1.3', () => {
      const e = chrome.runtime.lastError;
      // "Another debugger is already attached" → reuse it rather than fail.
      if (e && !/already attached/i.test(e.message || '')) return reject(new Error(e.message));
      resolve();
    });
  });
}
function cdpGetTargets() {
  return new Promise((resolve) => chrome.debugger.getTargets((t) => resolve(t || [])));
}
async function cdpAttach(tabId) {
  if (cdpAttached.has(tabId)) return;
  try {
    await cdpRawAttach({ tabId });
    cdpDebuggee.set(tabId, { tabId });
  } catch (e) {
    // attach({tabId}) can resolve to the WRONG DevTools target when the tab has an
    // associated extension target (Brave web3/wallet components, other injectors):
    // Chrome answers "Cannot access a chrome-extension:// URL of different extension".
    // Recover by enumerating targets and attaching to the real *page* target for this
    // tab by its targetId (whose URL is the actual http(s) document, not an extension).
    if (!/different extension|chrome-extension/i.test(e.message || '')) throw e;
    let tabUrl = '';
    try {
      const tb = await chrome.tabs.get(tabId);
      tabUrl = (tb && tb.url) || '';
    } catch (_e) {
      /* ignore */
    }
    const targets = await cdpGetTargets();
    const pages = targets.filter(
      (t) => t.type === 'page' && (t.tabId === tabId || (tabUrl && t.url === tabUrl)),
    );
    const real = pages.find((t) => !/^chrome-extension:\/\//.test(t.url || '')) || pages[0];
    if (!real) throw new Error('no page target for tab ' + tabId + ' (' + e.message + ')');
    if (/^chrome-extension:\/\//.test(real.url || '')) {
      throw new Error(
        'tab ' + tabId + ' top document is ' + real.url + ' — owned by another extension; cannot attach',
      );
    }
    await cdpRawAttach({ targetId: real.id });
    cdpDebuggee.set(tabId, { targetId: real.id });
  }
  cdpAttached.add(tabId);
  // Make the renderer behave as if focused/active even when its tab is backgrounded, so
  // drives/reads run identically unfocused: focus emulation (document.hasFocus()=true,
  // :focus styles, no blur events that close menus) + active web-lifecycle (Chrome won't
  // freeze/intensively-throttle the tab). Best-effort — never let these break the attach.
  try {
    await cdpSend(tabId, 'Emulation.setFocusEmulationEnabled', { enabled: true });
  } catch (_e) {
    /* not supported on this target */
  }
  try {
    await cdpSend(tabId, 'Page.setWebLifecycleState', { state: 'active' });
  } catch (_e) {
    /* not supported on this target */
  }
}
// Evaluate an expression in the page and return its (by-value) result.
function cdpEval(tabId, expression) {
  return cdpSend(tabId, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(
    (r) => (r && r.result ? r.result.value : undefined),
  );
}
// JS expression (string) for the scope root: `within` (a CSS selector) confines
// matching to that subtree so background content can't steal a selector/text hit;
// `document` when no `within`. Resolves to null when `within` is set but absent.
function tcRootExpr(within) {
  return within ? `document.querySelector(${JSON.stringify(within)})` : 'document';
}
// JS expression (string) resolving `selector` inside the optional `within` root.
function tcScopedQS(selector, within) {
  return `(()=>{const _r=${tcRootExpr(within)}; return _r?_r.querySelector(${JSON.stringify(selector)}):null;})()`;
}
// Poll until a selector exists (or time out). `within` scopes the search root.
async function cdpWaitSelector(tabId, selector, timeoutMs, within) {
  if (!selector) throw new Error('selector required');
  const deadline = Date.now() + Math.min(Number(timeoutMs) || 5000, 30000);
  for (;;) {
    if (await cdpEval(tabId, `!!${tcScopedQS(selector, within)}`)) return;
    if (Date.now() > deadline) throw new Error('timed out waiting for selector: ' + selector + (within ? ' within ' + within : ''));
    await new Promise((r) => setTimeout(r, 150));
  }
}
// Poll until the page text contains a string (or time out).
async function cdpWaitText(tabId, text, timeoutMs) {
  const needle = JSON.stringify(String(text));
  const deadline = Date.now() + Math.min(Number(timeoutMs) || 5000, 30000);
  for (;;) {
    if (await cdpEval(tabId, `((document.body&&document.body.innerText)||'').includes(${needle})`)) return;
    if (Date.now() > deadline) throw new Error('timed out waiting for text: ' + text);
    await new Promise((r) => setTimeout(r, 200));
  }
}
// Center point (viewport CSS px) of a selector, scrolling it into view first.
// `within` scopes the search root.
async function cdpPoint(tabId, selector, within) {
  const pt = await cdpEval(
    tabId,
    `(()=>{const e=${tcScopedQS(selector, within)}; if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2};})()`,
  );
  if (!pt) throw new Error('element not found: ' + selector + (within ? ' within ' + within : ''));
  return pt;
}
// Center point of the first clickable element whose VISIBLE TEXT matches (exact,
// then case-insensitive, then contains). Lets actions target "Volver" etc. without
// a CSS selector. Scrolls it into view first.
async function cdpPointByText(tabId, text, within) {
  const expr = `(function(){
    var root=${tcRootExpr(within)}; if(!root) return null;
    var norm=function(s){return String(s==null?'':s).trim();};
    var t=${JSON.stringify(String(text))}, tl=t.toLowerCase();
    var cands=Array.prototype.slice.call(root.querySelectorAll('button, a, [role=button], [role=option], [role=link], [role=menuitem], [role=tab], input[type=button], input[type=submit], label'));
    var lower=function(e){return norm(e.innerText||e.value).toLowerCase();};
    var el=cands.find(function(e){return norm(e.innerText||e.value)===t;}) || cands.find(function(e){return lower(e)===tl;}) || cands.find(function(e){return lower(e).indexOf(tl)>=0;});
    if(el==null){ el=Array.prototype.slice.call(root.querySelectorAll('*')).find(function(e){return e.children.length===0 && norm(e.innerText)===t;}); }
    if(el==null) return null;
    el.scrollIntoView({block:'center'});
    var r=el.getBoundingClientRect();
    return {x:r.left+r.width/2, y:r.top+r.height/2};
  })()`;
  const pt = await cdpEval(tabId, expr);
  if (!pt) throw new Error('no clickable element with text "' + text + '"' + (within ? ' within ' + within : ''));
  return pt;
}
// Resolve an action's target to a point: a CSS `selector` or visible `text`,
// optionally scoped to the `within` subtree.
async function cdpResolvePoint(tabId, selector, text, timeoutMs, within) {
  if (selector) {
    await cdpWaitSelector(tabId, selector, timeoutMs, within);
    return cdpPoint(tabId, selector, within);
  }
  if (text) return cdpPointByText(tabId, text, within);
  throw new Error('selector or text required');
}
// Brave/Chrome memory-saver discards background tabs; a discarded tab has no live
// renderer, so chrome.debugger attach/evaluate just hangs. Reload it (in place, no
// focus steal) and wait until it's ready before driving.
async function cdpEnsureAwake(tabId) {
  let tab = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (_e) {
    return;
  }
  if (!tab || (!tab.discarded && tab.status !== 'unloaded')) return;
  try {
    await chrome.tabs.reload(tabId);
  } catch (_e) {
    return;
  }
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t && !t.discarded && t.status === 'complete') return;
    } catch (_e) {
      return;
    }
    if (Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}
// Named keys → CDP key-event params (printable text typed via Input.insertText).
const CDP_KEYS = {
  Enter: { keyCode: 13, key: 'Enter', code: 'Enter', text: '\r' },
  Tab: { keyCode: 9, key: 'Tab', code: 'Tab' },
  Escape: { keyCode: 27, key: 'Escape', code: 'Escape' },
  Backspace: { keyCode: 8, key: 'Backspace', code: 'Backspace' },
  Delete: { keyCode: 46, key: 'Delete', code: 'Delete' },
  ArrowUp: { keyCode: 38, key: 'ArrowUp', code: 'ArrowUp' },
  ArrowDown: { keyCode: 40, key: 'ArrowDown', code: 'ArrowDown' },
  ArrowLeft: { keyCode: 37, key: 'ArrowLeft', code: 'ArrowLeft' },
  ArrowRight: { keyCode: 39, key: 'ArrowRight', code: 'ArrowRight' },
  Home: { keyCode: 36, key: 'Home', code: 'Home' },
  End: { keyCode: 35, key: 'End', code: 'End' },
  PageUp: { keyCode: 33, key: 'PageUp', code: 'PageUp' },
  PageDown: { keyCode: 34, key: 'PageDown', code: 'PageDown' },
  Space: { keyCode: 32, key: ' ', code: 'Space', text: ' ' },
};
async function cdpKey(tabId, keyName) {
  const k = CDP_KEYS[keyName];
  if (!k) throw new Error('unsupported key "' + keyName + '" (supported: ' + Object.keys(CDP_KEYS).join(', ') + ')');
  const base = { windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, key: k.key, code: k.code };
  await cdpSend(tabId, 'Input.dispatchKeyEvent', Object.assign({ type: k.text ? 'keyDown' : 'rawKeyDown' }, base, k.text ? { text: k.text } : {}));
  await cdpSend(tabId, 'Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
}
// One-shot JS-dialog auto-responders (tabId → {accept, promptText}). The onEvent
// listener below also auto-accepts UNARMED dialogs so an alert() can't hang a tab
// that has the Page domain enabled.
const dialogArmed = new Map();

// Per-tab manipulation gate — shared with the side panel via chrome.storage.local
// (`tc_drive_enabled` = { [tabId]: true } map of ENABLED tabs). Manipulation is OFF
// by default: a tab must be explicitly turned on (🤖 drive toggle) to be driven.
async function isTabDriveEnabled(tabId) {
  if (tabId == null) return false;
  try {
    const { tc_drive_enabled } = await chrome.storage.local.get('tc_drive_enabled');
    return !!(tc_drive_enabled && tc_drive_enabled[String(tabId)]);
  } catch (_e) {
    return false;
  }
}
// When a tab's 🤖 drive flag flips, tell that tab's content script to show/hide the
// on-page "agent can control this tab" indicator (the source of truth is storage, so
// this fires for both the side-panel toggle and the onRemoved prune below).
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.tc_drive_enabled) return;
    const next = changes.tc_drive_enabled.newValue || {};
    const prev = changes.tc_drive_enabled.oldValue || {};
    const ids = new Set([...Object.keys(next), ...Object.keys(prev)]);
    for (const id of ids) {
      const on = !!next[id];
      if (on === !!prev[id]) continue; // unchanged for this tab
      const tabId = Number(id);
      if (!Number.isFinite(tabId)) continue;
      try {
        chrome.tabs.sendMessage(tabId, { type: 'tcDriveIndicator', on }, () => void chrome.runtime.lastError);
      } catch (_e) {
        /* tab may be gone */
      }
    }
  });
} catch (_e) {
  /* ignore */
}

// Prune a tab's drive-enabled flag when it closes (tabIds are reused, so a stale
// entry could silently auto-enable a future tab on the same id).
try {
  chrome.tabs.onRemoved.addListener(async (closedId) => {
    try {
      const { tc_drive_enabled } = await chrome.storage.local.get('tc_drive_enabled');
      if (tc_drive_enabled && tc_drive_enabled[String(closedId)] != null) {
        delete tc_drive_enabled[String(closedId)];
        await chrome.storage.local.set({ tc_drive_enabled });
      }
    } catch (_e) {
      /* ignore */
    }
  });
} catch (_e) {
  /* ignore */
}

async function cdpDrive(cmd, args, tabId) {
  args = args || {};
  // Diagnostic: list every DevTools target (type/url/tabId/extensionId). Doesn't need
  // a tab or an attach — used to identify which extension owns a tab's debug target.
  if (cmd === 'targets') {
    const targets = await cdpGetTargets();
    return { targets, attached: Array.from(cdpAttached) };
  }
  if (tabId == null) {
    try {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = t && t.id;
    } catch (_e) {
      /* ignore */
    }
  }
  if (tabId == null) throw new Error('no active tab to drive');
  const cfg = await getConfig();
  let tab = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (_e) {
    /* ignore */
  }
  const url = (tab && tab.url) || '';
  if (!originAllowed(cfg.allowlist, url)) throw new Error('Refused: ' + (url || 'page') + ' is not in the allowlist');

  // Per-tab manipulation gate: manipulation is OFF by default — unless this tab's
  // 🤖 drive toggle is on (side panel), refuse so the debugger never even attaches to
  // it. 'detach' is always allowed so a tab can be cleaned up after being turned off.
  if (cmd !== 'detach' && !(await isTabDriveEnabled(tabId))) {
    throw new Error('Agent manipulation is OFF for this tab — turn on the 🤖 drive toggle in the Tide Commander side panel to allow click/type/navigate.');
  }

  await cdpEnsureAwake(tabId); // wake discarded/slept tabs so the debugger can attach
  await cdpAttach(tabId);

  switch (cmd) {
    case 'navigate': {
      if (!args.url) throw new Error('url required');
      if (!originAllowed(cfg.allowlist, args.url)) throw new Error('Refused: target ' + args.url + ' is not in the allowlist');
      await cdpSend(tabId, 'Page.navigate', { url: args.url });
      return { ok: true, url: args.url };
    }
    case 'scroll': {
      // Resolving the point already scrolls the element into view.
      await cdpResolvePoint(tabId, args.selector, args.text, args.timeoutMs, args.within);
      return { ok: true };
    }
    case 'click': {
      const pt = await cdpResolvePoint(tabId, args.selector, args.text, args.timeoutMs, args.within);
      // Real (trusted) mouse events so SPA handlers fire exactly as for a user.
      await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
      await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 });
      await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 });
      return { ok: true };
    }
    case 'hover': {
      const pt = await cdpResolvePoint(tabId, args.selector, args.text, args.timeoutMs, args.within);
      await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
      return { ok: true };
    }
    case 'drag': {
      await cdpWaitSelector(tabId, args.from, args.timeoutMs);
      await cdpWaitSelector(tabId, args.to, args.timeoutMs);
      const a = await cdpPoint(tabId, args.from);
      const b = await cdpPoint(tabId, args.to);
      await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y });
      await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
      await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y, button: 'left', buttons: 1 });
      await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 1, clickCount: 1 });
      return { ok: true };
    }
    case 'type': {
      await cdpWaitSelector(tabId, args.selector, args.timeoutMs, args.within);
      // Focus (and optionally select-all so insertText replaces the value). insertText
      // fires beforeinput/input events, so React/SPA state updates.
      await cdpEval(
        tabId,
        `(()=>{const e=${tcScopedQS(args.selector, args.within)}; if(e){e.focus(); ${args.clear ? 'if(e.select)e.select();' : ''}} return !!e;})()`,
      );
      await cdpSend(tabId, 'Input.insertText', { text: String(args.text == null ? '' : args.text) });
      return { ok: true };
    }
    case 'key': {
      if (args.selector) {
        await cdpWaitSelector(tabId, args.selector, args.timeoutMs, args.within);
        await cdpEval(tabId, `(()=>{const e=${tcScopedQS(args.selector, args.within)}; if(e)e.focus(); return !!e;})()`);
      }
      await cdpKey(tabId, String(args.key));
      return { ok: true };
    }
    case 'select': {
      await cdpWaitSelector(tabId, args.selector, args.timeoutMs, args.within);
      const pick =
        args.label != null
          ? `const o=[...e.options].find(o=>o.text.trim()===${JSON.stringify(String(args.label))}); if(!o) return 'no option'; e.value=o.value;`
          : `e.value=${JSON.stringify(String(args.value == null ? '' : args.value))};`;
      const r = await cdpEval(
        tabId,
        `(()=>{const e=${tcScopedQS(args.selector, args.within)}; if(!e) return 'no element'; ${pick} e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return 'ok';})()`,
      );
      if (r !== 'ok') throw new Error('select failed: ' + r);
      return { ok: true };
    }
    case 'evaluate': {
      const value = await cdpEval(tabId, String(args.expression || args.script || ''));
      return { value };
    }
    case 'dom': {
      // Debugger-based DOM read — works on any tab, including ones opened before
      // the extension loaded (where the content script isn't injected).
      const sel = args.selector || 'body';
      const all = !!args.all;
      const ser = `function(e){var r=e.getBoundingClientRect();var cs=getComputedStyle(e);var st={};['display','position','width','height','color','background-color','font-size','border','border-radius'].forEach(function(k){var v=cs.getPropertyValue(k); if(v) st[k]=v;});var fld;var tg=e.tagName.toLowerCase();if(tg==='input'||tg==='textarea'||tg==='select'){fld={type:e.type||tg,disabled:!!e.disabled};if(typeof e.value==='string')fld.value=e.value.slice(0,500);if(typeof e.checked==='boolean')fld.checked=e.checked;if(tg==='select'){var o=e.selectedOptions&&e.selectedOptions[0];fld.selectedText=o?(o.text||'').trim():'';}}return {selector:${JSON.stringify(sel)}, tag:tg, id:e.id||'', classes:e.classList?Array.prototype.slice.call(e.classList):[], text:(e.innerText||'').trim().slice(0,300), outerHTML:(e.outerHTML||'').slice(0,8000), field:fld, styles:st, rect:{x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}};}`;
      const expr = all
        ? `(function(){var ser=${ser};return {found:true, nodes:Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(sel)})).slice(0,20).map(ser)};})()`
        : `(function(){var ser=${ser};var e=document.querySelector(${JSON.stringify(sel)});if(!e) return {found:false};return {found:true, node:ser(e)};})()`;
      const out = await cdpEval(tabId, expr);
      if (!out || out.found === false) throw new Error('no element matches ' + sel);
      return all ? { nodes: out.nodes } : { node: out.node };
    }
    case 'wait': {
      if (args.selector) {
        await cdpWaitSelector(tabId, args.selector, args.timeoutMs);
        return { ok: true, found: 'selector' };
      }
      if (args.text) {
        await cdpWaitText(tabId, args.text, args.timeoutMs);
        return { ok: true, found: 'text' };
      }
      await new Promise((r) => setTimeout(r, Math.min(Number(args.ms) || 500, 30000)));
      return { ok: true };
    }
    case 'dialog': {
      // Arm a one-shot auto-responder for the NEXT JS dialog on this tab. Page must
      // be enabled so dialogs route through CDP (see the onEvent listener below).
      await cdpSend(tabId, 'Page.enable');
      const accept = args.accept !== false;
      dialogArmed.set(tabId, { accept, promptText: args.promptText != null ? String(args.promptText) : '' });
      return { ok: true, armed: true, accept };
    }
    case 'cdp_raw': {
      // Escape hatch: run ANY DevTools Protocol command on the tab.
      if (!args.method) throw new Error('method required');
      const result = await cdpSend(tabId, String(args.method), args.params || {});
      return { result };
    }
    case 'detach': {
      const dbg = cdpDebuggee.get(tabId) || { tabId };
      try {
        await new Promise((resolve) => chrome.debugger.detach(dbg, () => { void chrome.runtime.lastError; resolve(); }));
      } catch (_e) {
        /* ignore */
      }
      cdpAttached.delete(tabId);
      cdpDebuggee.delete(tabId);
      return { ok: true };
    }
    default:
      throw new Error('unknown drive command: ' + cmd);
  }
}
// Tab closed / DevTools opened / user clicked Cancel on the banner → forget it.
try {
  chrome.debugger.onDetach.addListener((source) => {
    if (source && source.tabId != null) {
      cdpAttached.delete(source.tabId);
      cdpDebuggee.delete(source.tabId);
      dialogArmed.delete(source.tabId);
    } else if (source && source.targetId != null) {
      // Session attached by targetId (the getTargets fallback) — find its tabId.
      for (const [tid, dbg] of cdpDebuggee) {
        if (dbg && dbg.targetId === source.targetId) {
          cdpAttached.delete(tid);
          cdpDebuggee.delete(tid);
          dialogArmed.delete(tid);
        }
      }
    }
  });
  // When Page is enabled, JS dialogs route through CDP and BLOCK until handled —
  // so always answer them (armed response, else a safe default accept) to avoid
  // hanging the tab.
  chrome.debugger.onEvent.addListener((source, method) => {
    if (method !== 'Page.javascriptDialogOpening') return;
    const tabId = source && source.tabId;
    if (tabId == null) return;
    const armed = dialogArmed.get(tabId);
    dialogArmed.delete(tabId); // one-shot
    const accept = armed ? armed.accept : true;
    const promptText = armed ? armed.promptText : '';
    chrome.debugger.sendCommand({ tabId }, 'Page.handleJavaScriptDialog', { accept, promptText }, () => void chrome.runtime.lastError);
  });
} catch (_e) {
  /* debugger permission may be absent until the user re-approves */
}

// ── element picker → side panel ──
async function handleElementPicked(context, sender) {
  let image = null;
  if (context && context.rect) {
    const shot = await captureVisible(sender?.tab?.id, sender?.tab?.windowId);
    if (shot) image = await cropScreenshot(shot, context.rect, context.dpr || 1);
  }
  chrome.runtime.sendMessage({ type: 'elementContext', context, image }, () => void chrome.runtime.lastError);
}

// ── context menus ──
function registerMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: 'tc-ask', title: 'Ask Tide Commander about this element', contexts: ['all'] });
      chrome.contextMenus.create({ id: 'tc-pick', title: 'Pick an element for Tide Commander…', contexts: ['all'] });
    });
  } catch (_e) {
    /* ignore */
  }
}
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || tab.id == null) return;
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (_e) {
    /* ignore */
  }
  if (info.menuItemId === 'tc-pick') {
    chrome.tabs.sendMessage(tab.id, { type: 'startPicker' }, { frameId: 0 }, () => void chrome.runtime.lastError);
  } else if (info.menuItemId === 'tc-ask') {
    chrome.tabs.sendMessage(tab.id, { type: 'getContextElement' }, { frameId: 0 }, async (resp) => {
      void chrome.runtime.lastError;
      if (!resp || !resp.context) return;
      let image = null;
      try {
        const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        if (shot && resp.context.rect) image = await cropScreenshot(shot, resp.context.rect, resp.context.dpr || 1);
      } catch (_e) {
        /* ignore */
      }
      chrome.runtime.sendMessage({ type: 'elementContext', context: resp.context, image }, () => void chrome.runtime.lastError);
    });
  }
});

// ── message router ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'tc-error':
      handleError(msg.payload, sender).catch(() => {});
      return;
    case 'tc-net':
      handleNet(msg.payload, sender).catch(() => {});
      return;
    case 'getNetwork':
      netLogReady.then(() => sendResponse({ records: netLog }));
      return true;
    case 'clearNetwork':
      netLog = [];
      chrome.storage.local.set({ tc_netlog: [] }).finally(() => sendResponse({ ok: true }));
      return true;
    case 'tc-console':
      handleConsole(msg.payload, sender).catch(() => {});
      return;
    case 'getConsole':
      consoleLogReady.then(() => sendResponse({ records: consoleLog }));
      return true;
    case 'clearConsole':
      consoleLog = [];
      chrome.storage.local.set({ tc_console: [] }).finally(() => sendResponse({ ok: true }));
      return true;
    case 'startRepro':
      startRepro().then(sendResponse);
      return true;
    case 'stopRepro':
      stopRepro().then(sendResponse);
      return true;
    case 'getRepro':
      reproReady.then(() => sendResponse({ recording: repro.recording, steps: repro.steps }));
      return true;
    case 'clearRepro':
      repro.steps = [];
      persistRepro();
      sendResponse({ ok: true });
      return true;
    case 'tc-repro-step':
      handleReproStep(msg.step, sender).catch(() => {});
      return;
    case 'reproHello':
      reproHello(sender, sendResponse);
      return true;
    case 'tcDriveQuery': {
      // A freshly-loaded content script asking whether its tab's 🤖 drive is on, so
      // it can (re)show the on-page indicator — only the background knows its tabId.
      const driveTabId = sender && sender.tab ? sender.tab.id : null;
      isTabDriveEnabled(driveTabId).then((on) => sendResponse({ on }));
      return true;
    }
    case 'elementPicked':
      handleElementPicked(msg.payload || msg.context ? msg.context || msg.payload : msg.context, sender).catch(() => {});
      return;
    case 'getState':
      (async () => {
        const config = await getConfig();
        const errors = Object.values(await getErrors()).sort((a, b) => b.lastSeen - a.lastSeen);
        sendResponse({ config, errors });
      })();
      return true;
    case 'setConfig':
      setConfig(msg.patch || {}).then((config) => {
        updateBadge();
        sendResponse({ ok: true, config });
      });
      return true;
    case 'resolveTarget':
      getConfig().then((cfg) => sendResponse({ target: resolveTarget(cfg, msg.origin) }));
      return true;
    case 'assignOrigin':
      withLock(async () => {
        const cfg = await getConfig();
        cfg.originMap[msg.origin] = { commanderId: msg.commanderId, agentId: msg.agentId || '' };
        await chrome.storage.local.set({ tc_config: cfg });
      }).then(() => sendResponse({ ok: true }));
      return true;
    case 'fetchAgents':
      fetchAgents(msg.commanderId).then(sendResponse);
      return true;
    case 'sendChat':
      sendChat(msg.commanderId, msg.agentId, msg.message).then(sendResponse);
      return true;
    case 'respondPrompt':
      respondPrompt(msg.commanderId, msg.requestId, msg.approved, msg.answers, msg.reason).then(sendResponse);
      return true;
    case 'stopAgent':
      stopAgent(msg.commanderId, msg.agentId).then(sendResponse);
      return true;
    case 'collapseContext':
      collapseContext(msg.commanderId, msg.agentId).then(sendResponse);
      return true;
    case 'fetchBuildings':
      fetchBuildings(msg.commanderId).then(sendResponse);
      return true;
    case 'buildingCommand':
      buildingCommand(msg.commanderId, msg.buildingId, msg.command).then(sendResponse);
      return true;
    case 'getHistory':
      getHistory(msg.commanderId, msg.agentId, msg.limit).then(sendResponse);
      return true;
    case 'saveElementShot':
      saveElementShot(msg.commanderId, msg.image, msg.selector).then(sendResponse);
      return true;
    case 'bridgeScreenshot':
      bridgeScreenshot(msg.commanderId, msg.rect, msg.selector, msg.tabId).then(sendResponse);
      return true;
    case 'cdpDrive':
      cdpDrive(msg.cmd, msg.args, msg.tabId)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((e) => sendResponse({ ok: false, error: (e && e.message) || String(e) }));
      return true;
    case 'saveAttachment':
      saveAttachment(msg.commanderId, msg.dataUrl, msg.filename).then(sendResponse);
      return true;
    case 'deleteError':
      withLock(async () => {
        const errors = await getErrors();
        delete errors[msg.fingerprint];
        await chrome.storage.local.set({ tc_errors: errors });
      }).then(async () => {
        await updateBadge();
        sendResponse({ ok: true });
      });
      return true;
    case 'clearErrors':
      chrome.storage.local.set({ tc_errors: {} }).then(async () => {
        await updateBadge();
        sendResponse({ ok: true });
      });
      return true;
    case 'muteError':
      withLock(async () => {
        const errors = await getErrors();
        if (errors[msg.fingerprint]) errors[msg.fingerprint].muted = !!msg.muted;
        await chrome.storage.local.set({ tc_errors: errors });
      }).then(async () => {
        await updateBadge();
        sendResponse({ ok: true });
      });
      return true;
    case 'sendNow':
      sendNow(msg.fingerprint).then(sendResponse);
      return true;
    default:
      return;
  }
});

// Clicking the toolbar icon toggles the chat side panel (no popup). Chrome
// natively opens/closes the global side-panel entry when this behavior is set,
// so the icon acts as a show/hide toggle for the cockpit.
function enableActionTogglesPanel() {
  try {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  } catch (_e) {
    /* ignore */
  }
}

chrome.runtime.onInstalled.addListener(() => {
  enableActionTogglesPanel();
  registerMenus();
  updateBadge();
});
chrome.runtime.onStartup.addListener(() => {
  enableActionTogglesPanel();
  registerMenus();
  updateBadge();
});
