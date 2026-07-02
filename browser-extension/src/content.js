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

  // Auto-generated ids that frameworks RENUMBER on every re-render → useless as a stable
  // selector (react-select options renumber as the menu filters; React 18 useId emits
  // `:r1:`; radix/headlessui/reach prefix theirs). Anchoring on these gives a selector
  // that's already stale by the time you click it — so cssPath skips them.
  function tcVolatileId(id) {
    return !!id && (/^react-select-\d+-option-/.test(id) || /^:r[0-9a-z]+:$/i.test(id) || /^(radix-|headlessui-|reach-)/i.test(id));
  }
  // State/modifier classes toggle as the user interacts (focus, selection, open, hashed
  // CSS-in-JS state) — anchoring a path on them makes it match a moving target, so they're
  // dropped in favour of stable semantic classes. The trailing `css-<hash>` test catches
  // emotion / CSS-in-JS generated classes (`css-1nmdiq5-menu`, `css-d7l1ni-option`): the
  // hash encodes the render STATE, so e.g. a react-select option flips `css-d7l1ni-option`
  // (idle) → `css-10wo9uf-option` (highlighted) — baking it makes the next click miss. The
  // hash always carries a digit, so `css-<word>` (hand-written) is left intact.
  function tcStateClass(c) {
    return c.indexOf('--') >= 0 || /^(is|has)-/.test(c) || /^css-(?=[a-z0-9]*\d)[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(c) || /^(active|focus|focused|hover|hovered|selected|open|opened|show|shown|hidden|disabled|checked|expanded|collapsed|loading|dirty|touched|pending|invalid|error|current|highlighted|dragging)$/i.test(c);
  }
  function tcPathClasses(node) {
    if (typeof node.className !== 'string') return '';
    return node.className
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .filter((c) => !tcStateClass(c))
      .slice(0, 2)
      .map((c) => '.' + CSS.escape(c))
      .join('');
  }
  function cssPath(el) {
    if (!(el instanceof Element)) return '';
    if (el.id && !tcVolatileId(el.id)) return '#' + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let sel = node.nodeName.toLowerCase();
      if (node.id && !tcVolatileId(node.id)) {
        parts.unshift('#' + CSS.escape(node.id));
        break;
      }
      const cls = tcPathClasses(node);
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

  // Live state of a form control, read straight from the DOM PROPERTIES (not the
  // attribute) — so an agent can read what's actually typed/selected without running
  // `evaluate` (the content-script eval is blocked by the extension CSP, so reads
  // must not depend on it). Returns undefined for non-controls.
  function fieldState(el) {
    const tag = el.nodeName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return undefined;
    const f = { type: el.type || tag, disabled: !!el.disabled };
    if (typeof el.value === 'string') f.value = el.value.slice(0, 500);
    if (typeof el.checked === 'boolean') f.checked = el.checked;
    if (tag === 'select') {
      const opt = el.selectedOptions && el.selectedOptions[0];
      f.selectedText = opt ? (opt.text || '').trim() : '';
    }
    return f;
  }
  // ── React component probe (bridges to inject.js in the MAIN world) ──────────
  // React Fibers (`el.__reactFiber$…`) live in the page's MAIN world; this isolated
  // script can't read them. We tag the element with a transient attribute, ask
  // inject.js to resolve the nearest React component, and merge the answer into the
  // picked-element context. The short timeout means a non-React page never stalls the
  // picker (inject.js just replies `react:null`, or nobody replies and we resolve null).
  const REACT_QUERY = '__tideReactQuery';
  const REACT_RESULT = '__tideReactResult';
  const REACT_ATTR = 'data-tc-react-probe';
  let reactSeq = 0;
  const reactPending = new Map(); // id -> settle fn
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d[REACT_RESULT] !== true) return;
    const settle = reactPending.get(d.id);
    if (settle) settle(d.react || null);
  });
  function resolveReact(el) {
    return new Promise((resolve) => {
      if (!el || el.nodeType !== 1) return resolve(null);
      const id = 'r' + ++reactSeq;
      let done = false;
      const settle = (val) => {
        if (done) return;
        done = true;
        reactPending.delete(id);
        try {
          el.removeAttribute(REACT_ATTR);
        } catch (_e) {
          /* ignore */
        }
        resolve(val || null);
      };
      reactPending.set(id, settle);
      try {
        el.setAttribute(REACT_ATTR, '1');
        window.postMessage({ [REACT_QUERY]: true, id }, '*');
      } catch (_e) {
        return settle(null);
      }
      setTimeout(() => settle(null), 250); // non-React pages / no responder → give up fast
    });
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
      // Live form-control state (value/checked/selected/disabled) — present only for
      // input/textarea/select, so reads don't need `evaluate`.
      field: fieldState(el),
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
    // Build the DOM context first (so the transient probe attr never lands in
    // outerHTML), then ask the MAIN world which React component owns the element.
    const ctx = buildContext(el);
    resolveReact(el).then((react) => {
      if (react) ctx.react = react;
      try {
        toBg({ type: 'elementPicked', context: ctx });
      } catch (_e) {
        /* ignore */
      }
    });
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
  function tcFindByText(text, root) {
    const t = String(text);
    const scope = root || document;
    const els = Array.prototype.slice.call(
      scope.querySelectorAll('button,a,[role="button"],[role="option"],[role="menuitem"],input[type="submit"],input[type="button"],summary,label,li,span,div'),
    );
    return (
      els.find((e) => tcText(e) === t) ||
      els.find((e) => tcText(e).toLowerCase() === t.toLowerCase()) ||
      els.find((e) => tcText(e).toLowerCase().includes(t.toLowerCase())) ||
      null
    );
  }
  // Scope root for a drive target. `within` (a CSS selector) confines selector/text
  // matching to that subtree — so a "BBVA" row in a background transactions table can't
  // steal a click meant for the open modal/menu. Returns null when `within` is set but
  // not yet present, so tcWaitFor keeps polling until the modal/menu mounts.
  function tcScopeRoot(args) {
    if (args && args.within) return document.querySelector(args.within);
    return document;
  }
  function tcResolve(args) {
    const root = tcScopeRoot(args);
    if (!root) return null;
    if (args.selector) return root.querySelector(args.selector);
    if (args.text) return tcFindByText(args.text, root);
    return null;
  }
  // Human-readable "what we were looking for" — turns a bare timeout into an
  // actionable error so the agent re-lists instead of guessing/screenshotting.
  function tcResolveDesc(args) {
    const scope = args && args.within ? ' within "' + args.within + '"' : '';
    if (args && args.selector) return 'no element matches selector "' + args.selector + '"' + scope;
    if (args && args.text) return 'no element matches text "' + args.text + '"' + scope;
    return 'no element (no selector/text given)';
  }
  function tcWaitFor(pred, timeoutMs, label) {
    return new Promise((resolve, reject) => {
      const ms = Math.min(Number(timeoutMs) || 8000, 30000);
      const deadline = Date.now() + ms;
      (function poll() {
        let v;
        try {
          v = pred();
        } catch (_e) {
          v = null;
        }
        if (v) return resolve(v);
        if (Date.now() > deadline) {
          // Name the missing selector + nudge toward /dom {actionable:true}; bare
          // "timed out" gave the agent no way to recover (it re-guessed for ~30s).
          return reject(new Error(label ? label + ' (waited ' + Math.round(ms / 1000) + 's) — re-list current elements with /dom {actionable:true}' : 'timed out'));
        }
        setTimeout(poll, 150);
      })();
    });
  }
  async function tcMouse(el) {
    const r = el.getBoundingClientRect();
    // Click point = element centre, clamped into the viewport (an element scrolled to the
    // edge still gets a sane, on-screen hit point).
    const cx = Math.max(1, Math.min(r.left + r.width / 2, (window.innerWidth || r.right || 1) - 1));
    const cy = Math.max(1, Math.min(r.top + r.height / 2, (window.innerHeight || r.bottom || 1) - 1));
    // Glide the visible "robot cursor" to the point first (so the user watches it travel
    // like a hand-moved mouse), then pulse the click ring as the events fire.
    await tcCursorMoveTo(cx, cy);
    tcCursorClick(cx, cy);
    // Hit-test like a REAL click: dispatch to the topmost painted element at that point
    // when it's our target (or a descendant/ancestor of it). This lands the event on the
    // actual visual surface — so widgets that listen on an inner node, or a control
    // wrapping a tiny input, fire the same way a user's click would. If something
    // UNRELATED covers the point (an overlay/backdrop), fall back to the resolved element.
    // (Synthetic events are always isTrusted:false — only the chrome.debugger drive path
    // produces trusted OS-level clicks; this is the best the content-script driver can do.)
    let target = el;
    try {
      const hit = document.elementFromPoint(cx, cy);
      if (hit && (hit === el || el.contains(hit) || hit.contains(el))) target = hit;
    } catch (_e) {
      /* detached */
    }
    const seq = [
      ['pointerover', 0],
      ['pointerenter', 0],
      ['mouseover', 0],
      ['mouseenter', 0],
      ['pointerdown', 1],
      ['mousedown', 1],
      ['pointerup', 0],
      ['mouseup', 0],
      ['click', 0],
    ];
    for (const [type, buttons] of seq) {
      const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: cx, clientY: cy, button: 0, buttons, detail: 1 };
      try {
        const isPtr = type.indexOf('pointer') === 0;
        target.dispatchEvent(isPtr ? new PointerEvent(type, Object.assign({ pointerId: 1, isPrimary: true, pointerType: 'mouse' }, o)) : new MouseEvent(type, o));
      } catch (_e) {
        try {
          target.dispatchEvent(new MouseEvent(type.replace('pointer', 'mouse'), o));
        } catch (_e2) {
          /* ignore */
        }
      }
    }
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
        const el = await tcWaitFor(() => tcResolve(args), args.timeoutMs, tcResolveDesc(args));
        el.scrollIntoView({ block: 'center' });
        return { ok: true };
      }
      case 'click': {
        const el = await tcWaitFor(() => tcResolve(args), args.timeoutMs, tcResolveDesc(args));
        el.scrollIntoView({ block: 'center' });
        // Do NOT pre-focus: let the mousedown sequence drive the element's own focus.
        // Widgets like react-select open their menu via mousedown → focusInput →
        // openAfterFocus → openMenu; pre-focusing sets isFocused=true first, so that
        // mousedown sees an already-focused control and SKIPS the open (the "click does
        // nothing / changed:false" bug). Glides the visible cursor, then dispatches.
        await tcMouse(el);
        try {
          if (typeof el.click === 'function') el.click();
        } catch (_e) {
          /* ignore */
        }
        // Focus fallback only if the sequence didn't already move focus into the target
        // (e.g. a plain button — synthetic events don't natively focus).
        try {
          if (typeof el.focus === 'function' && document.activeElement !== el && !(el.contains && el.contains(document.activeElement))) el.focus();
        } catch (_e) {
          /* ignore */
        }
        return { ok: true };
      }
      case 'hover': {
        const el = await tcWaitFor(() => tcResolve(args), args.timeoutMs, tcResolveDesc(args));
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        await tcCursorMoveTo(cx, cy); // show the cursor travel to the hovered element
        const o = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
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
        const el = await tcWaitFor(() => tcResolve(args), args.timeoutMs, tcResolveDesc(args));
        el.scrollIntoView({ block: 'center' });
        try {
          const r = el.getBoundingClientRect();
          tcCursorMoveTo(r.left + r.width / 2, r.top + r.height / 2); // show where we're typing (non-blocking)
        } catch (_e) {
          /* ignore */
        }
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
        const el = await tcWaitFor(() => tcResolve(args), args.timeoutMs, tcResolveDesc(args));
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

  // ── on-page "agent can control this tab" indicator ─────────────────────────
  // Shown whenever this tab's 🤖 drive toggle is ON, so the user always knows an
  // agent may click/type/navigate here. Lives in a shadow root (isolated styles)
  // with a hover tooltip explaining what it is and how to turn it off.
  const TC_DRIVE_BADGE_ID = 'tc-drive-indicator';
  function showDriveBadge() {
    if (window.top !== window) return; // top frame only
    if (document.getElementById(TC_DRIVE_BADGE_ID)) return;
    const host = document.createElement('div');
    host.id = TC_DRIVE_BADGE_ID;
    host.setAttribute('data-tc-ignore', '1'); // not a page element; ignore in picker/recorder
    host.style.cssText = 'position:fixed;z-index:2147483647;bottom:14px;right:14px;margin:0;padding:0;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      '.chip{position:relative;display:flex;align-items:center;gap:6px;font:600 12px/1.2 system-ui,-apple-system,sans-serif;' +
      'color:#fff;background:#16a34a;border:1px solid #22c55e;border-radius:999px;padding:6px 11px;' +
      'box-shadow:0 2px 12px rgba(0,0,0,.35);cursor:help;user-select:none;white-space:nowrap;}' +
      '.dot{width:8px;height:8px;border-radius:50%;background:#bbf7d0;box-shadow:0 0 6px #bbf7d0;animation:tcpulse 1.6s ease-in-out infinite;}' +
      '@keyframes tcpulse{0%,100%{opacity:1}50%{opacity:.3}}' +
      '.tip{position:absolute;bottom:135%;right:0;width:258px;white-space:normal;background:#0b0f1a;color:#e5e7eb;' +
      'border:1px solid #334155;border-radius:8px;padding:10px 12px;font:400 11.5px/1.5 system-ui,sans-serif;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.5);opacity:0;visibility:hidden;transform:translateY(4px);transition:opacity .12s,transform .12s;pointer-events:none;}' +
      '.chip:hover .tip{opacity:1;visibility:visible;transform:translateY(0);}' +
      '.tip b{color:#fff;}' +
      '</style>' +
      '<div class="chip" role="status" aria-label="Tide Commander puede controlar esta pestaña">' +
      '<span class="dot"></span>🤖 Agente puede controlar esta pestaña' +
      '<div class="tip"><b>Tide Commander</b> tiene permiso para <b>manipular esta pestaña</b> ' +
      '(click, escritura y navegación) a través de la extensión.<br><br>' +
      'Para <b>desactivarlo</b>: abre el panel lateral de Tide Commander y apaga el toggle ' +
      '<b>🤖 drive</b> de esta pestaña.</div></div>';
    (document.body || document.documentElement).appendChild(host);
  }
  function hideDriveBadge() {
    const el = document.getElementById(TC_DRIVE_BADGE_ID);
    if (el) el.remove();
  }

  // ── fake "robot cursor" (visual feedback) ──────────────────────────────────
  // A pointer-events:none overlay arrow that GLIDES to each target's coordinates and
  // pulses a ring on click, so the user can WATCH the agent act like a human moving a
  // mouse. Lives in a shadow root, ignored by the picker/diff (data-tc-ignore), and is
  // transparent to elementFromPoint (pointer-events:none) so it never affects hit-testing.
  const TC_CURSOR_ID = 'tc-agent-cursor';
  let tcCursorPos = null; // {x,y} last viewport position (so it glides FROM where it was)
  let tcCursorFadeTimer = null;
  function tcCursorEls() {
    if (window.top !== window) return null; // top frame only
    const existing = document.getElementById(TC_CURSOR_ID);
    if (existing && existing.__tc) return existing.__tc;
    const host = document.createElement('div');
    host.id = TC_CURSOR_ID;
    host.setAttribute('data-tc-ignore', '1');
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;margin:0;padding:0;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      '.curpos,.ringpos{position:fixed;left:0;top:0;transform:translate(-9999px,-9999px);will-change:transform;pointer-events:none;}' +
      '.curpos{transition:transform .2s cubic-bezier(.22,1,.36,1);}' +
      '.cur{position:relative;margin:-2px 0 0 -3px;width:23px;height:23px;opacity:0;transition:opacity .25s;filter:drop-shadow(0 1px 2px rgba(0,0,0,.55));}' +
      '.cur.show{opacity:1;}' +
      '.cur svg{display:block;transition:transform .12s;}' +
      '.cur.press svg{transform:scale(.8);}' +
      '.ring{width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;border:2px solid #22d3ee;opacity:0;transform:scale(.2);}' +
      '.ring.click{animation:tcclick .45s ease-out;}' +
      '@keyframes tcclick{0%{opacity:.85;transform:scale(.2);}100%{opacity:0;transform:scale(1.75);}}' +
      '</style>' +
      '<div class="curpos"><div class="cur"><svg viewBox="0 0 24 24" width="23" height="23">' +
      '<path d="M5 3l13.6 7.9-5.8 1.3L9.4 18.8 5 3z" fill="#fff" stroke="#0b1220" stroke-width="1.3" stroke-linejoin="round"/></svg></div></div>' +
      '<div class="ringpos"><div class="ring"></div></div>';
    host.__tc = {
      host,
      root,
      curpos: root.querySelector('.curpos'),
      cur: root.querySelector('.cur'),
      ringpos: root.querySelector('.ringpos'),
      ring: root.querySelector('.ring'),
    };
    (document.body || document.documentElement).appendChild(host);
    return host.__tc;
  }
  function tcCursorScheduleFade(els) {
    if (tcCursorFadeTimer) clearTimeout(tcCursorFadeTimer);
    tcCursorFadeTimer = setTimeout(() => {
      try {
        els.cur.classList.remove('show');
      } catch (_e) {
        /* gone */
      }
    }, 2600);
  }
  // Glide the cursor to (x,y); resolves after the (distance-scaled) animation so a click
  // can wait for the cursor to arrive. No-op (resolves immediately) outside the top frame.
  function tcCursorMoveTo(x, y) {
    return new Promise((resolve) => {
      // On a hidden/background tab the cursor isn't visible AND its setTimeout is throttled
      // to ~1s — which would add ~1s to every click. Skip it entirely so background driving
      // stays fast.
      if (document.hidden) return resolve();
      let els = null;
      try {
        els = tcCursorEls();
      } catch (_e) {
        /* ignore */
      }
      if (!els) return resolve();
      const first = !tcCursorPos;
      if (first) tcCursorPos = { x: (window.innerWidth || 800) / 2, y: (window.innerHeight || 600) / 2 };
      const dx = x - tcCursorPos.x;
      const dy = y - tcCursorPos.y;
      const dur = Math.max(120, Math.min(Math.round(Math.sqrt(dx * dx + dy * dy) / 2.2), 420));
      try {
        if (first) {
          // Place instantly at the start point so the first move glides from there, not
          // from the off-screen (-9999) parking spot.
          els.curpos.style.transitionDuration = '0ms';
          els.curpos.style.transform = 'translate(' + tcCursorPos.x + 'px,' + tcCursorPos.y + 'px)';
          void els.curpos.offsetWidth; // reflow so the next change animates
        }
        els.curpos.style.transitionDuration = dur + 'ms';
        els.curpos.style.transform = 'translate(' + x + 'px,' + y + 'px)';
        els.cur.classList.add('show');
        tcCursorScheduleFade(els);
      } catch (_e) {
        /* ignore */
      }
      tcCursorPos = { x, y };
      setTimeout(resolve, dur + 20);
    });
  }
  // Ripple pulse + brief press at (x,y) to mark a click.
  function tcCursorClick(x, y) {
    if (document.hidden) return; // no visible cursor on a background tab
    let els = null;
    try {
      els = tcCursorEls();
    } catch (_e) {
      return;
    }
    if (!els) return;
    try {
      els.ringpos.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      els.ring.classList.remove('click');
      void els.ring.offsetWidth; // reflow → restart the keyframe
      els.ring.classList.add('click');
      els.cur.classList.add('show', 'press');
      setTimeout(() => {
        try {
          els.cur.classList.remove('press');
        } catch (_e) {
          /* ignore */
        }
      }, 150);
    } catch (_e) {
      /* ignore */
    }
  }

  // ── per-action DOM diff (MutationObserver) ─────────────────────────────────
  // When a drive command is sent with diff:true, the side panel asks us to record
  // DOM mutations around the action and summarize what changed. Path-agnostic: the
  // observer watches the real DOM, so it captures both content-script- and
  // chrome.debugger-driven changes. tcDiffStart (before the action) → tcDiffCollect
  // (after; waits for mutations to settle, then summarizes with noise filtering).
  let tcDiffObserver = null;
  let tcDiffRecords = [];
  let tcDiffLast = 0;
  function tcDiffStop() {
    if (tcDiffObserver) {
      try {
        tcDiffObserver.disconnect();
      } catch (_e) {
        /* ignore */
      }
    }
    tcDiffObserver = null;
  }
  function tcDiffStart(rootSel) {
    tcDiffStop();
    tcDiffRecords = [];
    tcDiffLast = Date.now();
    const target = (rootSel && document.querySelector(rootSel)) || document.documentElement;
    tcDiffObserver = new MutationObserver((recs) => {
      for (const r of recs) tcDiffRecords.push(r);
      tcDiffLast = Date.now();
    });
    tcDiffObserver.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      characterData: true,
      characterDataOldValue: true,
    });
  }
  async function tcDiffCollect(settleMs, maxMs, verbose) {
    if (!tcDiffObserver) return { ok: false, error: 'no diff session' };
    settleMs = Math.min(Math.max(Number(settleMs) || 350, 80), 2500);
    maxMs = Math.min(Math.max(Number(maxMs) || 3000, settleMs + 200), 8000);
    const deadline = Date.now() + maxMs;
    // Wait until the DOM has been quiet for settleMs (async effects landed), or maxMs.
    for (;;) {
      const pending = tcDiffObserver.takeRecords();
      if (pending.length) {
        for (const r of pending) tcDiffRecords.push(r);
        tcDiffLast = Date.now();
      }
      if (Date.now() - tcDiffLast >= settleMs) break;
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 60));
    }
    const records = tcDiffRecords.slice();
    const settled = Date.now() <= deadline;
    tcDiffStop();
    tcDiffRecords = [];
    return { ok: true, diff: tcSummarizeMutations(records, settled, !!verbose) };
  }
  function tcDiffIgnored(node) {
    if (!node || node.nodeType !== 1) return true; // elements only for add/remove
    let el = node;
    while (el) {
      if (el.id === TC_DRIVE_BADGE_ID) return true;
      if (el.getAttribute && el.getAttribute('data-tc-ignore') != null) return true;
      el = el.parentElement;
    }
    return false;
  }
  // Added/removed nodes that are pure presentational churn — never actionable, so
  // they're dropped from the diff. Without this, every `type` into a Material-style
  // field surfaces an added `<span class="label">` (the floating label animating in),
  // and other extensions (DarkReader) + app chrome (loading bars, spinners) inject
  // nodes that drowned the real signal in the m17ea3ui run.
  function tcAddNoise(n) {
    if (!n || n.nodeType !== 1) return false; // non-elements handled by tcDiffIgnored
    const tag = n.tagName;
    if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'LINK' || tag === 'TEMPLATE') return true;
    const cl = n.classList;
    if (!cl || !cl.length) return false;
    const has = (re) => Array.prototype.some.call(cl, (c) => re.test(c));
    if (has(/^darkreader/)) return true; // DarkReader injected style/wrapper
    if (tag === 'SPAN' && cl.contains('label')) return true; // floating field label
    if (has(/^(LoadingTopBar|loading-bar|skeleton|spinner|ripple|backdrop)$/)) return true;
    return false;
  }
  // Compact HTML for a diff node: drop <svg>/<style> bulk + collapse whitespace, then
  // truncate. Lets the agent see WHAT was added/removed (a modal's fields, an error
  // block's markup) without a follow-up /dom read.
  function tcBriefHtml(el, cap) {
    let h = String((el && el.outerHTML) || '');
    h = h
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '<svg/>')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return h.length > cap ? h.slice(0, cap) + '…' : h;
  }
  function tcNodeBrief(el, verbose, withHtml, withActions) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '?';
    const id = el.id || '';
    const cls = el.classList ? Array.prototype.slice.call(el.classList).slice(0, 3) : [];
    const o = {
      tag,
      id,
      classes: cls,
      selector: tag + (id ? '#' + id : '') + (cls.length ? '.' + cls.join('.') : ''),
      text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
    };
    // html on added/removed nodes (the signal the user wants); skipped for attr-target
    // briefs (withHtml=false) where only `.selector` is read.
    if (verbose) o.html = tcBriefHtml(el, 600);
    else if (withHtml) o.html = tcBriefHtml(el, 400);
    // Interactive descendants of an ADDED container (a modal's fields, a menu's options,
    // a dialog's buttons) — `{selector, text, type?…}` — so the agent can act on what just
    // appeared WITHOUT a follow-up /dom {actionable:true} read or guessing a selector.
    // Generic: any container that mounts (dialog/menu/list/popover/wizard step).
    if (withActions) {
      try {
        const a = collectActionable(el, 8);
        if (a.items.length) {
          o.actions = a.items.map((it) => {
            const r = { selector: it.selector };
            if (it.text) r.text = it.text;
            if (it.type) r.type = it.type;
            if (it.placeholder) r.placeholder = it.placeholder;
            if (it.disabled) r.disabled = true;
            return r;
          });
          if (a.total > a.items.length) o.actionsTruncated = a.total - a.items.length;
        }
      } catch (_e) {
        /* detached */
      }
    }
    return o;
  }
  // A short label for a container (modal/dialog): prefer a heading so we get
  // "Nueva transacción" instead of the whole concatenated innerText.
  function tcLabel(el) {
    try {
      const h = el.querySelector && el.querySelector('h1,h2,h3,h4,h5,[class*="title"],[class*="header"],legend');
      const t = ((h && (h.innerText || h.textContent)) || el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      return t.slice(0, 48);
    } catch (_e) {
      return '';
    }
  }
  // Only these attribute changes carry signal; everything else (style, transform,
  // most aria, framework bookkeeping) is dropped as noise. `class` is handled
  // separately as a token-diff filtered to stateful tokens.
  const TC_ATTR_KEEP = /^(disabled|value|checked|selected|open|hidden|readonly|required|placeholder|aria-invalid|aria-expanded|aria-checked|aria-selected|aria-disabled|aria-pressed)$/;
  const TC_CLASS_STATE = /(invalid|error|disabled|selected|active|open|show|hidden|success|warn|danger|loading|expanded|collapsed|required|dirty|touched|checked|empty|filled)/i;
  // react-select internals. A dropdown interaction renders a soup of framework nodes
  // (menu/option/placeholder/control/single-value) + attr churn (aria-expanded, class,
  // value) — the m17ea3ui diffs that the user flagged as worthless context were ALL
  // this. The only signal a driver needs is "what got selected", so we fold the whole
  // interaction into one summary line ("seleccionó: X") and drop the verbose nodes/attrs.
  const TC_RS_ANY = /(^|\s)(tide-)?react-select__/;
  const TC_RS_SINGLE = /(^|\s)(tide-)?react-select__single-value/;
  const TC_RS_MENU = /(^|\s)(tide-)?react-select__menu(\s|$)/;
  const TC_RS_OPTION = /(^|\s)(tide-)?react-select__option/;
  const TC_RS_NOOPT = /react-select__menu-notice--no-options/;
  function tcRsCls(n) {
    return n && n.classList ? ' ' + Array.prototype.join.call(n.classList, ' ') : '';
  }
  function tcIsRs(n) {
    return n && n.nodeType === 1 && TC_RS_ANY.test(tcRsCls(n));
  }
  function tcSummarizeMutations(records, settled, verbose) {
    const addedSet = new Set();
    const removedSet = new Set();
    const attrMap = new Map(); // selector|attr -> change
    let attrRaw = 0; // total attribute mutations seen (incl. noise) for honesty
    const textChanges = [];
    let textRaw = 0;
    let rsSelected = null; // react-select chosen value text (→ "seleccionó: X")
    let rsMenu = false; // a react-select menu opened/filtered (added option/menu nodes)
    let rsFiltered = false; // a react-select filter NARROWED an open menu (removed options only)
    let rsNoOpt = false; // react-select showed "no options"
    const rsOpts = new Set(); // option labels surfaced when a menu opens/filters
    const tcText1 = (n) => (n.innerText || n.textContent || '').trim().replace(/\s+/g, ' ');
    for (const r of records) {
      if (r.type === 'childList') {
        for (const n of r.addedNodes) {
          if (tcDiffIgnored(n) || tcAddNoise(n)) continue;
          if (verbose ? false : tcIsRs(n)) {
            const cls = tcRsCls(n);
            // The MENU (and standalone options while typing filters) carry real signal —
            // keep them in `added` so their compact html lists what's selectable. The
            // chosen value (single-value) folds to "seleccionó: X", and the pure chrome
            // (control/placeholder/indicators/input wrappers) is dropped.
            if (TC_RS_MENU.test(cls)) {
              rsMenu = true;
              try {
                (n.querySelectorAll('[class*="react-select__option"],[role="option"]') || []).forEach((o) => {
                  const t = tcText1(o);
                  if (t) rsOpts.add(t.slice(0, 40));
                });
              } catch (_e) {
                /* detached */
              }
              addedSet.add(n); // options collapse into this node → one html-carrying entry
              continue;
            }
            if (TC_RS_OPTION.test(cls)) {
              rsMenu = true; // incremental option add (typing filters the list)
              const t = tcText1(n);
              if (t) rsOpts.add(t.slice(0, 40));
              addedSet.add(n); // collapses into the menu node when nested
              continue;
            }
            if (TC_RS_SINGLE.test(cls)) rsSelected = tcText1(n).slice(0, 48) || rsSelected || '';
            else if (TC_RS_NOOPT.test(cls)) rsNoOpt = true;
            continue; // single-value / no-options / chrome → folded into summary, not listed
          }
          addedSet.add(n);
        }
        for (const n of r.removedNodes) {
          if (tcDiffIgnored(n) || tcAddNoise(n)) continue;
          if (!verbose && tcIsRs(n)) {
            // Typing into an OPEN react-select filters by REMOVING the non-matching
            // options (it doesn't add new ones), so a pure-removal diff would read
            // `changed:false` and hide that the filter took. Flag it → the summary
            // re-reads the live menu's remaining options. A removed MENU container is a
            // close, not a filter, so only option removals set the flag.
            if (TC_RS_OPTION.test(tcRsCls(n))) rsFiltered = true;
            continue;
          }
          removedSet.add(n);
        }
      } else if (r.type === 'attributes') {
        attrRaw++;
        const name = r.attributeName;
        if (name === 'style' && !verbose) continue; // pure layout/animation noise
        if (tcDiffIgnored(r.target)) continue;
        if (!verbose && tcIsRs(r.target)) continue; // react-select control/input attr churn → noise
        const brief = tcNodeBrief(r.target, false);
        let cur = null;
        try {
          cur = r.target.getAttribute ? r.target.getAttribute(name) : null;
        } catch (_e) {
          /* detached */
        }
        if (name === 'class') {
          const oldC = new Set(String(r.oldValue || '').split(/\s+/).filter(Boolean));
          const newC = new Set(String(cur || '').split(/\s+/).filter(Boolean));
          let add = [...newC].filter((c) => !oldC.has(c));
          let rem = [...oldC].filter((c) => !newC.has(c));
          if (!verbose) {
            add = add.filter((c) => TC_CLASS_STATE.test(c));
            rem = rem.filter((c) => TC_CLASS_STATE.test(c));
          }
          if (!add.length && !rem.length) continue; // only structural/focus churn → skip
          attrMap.set(brief.selector + '|class', { selector: brief.selector, attr: 'class', add: add.join(' ') || undefined, remove: rem.join(' ') || undefined });
        } else if (verbose || TC_ATTR_KEEP.test(name)) {
          // react-select binds the chosen object onto a hidden input's value, which
          // stringifies to "[object Object]" — never useful signal (the "seleccionó: X"
          // summary already carries the choice). Drop it.
          if (!verbose && (cur === '[object Object]' || r.oldValue === '[object Object]')) continue;
          attrMap.set(brief.selector + '|' + name, { selector: brief.selector, attr: name, old: r.oldValue, new: cur });
        }
        // else: noise attribute → dropped
      } else if (r.type === 'characterData') {
        const parent = r.target && r.target.parentElement;
        if (!parent || tcDiffIgnored(parent)) continue;
        const nv = ((r.target && r.target.data) || '').trim();
        const ov = String(r.oldValue || '').trim();
        if (nv === ov || (nv.length < 2 && ov.length < 2)) continue; // whitespace/no-op
        textRaw++;
        if (textChanges.length < (verbose ? 10 : 3)) {
          textChanges.push({ selector: tcNodeBrief(parent, false).selector, old: ov.slice(0, 60), new: nv.slice(0, 60) });
        }
      }
    }
    // Collapse: drop an added/removed node when an ancestor is also in the set.
    const collapse = (set) => {
      const arr = Array.from(set);
      return arr.filter((n) => !arr.some((o) => o !== n && o.contains && o.contains(n)));
    };
    const addedArr = collapse(addedSet);
    const removedArr = collapse(removedSet);
    const NCAP = verbose ? 25 : 10;
    const ACAP = verbose ? 30 : 12;
    const added = addedArr.slice(0, NCAP).map((n) => tcNodeBrief(n, verbose, true, true)); // html + interactive children
    const removed = removedArr.slice(0, NCAP).map((n) => tcNodeBrief(n, verbose, true)); // html only — can't act on a removed node
    const attrs = Array.from(attrMap.values()).slice(0, ACAP);
    // Best-effort semantic summary — deduped (a Set), with modal headings as labels.
    const summarySet = new Set();
    const isModal = (n) => n.tagName === 'DIALOG' || /(^|[^a-z])(modal|dialog|overlay)([^a-z]|$)/i.test(n.className || '');
    const isToast = (n) => n.tagName === 'OUTPUT' || /(toast|snackbar|notif|alert)/i.test(n.className || '');
    for (const n of addedArr) {
      if (isModal(n)) summarySet.add('abrió modal/diálogo' + (tcLabel(n) ? ': ' + tcLabel(n) : ''));
      else if (isToast(n)) summarySet.add('toast/alerta' + (tcLabel(n) ? ': ' + tcLabel(n) : ''));
    }
    for (const n of removedArr) if (isModal(n)) summarySet.add('cerró modal/diálogo');
    const rows = addedArr.filter((n) => /^(tr|li)$/i.test(n.tagName || '')).length;
    if (rows) summarySet.add('+' + rows + ' fila(s)/ítem(s)');
    for (const a of attrs) if (a.attr === 'disabled') summarySet.add((a.new == null ? 'habilitó ' : 'deshabilitó ') + a.selector);
    // react-select interaction → one concise line instead of the framework node soup.
    if (rsSelected != null) summarySet.add('seleccionó' + (rsSelected ? ': ' + rsSelected : ''));
    else if (rsNoOpt) summarySet.add('lista: sin resultados');
    else if (rsMenu) {
      const opts = Array.from(rsOpts);
      summarySet.add('abrió/filtró lista de opciones' + (opts.length ? ' (' + opts.length + '): ' + opts.slice(0, 8).join(', ') : ''));
    } else if (rsFiltered) {
      // Filter only removed options (no added nodes) → re-read the live menu so the diff
      // reports what's NOW selectable instead of a misleading changed:false. If the menu
      // is gone by settle (filtered then closed), emit nothing and let the diff collapse.
      let liveMenu = null;
      try {
        liveMenu = document.querySelector('[class*="react-select__menu"]');
      } catch (_e) {
        /* detached */
      }
      if (liveMenu) {
        try {
          liveMenu.querySelectorAll('[class*="react-select__option"],[role="option"]').forEach((o) => {
            const t = tcText1(o);
            if (t) rsOpts.add(t.slice(0, 40));
          });
        } catch (_e) {
          /* detached */
        }
        const opts = Array.from(rsOpts);
        summarySet.add('filtró lista de opciones' + (opts.length ? ' (' + opts.length + '): ' + opts.slice(0, 8).join(', ') : ''));
      }
    }
    // No meaningful change → collapse the empty {counts:0, added:[], …} skeleton (≈140
    // tokens of nothing) to a one-line marker. The "nothing happened" signal is kept
    // (useful: a click that should open a modal but didn't), the bloat is dropped.
    // `verbose` keeps the full shape. Note: an empty diff after a `type` into a plain
    // text field is NORMAL (React doesn't mutate the DOM for value changes) — it does
    // not mean the type failed; confirm a value via /dom's `field` instead.
    if (!verbose && !addedArr.length && !removedArr.length && !attrMap.size && !textRaw && !summarySet.size) {
      return { changed: false, settled };
    }
    const truncated = {
      added: Math.max(0, addedArr.length - added.length),
      removed: Math.max(0, removedArr.length - removed.length),
      attrs: Math.max(0, attrMap.size - attrs.length),
    };
    if (verbose) {
      // Firehose keeps the full shape incl. counts (with attrNoise) for debugging.
      const counts = { added: addedArr.length, removed: removedArr.length, attrs: attrMap.size, text: textRaw, attrNoise: attrRaw - attrMap.size };
      return { counts, summary: Array.from(summarySet), added, removed, attrs, text: textChanges, settled, truncated };
    }
    // Token-tight: NO `counts` (it just duplicates the array lengths + an internal
    // attrNoise metric nobody acts on). `summary` says what happened; the arrays carry
    // the detail (lengths are obvious); `truncated` reports anything capped. Arrays are
    // included ONLY when non-empty → a clean react-select pick is just
    // `{summary:["seleccionó: X"], settled}` and a modal open is summary + the one node.
    const out = {};
    if (summarySet.size) out.summary = Array.from(summarySet);
    if (added.length) out.added = added;
    if (removed.length) out.removed = removed;
    if (attrs.length) out.attrs = attrs;
    if (textChanges.length) out.text = textChanges;
    if (truncated.added || truncated.removed || truncated.attrs) out.truncated = truncated;
    out.settled = settled;
    return out;
  }

  // ── actionable elements (one-call "what can I click/type here") ──
  // A driver (esp. a weak model) otherwise burns several /dom reads guessing which
  // selector is the create button / which input is which. `getActionable` returns a
  // compact, DOM-ordered list of the interactive elements actually rendered — each
  // with a click-ready selector + its visible label + form state — so the agent picks
  // a target in ONE read instead of flailing (the m17ea3ui run took 4 reads to find
  // one button).
  const TC_ACTIONABLE_SEL =
    'button, a[href], input, textarea, select, summary, [contenteditable=""], [contenteditable="true"], ' +
    '[role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], ' +
    '[role="checkbox"], [role="radio"], [role="switch"], [role="option"], [role="combobox"], [tabindex]';
  function tcActionVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('[data-tc-ignore]') || el.id === TC_DRIVE_BADGE_ID) return false;
    if (el.nodeName === 'INPUT' && el.type === 'hidden') return false;
    let cs;
    try {
      cs = getComputedStyle(el);
    } catch (_e) {
      return false;
    }
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || parseFloat(cs.opacity || '1') === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  }
  function tcActionLabel(el) {
    const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (t) return t;
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const ref = document.getElementById(lb.split(/\s+/)[0]);
      const rt = ref && (ref.innerText || '').trim();
      if (rt) return rt;
    }
    // aria-describedby: react-select (and many custom widgets) point this at the visible
    // placeholder/label element that holds the field name while empty (e.g. the
    // `__placeholder` div "Cuenta de retiro") — so two unlabeled comboboxes become
    // distinguishable instead of both reading as a bare `#react-select-N-input`.
    const db = el.getAttribute('aria-describedby');
    if (db) {
      const ref = document.getElementById(db.split(/\s+/)[0]);
      const dt = ref && (ref.innerText || ref.textContent || '').trim();
      if (dt && dt.length <= 80) return dt;
    }
    if (el.id) {
      try {
        const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        const lt = lab && (lab.innerText || '').trim();
        if (lt) return lt;
      } catch (_e) {
        /* bad id */
      }
    }
    const wrap = el.closest && el.closest('label');
    const wt = wrap && (wrap.innerText || '').trim();
    if (wt) return wt;
    // Custom widgets whose label is a sibling/ancestor element, not a <label for> or
    // aria ref: scan the nearest field-group wrapper for a label-ish element. Generic
    // across form frameworks (Material, react-select, Ant, custom field components).
    try {
      const grp = el.closest && el.closest('[class*="field" i],[class*="Field"],[class*="form-group" i],[class*="control" i]');
      if (grp) {
        const lab = grp.querySelector('label,legend,[class*="label" i]');
        const gt = lab && lab !== el && !lab.contains(el) && (lab.innerText || lab.textContent || '').trim();
        if (gt && gt.length <= 80) return gt;
      }
    } catch (_e) {
      /* bad selector engine */
    }
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) return ph.trim();
    const nm = el.getAttribute('name');
    if (nm && nm.trim()) return nm.trim();
    return '';
  }
  function tcActionBrief(el) {
    const tag = el.nodeName.toLowerCase();
    const o = { tag, selector: cssPath(el) };
    const role = el.getAttribute('role');
    if (role) o.role = role;
    const label = tcActionLabel(el);
    if (label) o.text = label.slice(0, 80);
    const fs = fieldState(el);
    if (fs) {
      o.type = fs.type;
      const ph = el.getAttribute('placeholder');
      if (ph) o.placeholder = ph.slice(0, 60);
      if (fs.value) o.value = String(fs.value).slice(0, 60);
      if (fs.selectedText) o.selectedText = String(fs.selectedText).slice(0, 60);
      if (typeof fs.checked === 'boolean') o.checked = fs.checked;
      if (fs.disabled) o.disabled = true;
    } else {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') o.disabled = true;
      const href = tag === 'a' ? el.getAttribute('href') : null;
      if (href) o.href = href.slice(0, 100);
    }
    return o;
  }
  function collectActionable(root, limit) {
    let all = Array.from(root.querySelectorAll(TC_ACTIONABLE_SEL));
    if (root.matches && root.matches(TC_ACTIONABLE_SEL)) all.unshift(root);
    // tabindex="-1" isn't keyboard/click actionable on its own — keep only when it
    // also carries an interactive tag/role (already matched by the rest of the list).
    all = all.filter((el) => el.getAttribute('tabindex') !== '-1' || el.matches('button, a[href], input, textarea, select, summary, [role]'));
    const visible = all.filter(tcActionVisible);
    // Drop nested interactives: keep the OUTERMOST clickable (the button/link target),
    // not the spans/icons inside it — that's what you'd actually click.
    const outer = visible.filter((el) => !visible.some((o) => o !== el && o.contains(el)));
    const items = outer.slice(0, limit).map(tcActionBrief);
    return { items, total: outer.length };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'tcDiffStart') {
      try {
        tcDiffStart(msg.root || null);
        sendResponse && sendResponse({ ok: true });
      } catch (e) {
        sendResponse && sendResponse({ ok: false, error: (e && e.message) || String(e) });
      }
      return true;
    }
    if (msg.type === 'tcDiffCollect') {
      tcDiffCollect(msg.settleMs, msg.maxMs, msg.verbose).then(
        (r) => sendResponse(r),
        (e) => sendResponse({ ok: false, error: (e && e.message) || String(e) }),
      );
      return true;
    }
    if (msg.type === 'tcDriveIndicator') {
      if (msg.on) showDriveBadge();
      else hideDriveBadge();
      sendResponse && sendResponse({ ok: true });
      return;
    }
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
      if (!lastContextEl) {
        sendResponse({ context: null });
        return true;
      }
      const ctx = buildContext(lastContextEl);
      resolveReact(lastContextEl).then((react) => {
        if (react) ctx.react = react;
        sendResponse({ context: ctx });
      });
      return true; // async — keep the message channel open for sendResponse
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
    if (msg.type === 'getActionable') {
      // Bridge read: list the interactive elements rendered under `selector` (or the
      // whole page), each with a click-ready selector + label + form state.
      try {
        const root = msg.selector ? document.querySelector(msg.selector) : document.body;
        if (!root) {
          sendResponse({ ok: false, error: 'no element matches ' + (msg.selector || 'body') });
          return true;
        }
        const limit = Math.min(Math.max(1, msg.limit || 60), 200);
        const { items, total } = collectActionable(root, limit);
        sendResponse({ ok: true, actionable: items, count: total, truncated: Math.max(0, total - items.length) });
      } catch (e) {
        sendResponse({ ok: false, error: (e && e.message) || 'getActionable failed' });
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
    // Restore the drive indicator if this tab's 🤖 toggle is still on (the background
    // knows our tabId; we can't read it here). A reload re-injects this script, so
    // this re-shows the badge on every navigation while drive stays enabled.
    try {
      chrome.runtime.sendMessage({ type: 'tcDriveQuery' }, (resp) => {
        void chrome.runtime.lastError;
        if (resp && resp.on) showDriveBadge();
      });
    } catch (_e) {
      /* ignore */
    }
  }
})();
