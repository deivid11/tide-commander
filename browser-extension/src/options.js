/* options.js — manage commanders + capture/redaction settings. */

const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));

const FLAGS = ['enabled', 'autoSend', 'captureScreenshots', 'captureNetwork', 'captureJs', 'captureConsole', 'captureResource', 'redact'];

let working = []; // working copy of commanders
let activeId = '';

function uid() {
  return 'cmd_' + (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now()));
}

function setStatus(text, ok) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status ' + (ok ? 'ok' : 'bad');
  if (text) setTimeout(() => ((el.textContent = ''), (el.className = 'status')), 2500);
}

function renderCommanders() {
  const wrap = $('commanders');
  wrap.innerHTML = '';
  working.forEach((c, idx) => {
    const row = document.createElement('div');
    row.className = 'cmd-row';
    row.innerHTML = `
      <label class="cmd-active" title="Active (default) commander">
        <input type="radio" name="active" value="${c.id}" ${c.id === activeId ? 'checked' : ''} />
        active
      </label>
      <input class="cmd-name" data-idx="${idx}" placeholder="Name" value="${c.name ? c.name.replace(/"/g, '&quot;') : ''}" />
      <input class="cmd-url" data-idx="${idx}" placeholder="http://host:5174" value="${c.baseUrl ? c.baseUrl.replace(/"/g, '&quot;') : ''}" />
      <input class="cmd-token" data-idx="${idx}" type="password" placeholder="token (optional)" value="${c.token ? c.token.replace(/"/g, '&quot;') : ''}" />
      <button class="icon-btn cmd-del" data-idx="${idx}" title="Remove" type="button">✕</button>
      <input class="cmd-app" data-idx="${idx}" placeholder="Agent-link URL (optional — where agent links open; defaults to the server URL above)" value="${c.appUrl ? c.appUrl.replace(/"/g, '&quot;') : ''}" />`;
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('.cmd-del').forEach((b) =>
    b.addEventListener('click', () => {
      syncFromDom();
      working.splice(Number(b.dataset.idx), 1);
      if (!working.find((c) => c.id === activeId)) activeId = working[0] ? working[0].id : '';
      renderCommanders();
    }),
  );
  wrap.querySelectorAll('input[name="active"]').forEach((r) =>
    r.addEventListener('change', () => (activeId = r.value)),
  );
}

function syncFromDom() {
  const wrap = $('commanders');
  wrap.querySelectorAll('.cmd-name').forEach((inp) => (working[Number(inp.dataset.idx)].name = inp.value.trim()));
  wrap.querySelectorAll('.cmd-url').forEach((inp) => (working[Number(inp.dataset.idx)].baseUrl = inp.value.trim().replace(/\/+$/, '')));
  wrap.querySelectorAll('.cmd-token').forEach((inp) => (working[Number(inp.dataset.idx)].token = inp.value));
  wrap.querySelectorAll('.cmd-app').forEach((inp) => (working[Number(inp.dataset.idx)].appUrl = inp.value.trim().replace(/\/+$/, '')));
  const checked = wrap.querySelector('input[name="active"]:checked');
  if (checked) activeId = checked.value;
}

function parseList(str, sep) {
  return String(str || '')
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function load() {
  const { config } = await send({ type: 'getState' });
  working = (config.commanders || []).map((c) => ({ ...c }));
  activeId = config.activeCommanderId || (working[0] && working[0].id) || '';
  renderCommanders();

  for (const f of FLAGS) $(f).checked = config[f];
  $('defaultAgentId').value = config.defaultAgentId || '';
  $('thresholds').value = (config.thresholds || []).join(',');
  $('allowlist').value = (config.allowlist || []).join('\n');
  $('redactKeys').value = (config.redactKeys || []).join(',');
}

async function save() {
  syncFromDom();
  working = working.filter((c) => c.baseUrl); // drop empty rows
  if (working.length && !working.find((c) => c.id === activeId)) activeId = working[0].id;

  const patch = { commanders: working, activeCommanderId: activeId, defaultAgentId: $('defaultAgentId').value.trim() };
  for (const f of FLAGS) patch[f] = $(f).checked;
  patch.thresholds = parseList($('thresholds').value, ',')
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (patch.thresholds.length === 0) patch.thresholds = [1, 10, 100, 1000];
  patch.allowlist = parseList($('allowlist').value, '\n');
  patch.redactKeys = parseList($('redactKeys').value, ',').map((k) => k.toLowerCase());

  await send({ type: 'setConfig', patch });
  setStatus('Saved ✓', true);
}

$('addCommander').addEventListener('click', () => {
  syncFromDom();
  const c = { id: uid(), name: '', baseUrl: '', token: '', appUrl: '' };
  working.push(c);
  if (!activeId) activeId = c.id;
  renderCommanders();
});
$('save').addEventListener('click', save);
load();
