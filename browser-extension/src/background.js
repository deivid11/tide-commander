/**
 * background.js — MV3 service worker / hub.
 *
 *  - Receives + dedupes captured errors, auto-sends them to the agent assigned
 *    to the page's origin.
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
  autoSend: true,
  captureScreenshots: true,
  includePageContext: false, // prepend current page URL/title to chat messages
  includeComputedStyles: true, // include a picked element's computed CSS when sending it
  includeNetworkHeaders: true, // include request/response headers when sending a network request
  thresholds: [1, 10, 100, 1000],
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
// List/search files in an agent's cwd for the @-mention autocomplete. Mirrors
// the React client's GET /api/agents/:id/files?q= call; the server ranks and
// caps the results (dirs first, shallow paths first).
async function fetchFiles(commanderId, agentId, q) {
  const cfg = await getConfig();
  const c = commanderById(cfg, commanderId);
  if (!c) return { ok: false, error: 'no commander', files: [] };
  if (!agentId) return { ok: false, error: 'no agent selected', files: [] };
  try {
    const r = await apiFetch(
      c.baseUrl,
      c.token,
      `/api/agents/${encodeURIComponent(agentId)}/files?q=${encodeURIComponent(q || '')}`,
    );
    if (!r.ok) return { ok: false, error: 'HTTP ' + r.status, files: [] };
    const j = await r.json();
    return { ok: true, files: Array.isArray(j.files) ? j.files : [] };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), files: [] };
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
async function getHistory(commanderId, agentId, limit) {
  const cfg = await getConfig();
  const c = commanderById(cfg, commanderId);
  if (!c || !agentId) return { ok: false, error: 'missing commander/agent', messages: [] };
  try {
    const r = await apiFetch(c.baseUrl, c.token, `/api/agents/${encodeURIComponent(agentId)}/history?limit=${limit || 60}&offset=0`);
    if (!r.ok) return { ok: false, error: 'HTTP ' + r.status, messages: [] };
    const j = await r.json();
    return { ok: true, messages: j.messages || [], cwd: j.cwd, sessionId: j.sessionId };
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
  if (!originAllowed(cfg.allowlist, payload.pageUrl)) return;

  const now = payload.ts || Date.now();
  let origin = '';
  try {
    origin = new URL(payload.pageUrl).origin;
  } catch (_e) {
    /* ignore */
  }
  const clean = {
    kind: payload.kind,
    subtype: payload.subtype || '',
    status: payload.status || 0,
    method: payload.method || '',
    url: redact(payload.url || '', cfg),
    pageUrl: payload.pageUrl || '',
    origin,
    message: redact(payload.message || '', cfg),
    stack: redact(payload.stack || '', cfg),
    userAgent: payload.ua || '',
    requestBody: payload.requestBody ? redact(payload.requestBody, cfg) : undefined,
    responseBody: payload.responseBody ? redact(payload.responseBody, cfg) : undefined,
  };
  const fp = fingerprintOf(clean);

  const decision = await withLock(async () => {
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
    const shouldSend = cfg.autoSend && !rec.muted && Array.isArray(cfg.thresholds) && cfg.thresholds.includes(rec.count);
    await saveErrors(errors);
    return { rec: { ...rec }, shouldSend };
  });

  await updateBadge();

  if (decision.shouldSend) {
    const target = resolveTarget(cfg, origin);
    if (!target) return;
    const shot = cfg.captureScreenshots ? await captureVisible(sender?.tab?.id, sender?.tab?.windowId) : null;
    const result = await sendErrorToServer(target, decision.rec, shot, currentLocation(cfg, sender && sender.tab));
    await withLock(async () => {
      const errors = await getErrors();
      const rec = errors[fp];
      if (rec) {
        rec.sentCount += 1;
        rec.lastSentAt = Date.now();
        rec.lastSendResult = result;
        await saveErrors(errors);
      }
    });
  }
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
  if (!originAllowed(cfg.allowlist, payload.pageUrl)) return;
  let origin = '';
  try {
    origin = new URL(payload.pageUrl).origin;
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
    pageUrl: payload.pageUrl || '',
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
    case 'fetchFiles':
      fetchFiles(msg.commanderId, msg.agentId, msg.q).then(sendResponse);
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
