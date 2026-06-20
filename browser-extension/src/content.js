/**
 * content.js — ISOLATED world, document_start, all frames.
 *
 * Two jobs:
 *   1. Relay error records from the MAIN-world inject.js to the service worker.
 *   2. Element picker: highlight-on-hover + click to capture a DOM element's
 *      context (selector, HTML, computed styles, box) for the chat. Also tracks
 *      the last right-clicked element so the context-menu entry can grab it.
 */
(() => {
  const MARK = '__tideErrorTrigger';

  function toBg(msg) {
    try {
      chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError);
    } catch (_e) {
      /* extension context invalidated — ignore */
    }
  }

  // ── 1. relay captured errors + the full network log ──
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d[MARK] !== true || !d.payload) return;
    if (d.payload.channel === 'network') toBg({ type: 'tc-net', payload: d.payload });
    else toBg({ type: 'tc-error', payload: d.payload });
  });

  // ── 2. element picker ──
  const STYLE_KEYS = [
    'display', 'position', 'width', 'height', 'margin', 'padding', 'color',
    'background-color', 'font-size', 'font-family', 'font-weight', 'border',
    'border-radius', 'flex-direction', 'justify-content', 'align-items', 'gap',
    'grid-template-columns', 'z-index', 'opacity', 'overflow', 'text-align',
  ];

  function cssPath(el) {
    if (!(el instanceof Element)) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let sel = node.nodeName.toLowerCase();
      if (node.id) {
        parts.unshift('#' + CSS.escape(node.id));
        break;
      }
      const cls =
        typeof node.className === 'string'
          ? node.className
              .trim()
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((c) => '.' + CSS.escape(c))
              .join('')
          : '';
      sel += cls;
      const parent = node.parentNode;
      if (parent && parent.children) {
        const sibs = Array.from(parent.children).filter((c) => c.nodeName === node.nodeName);
        if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(sel);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function computedSubset(el) {
    const cs = getComputedStyle(el);
    const out = {};
    for (const k of STYLE_KEYS) {
      const v = cs.getPropertyValue(k);
      if (v) out[k] = v;
    }
    return out;
  }

  function buildContext(el) {
    const rect = el.getBoundingClientRect();
    return {
      selector: cssPath(el),
      tag: el.nodeName.toLowerCase(),
      id: el.id || '',
      classes: el.classList ? Array.from(el.classList) : [],
      text: (el.innerText || '').trim().slice(0, 300),
      outerHTML: (el.outerHTML || '').slice(0, 4000),
      styles: computedSubset(el),
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
      dpr: window.devicePixelRatio || 1,
      pageUrl: location.href,
      title: document.title,
    };
  }

  let pickerActive = false;
  let overlay = null;
  let labelEl = null;
  let curEl = null;

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #4f8cff;' +
      'background:rgba(79,140,255,0.15);border-radius:3px;display:none;';
    labelEl = document.createElement('div');
    labelEl.style.cssText =
      'position:fixed;z-index:2147483647;pointer-events:none;background:#1b1f26;color:#e6e9ef;' +
      'font:11px/1.4 system-ui,sans-serif;padding:2px 6px;border-radius:4px;max-width:60vw;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:none;';
    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(labelEl);
  }

  function onMove(e) {
    const el = e.target;
    if (!el || el === overlay || el === labelEl) return;
    curEl = el;
    const r = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
    labelEl.style.display = 'block';
    labelEl.textContent = cssPath(el);
    labelEl.style.left = r.left + 'px';
    labelEl.style.top = (r.top > 22 ? r.top - 20 : r.bottom + 4) + 'px';
  }

  function onClick(e) {
    if (!pickerActive) return;
    e.preventDefault();
    e.stopPropagation();
    const el = curEl || e.target;
    stopPicker();
    try {
      toBg({ type: 'elementPicked', context: buildContext(el) });
    } catch (_e) {
      /* ignore */
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') stopPicker();
  }

  function startPicker() {
    if (pickerActive) return;
    pickerActive = true;
    ensureOverlay();
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    if (document.body) document.body.style.cursor = 'crosshair';
  }

  function stopPicker() {
    pickerActive = false;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    if (overlay) overlay.style.display = 'none';
    if (labelEl) labelEl.style.display = 'none';
    if (document.body) document.body.style.cursor = '';
  }

  // Track the last right-clicked element for the context-menu entry.
  let lastContextEl = null;
  document.addEventListener('contextmenu', (e) => {
    lastContextEl = e.target;
  }, true);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'startPicker') {
      startPicker();
      sendResponse && sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'getContextElement') {
      sendResponse({ context: lastContextEl ? buildContext(lastContextEl) : null });
      return true;
    }
  });
})();
