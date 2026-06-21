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
  const clean = {
    kind: payload.kind,
    subtype: payload.subtype || '',
    status: payload.status || 0,
    method: payload.method || '',
    url: redact(payload.url || '', cfg),
    pageUrl: frameUrl,
    origin,
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
    } else {
      rec = { fingerprint: fp, ...clean, count: 1, firstSeen: now, lastSeen: now, sentCount: 0, lastSentAt: 0, lastSendResult: null, muted: false };
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
