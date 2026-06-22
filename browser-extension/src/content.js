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
    // The MAIN-world relay is page-reachable: any script can postMessage a forged
    // record with this (public) marker. Overwrite pageUrl with the ISOLATED-world
    // location.href — the real frame URL, which page script cannot forge — so a
    // page can't spoof its origin to slip past the background allowlist. The
    // background re-verifies independently via sender.url.
    d.payload.pageUrl = location.href;
    if (d.payload.channel === 'network') toBg({ type: 'tc-net', payload: d.payload });
    else if (d.payload.channel === 'console') toBg({ type: 'tc-console', payload: d.payload });
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
      // Capture generously; the side panel strips <svg> noise and applies the
      // final length cap AFTER stripping, so bulky icon paths don't eat the budget.
      outerHTML: (el.outerHTML || '').slice(0, 12000),
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

  // ── 3. reproduction recorder ──
  // While a recording is active, observe (never block) the user's interactions —
  // clicks, typing, selects, Enter/submit, and navigations — and stream them to
  // the background as numbered steps. Listeners are capture-phase + passive so the
  // page behaves exactly as if we weren't here. The background owns the session
  // state and survives full-page reloads (this script re-asks on load via
  // reproHello), so a multi-page flow is captured end to end.
  let reproOn = false;
  let reproLastUrl = location.href;
  let reproUrlTimer = null;
  let pendingInputEl = null;
  let pendingInputTimer = null;

  function reproEmit(action, detail) {
    toBg({ type: 'tc-repro-step', step: Object.assign({ action, url: location.href, ts: Date.now() }, detail || {}) });
  }
  // Best human label for a clicked element: its text, value, aria-label, etc.
  function reproLabel(el) {
    if (!el || el.nodeType !== 1) return '';
    let t = '';
    try {
      t =
        (el.innerText || el.value || '') ||
        (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.title)) ||
        '';
    } catch (_e) {
      /* ignore */
    }
    return String(t).trim().replace(/\s+/g, ' ').slice(0, 80);
  }
  // Coalesce a burst of keystrokes in one field into a single "type …" step:
  // emitted when focus moves on, the value settles, or recording stops.
  function flushReproInput() {
    if (pendingInputTimer) {
      clearTimeout(pendingInputTimer);
      pendingInputTimer = null;
    }
    if (!pendingInputEl) return;
    const el = pendingInputEl;
    pendingInputEl = null;
    let val = '';
    try {
      val = el.value != null ? String(el.value) : '';
    } catch (_e) {
      /* ignore */
    }
    if (el.type === 'password') val = '•'.repeat(Math.min(val.length, 8)); // never leak passwords
    reproEmit('input', { selector: cssPath(el), value: val.slice(0, 200) });
  }
  function onReproClick(e) {
    const el = e.target;
    if (!el || el === overlay || el === labelEl) return;
    flushReproInput();
    reproEmit('click', { selector: cssPath(el), text: reproLabel(el) });
  }
  function onReproInput(e) {
    const el = e.target;
    if (!el || !('value' in el)) return;
    if (el.type === 'checkbox' || el.type === 'radio') return; // handled on 'change'
    if (pendingInputEl && pendingInputEl !== el) flushReproInput();
    pendingInputEl = el;
    if (pendingInputTimer) clearTimeout(pendingInputTimer);
    pendingInputTimer = setTimeout(flushReproInput, 1000);
  }
  function onReproChange(e) {
    const el = e.target;
    if (!el) return;
    if (el.nodeName === 'SELECT') {
      const opt = el.options && el.options[el.selectedIndex];
      reproEmit('change', { selector: cssPath(el), text: opt ? String(opt.text || '').trim().slice(0, 80) : '', value: el.value });
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      reproEmit('change', { selector: cssPath(el), value: el.checked ? 'checked' : 'unchecked' });
    }
  }
  function onReproKey(e) {
    if (e.key !== 'Enter') return;
    const el = e.target;
    if (el && el.tagName === 'TEXTAREA' && !e.ctrlKey && !e.metaKey) return; // Enter is a newline here
    flushReproInput();
    reproEmit('key', { selector: cssPath(el), text: 'Enter' });
  }
  function onReproSubmit(e) {
    flushReproInput();
    reproEmit('submit', { selector: cssPath(e.target) });
  }
  // Polled so it also catches SPA route changes (history.pushState), which a
  // content script can't hook directly from the isolated world.
  function checkReproNav() {
    if (location.href !== reproLastUrl) {
      reproLastUrl = location.href;
      reproEmit('nav', { url: location.href });
    }
  }
  function startReproRecording() {
    if (reproOn) return;
    reproOn = true;
    document.addEventListener('click', onReproClick, true);
    document.addEventListener('input', onReproInput, true);
    document.addEventListener('change', onReproChange, true);
    document.addEventListener('keydown', onReproKey, true);
    document.addEventListener('submit', onReproSubmit, true);
    reproLastUrl = location.href;
    reproUrlTimer = setInterval(checkReproNav, 600);
  }
  function stopReproRecording() {
    if (!reproOn) return;
    reproOn = false;
    flushReproInput();
    document.removeEventListener('click', onReproClick, true);
    document.removeEventListener('input', onReproInput, true);
    document.removeEventListener('change', onReproChange, true);
    document.removeEventListener('keydown', onReproKey, true);
    document.removeEventListener('submit', onReproSubmit, true);
    if (reproUrlTimer) {
      clearInterval(reproUrlTimer);
      reproUrlTimer = null;
    }
  }

  // ── content-script drive (synthetic events) ────────────────────────────────
  // Used when chrome.debugger can't attach because another extension injected a
  // frame into the tab (e.g. LastPass's autofill in-field icon). Content scripts
  // aren't subject to that debugger access check, so we drive the page directly
  // with dispatched events. Events are isTrusted=false — fine for filling fields &
  // clicking normal buttons; a handler that demands a trusted event won't respond.
  function tcText(el) {
    return ((el && (el.innerText || el.textContent || el.value)) || '').trim();
  }
  function tcFindByText(text) {
    const t = String(text);
    const els = Array.prototype.slice.call(
      document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"],summary,label,li,span,div'),
    );
    return (
      els.find((e) => tcText(e) === t) ||
      els.find((e) => tcText(e).toLowerCase() === t.toLowerCase()) ||
      els.find((e) => tcText(e).toLowerCase().includes(t.toLowerCase())) ||
      null
    );
  }
  function tcResolve(args) {
    if (args.selector) return document.querySelector(args.selector);
    if (args.text) return tcFindByText(args.text);
    return null;
  }
  function tcWaitFor(pred, timeoutMs) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + Math.min(Number(timeoutMs) || 8000, 30000);
      (function poll() {
        let v;
        try {
          v = pred();
        } catch (_e) {
          v = null;
        }
        if (v) return resolve(v);
        if (Date.now() > deadline) return reject(new Error('timed out'));
        setTimeout(poll, 150);
      })();
    });
  }
  function tcMouse(el) {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      try {
        const isPtr = type.indexOf('pointer') === 0;
        el.dispatchEvent(isPtr ? new PointerEvent(type, o) : new MouseEvent(type, o));
      } catch (_e) {
        try {
          el.dispatchEvent(new MouseEvent(type.replace('pointer', 'mouse'), o));
        } catch (_e2) {
          /* ignore */
        }
      }
    });
  }
  // Set a field's value through the native setter so React/Vue see the change.
  function tcSetValue(el, value) {
    const proto =
      el.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : el.tagName === 'SELECT'
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const TC_KEYS = {
    Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
    Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
    Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
    Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  };
  async function tcAct(cmd, args) {
    args = args || {};
    switch (cmd) {
      case 'navigate': {
        if (!args.url) throw new Error('url required');
        let u;
        try {
          u = new URL(args.url, location.href);
        } catch (_e) {
          throw new Error('bad url: ' + args.url);
        }
        // Same-origin only — the page-level allowlist was already satisfied, but the
        // navigate target wasn't checked (the debugger refused before its own check).
        if (u.origin !== location.origin) throw new Error('content-script navigate is same-origin only (' + location.origin + ')');
        location.assign(u.href);
        return { ok: true, url: u.href };
      }
      case 'wait': {
        if (args.selector) {
          await tcWaitFor(() => document.querySelector(args.selector), args.timeoutMs);
          return { ok: true, found: 'selector' };
        }
        if (args.text) {
          await tcWaitFor(() => (((document.body && document.body.innerText) || '').includes(args.text) ? true : null), args.timeoutMs);
          return { ok: true, found: 'text' };
        }
        await new Promise((r) => setTimeout(r, Math.min(Number(args.ms) || 500, 30000)));
        return { ok: true };
      }
      case 'scroll': {
        const el = await tcWaitFor(() => tcResolve(args), args.timeoutMs);
        el.scrollIntoView({ block: 'center' });
        return { ok: true };
      }
      case 'click': {
        const el = await tcWaitFor(() => tcResolve(args), args.timeoutMs);
        el.scrollIntoView({ block: 'center' });
        try {
          if (typeof el.focus === 'function') el.focus();
        } catch (_e) {
          /* ignore */
        }
        tcMouse(el);
        try {
          if (typeof el.click === 'function') el.click();
        } catch (_e) {
          /* ignore */
        }
        return { ok: true };
      }
      case 'hover': {
        const el = await tcWaitFor(() => tcResolve(args), args.timeoutMs);
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
        ['mouseover', 'mouseenter', 'mousemove'].forEach((t) => {
          try {
            el.dispatchEvent(new MouseEvent(t, o));
          } catch (_e) {
            /* ignore */
          }
        });
        return { ok: true };
      }
      case 'type': {
        const el = await tcWaitFor(() => document.querySelector(args.selector), args.timeoutMs);
        el.scrollIntoView({ block: 'center' });
        try {
          el.focus();
        } catch (_e) {
          /* ignore */
        }
        const add = String(args.text == null ? '' : args.text);
        tcSetValue(el, args.clear ? add : (el.value || '') + add);
        return { ok: true };
      }
      case 'key': {
        const el = args.selector ? document.querySelector(args.selector) : document.activeElement || document.body;
        if (args.selector && el) {
          try {
            el.focus();
          } catch (_e) {
            /* ignore */
          }
        }
        const name = String(args.key || '');
        const k = TC_KEYS[name] || { key: name, code: name, keyCode: name.charCodeAt(0) || 0 };
        const init = { bubbles: true, cancelable: true, key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode };
        ['keydown', 'keypress', 'keyup'].forEach((t) => {
          try {
            (el || document).dispatchEvent(new KeyboardEvent(t, init));
          } catch (_e) {
            /* ignore */
          }
        });
        return { ok: true };
      }
      case 'select': {
        const el = await tcWaitFor(() => document.querySelector(args.selector), args.timeoutMs);
        if (el.tagName !== 'SELECT') {
          tcSetValue(el, String(args.value == null ? '' : args.value));
          return { ok: true };
        }
        let val = args.value;
        if (args.label != null) {
          const opt = Array.prototype.slice.call(el.options).find((o) => o.text.trim() === String(args.label));
          if (!opt) throw new Error('no option labelled ' + args.label);
          val = opt.value;
        }
        tcSetValue(el, String(val == null ? '' : val));
        return { ok: true };
      }
      case 'evaluate': {
        // Isolated-world eval: DOM access only, no page globals, and may be blocked by
        // the extension CSP. Best-effort — reads should prefer /dom or /page.
        try {
          const v = (0, eval)(String(args.expression || args.script || '')); // eslint-disable-line no-eval
          return { value: v };
        } catch (e) {
          throw new Error('content-script evaluate failed (' + ((e && e.message) || e) + ') — use /dom for reads');
        }
      }
      default:
        throw new Error('content-script drive does not support: ' + cmd);
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'tcAct') {
      Promise.resolve(tcAct(msg.cmd, msg.args)).then(
        (result) => sendResponse({ ok: true, result }),
        (e) => sendResponse({ ok: false, error: (e && e.message) || String(e) }),
      );
      return true;
    }
    if (msg.type === 'startPicker') {
      startPicker();
      sendResponse && sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'getContextElement') {
      sendResponse({ context: lastContextEl ? buildContext(lastContextEl) : null });
      return true;
    }
    if (msg.type === 'getDom') {
      // Bridge read: serialize a node (or all matches) by selector for an agent.
      try {
        if (msg.all && msg.selector) {
          const nodes = Array.from(document.querySelectorAll(msg.selector)).slice(0, 20).map(buildContext);
          sendResponse({ ok: true, nodes });
        } else {
          const el = msg.selector ? document.querySelector(msg.selector) : document.body;
          if (!el) sendResponse({ ok: false, error: 'no element matches ' + (msg.selector || 'body') });
          else sendResponse({ ok: true, node: buildContext(el) });
        }
      } catch (e) {
        sendResponse({ ok: false, error: (e && e.message) || 'getDom failed' });
      }
      return true;
    }
    if (msg.type === 'reproControl') {
      if (msg.on) startReproRecording();
      else stopReproRecording();
      sendResponse && sendResponse({ ok: true });
      return;
    }
  });

  // On (re)load, resume recording if a session is active. A full-page navigation
  // tears down & re-injects this script, so the handshake here (and the nav step
  // logged on the background side) keeps a multi-page flow recording. Gate on a
  // direct storage read first — content scripts run on every page, and we must NOT
  // wake the service worker on every load just to be told "not recording".
  if (window.top === window) {
    try {
      chrome.storage.local.get('tc_repro', (r) => {
        void chrome.runtime.lastError;
        if (!r || !r.tc_repro || !r.tc_repro.recording) return;
        chrome.runtime.sendMessage({ type: 'reproHello' }, (resp) => {
          void chrome.runtime.lastError;
          if (resp && resp.record) startReproRecording();
        });
      });
    } catch (_e) {
      /* extension context invalidated — ignore */
    }
  }
})();
