/**
 * inject.js — runs in the page's MAIN world at document_start.
 *
 * It patches fetch / XMLHttpRequest / console.error and listens for global
 * error + unhandledrejection events, then forwards a compact record to the
 * ISOLATED-world content script via window.postMessage. The content script
 * relays it to the background service worker.
 *
 * MAIN world is required: patching window.fetch from an isolated content script
 * does NOT affect the fetch the page actually calls. Keep this file dependency
 * free and defensive — it must never break the host page.
 */
(() => {
  if (window.__tideErrorTriggerInstalled) return;
  window.__tideErrorTriggerInstalled = true;

  const MARK = '__tideErrorTrigger';

  // Benign browser-internal notices that surface through window 'error' but are
  // not real exceptions: they carry no Error object and no script origin. The
  // canonical case is the ResizeObserver loop notice, which the browser fires
  // whenever a resize callback triggers another layout pass — it simply defers
  // the remaining notifications to the next frame and nothing actually breaks.
  // Forwarding these would spam agents with non-actionable noise, so drop them.
  const IGNORED_ERROR_RE =
    /resizeobserver loop (completed with undelivered notifications|limit exceeded)/i;

  function post(data) {
    try {
      window.postMessage(
        {
          [MARK]: true,
          payload: {
            ...data,
            pageUrl: location.href,
            ts: Date.now(),
            ua: navigator.userAgent,
          },
        },
        '*',
      );
    } catch (_e) {
      /* never throw into the page */
    }
  }

  function stringifyArg(a) {
    try {
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack || ''}`;
      if (typeof a === 'string') return a;
      if (typeof a === 'object') return JSON.stringify(a);
      return String(a);
    } catch (_e) {
      return String(a);
    }
  }

  function reqUrl(input) {
    try {
      if (typeof input === 'string') return input;
      if (input && typeof input === 'object') return input.url || String(input);
      return String(input);
    } catch (_e) {
      return '';
    }
  }

  // Cap captured bodies so a huge payload never bloats storage / the brief.
  const BODY_MAX = 4000;
  function clip(s) {
    const str = String(s == null ? '' : s);
    return str.length > BODY_MAX ? str.slice(0, BODY_MAX) + `…(+${str.length - BODY_MAX} more chars)` : str;
  }
  // Best-effort: turn a request body (fetch init.body / xhr.send arg) into text.
  // Streaming / opaque bodies are summarized rather than read (can't be re-read).
  function bodyToText(body) {
    try {
      if (body == null || body === '') return undefined;
      if (typeof body === 'string') return clip(body);
      if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return clip(body.toString());
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        const parts = [];
        for (const [k, v] of body.entries()) parts.push(`${k}=${typeof v === 'string' ? v : '[file]'}`);
        return clip(parts.join('&'));
      }
      if (typeof Blob !== 'undefined' && body instanceof Blob) return `[Blob ${body.type || ''} ${body.size}b]`;
      if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return `[ArrayBuffer ${body.byteLength}b]`;
      return undefined; // ReadableStream / unknown — skip
    } catch (_e) {
      return undefined;
    }
  }
  // Read an XHR response body without throwing (responseText is only legal for
  // '' | 'text' response types; json is stringified, anything else summarized).
  function xhrResponseText(xhr) {
    try {
      const rt = xhr.responseType;
      if (rt === '' || rt === 'text') return clipNet(xhr.responseText);
      if (rt === 'json') return clipNet(JSON.stringify(xhr.response));
      return rt ? `[responseType=${rt}]` : undefined;
    } catch (_e) {
      return undefined;
    }
  }

  // ── full network log (every request, not just errors) ──
  // Network records flow on a separate `channel:'network'` so the error pipeline
  // is untouched. Bodies get a larger cap here since the user inspects them.
  const NET_BODY_MAX = 16000;
  function clipNet(s) {
    const str = String(s == null ? '' : s);
    return str.length > NET_BODY_MAX ? str.slice(0, NET_BODY_MAX) + `…(+${str.length - NET_BODY_MAX} more chars)` : str;
  }
  // Only read textual responses as text; binary/opaque ones are summarized so we
  // never stringify an image/font/wasm blob into the log.
  const TEXTUAL_CT = /(json|text|xml|html|javascript|ecmascript|x-www-form-urlencoded|csv|graphql|plain|yaml)/i;
  const isTextual = (ct) => !ct || TEXTUAL_CT.test(ct);
  function headersToObj(h) {
    const out = {};
    try {
      if (!h) return out;
      if (typeof Headers !== 'undefined' && h instanceof Headers) {
        for (const [k, v] of h.entries()) out[k] = v;
      } else if (Array.isArray(h)) {
        for (const pair of h) if (pair && pair.length >= 2) out[pair[0]] = String(pair[1]);
      } else if (typeof h === 'object') {
        for (const k of Object.keys(h)) out[k] = String(h[k]);
      }
    } catch (_e) {
      /* ignore */
    }
    return out;
  }
  function parseRawHeaders(raw) {
    const out = {};
    try {
      String(raw || '')
        .trim()
        .split(/[\r\n]+/)
        .forEach((line) => {
          const i = line.indexOf(':');
          if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
        });
    } catch (_e) {
      /* ignore */
    }
    return out;
  }
  let netSeq = 0;
  function postNet(rec) {
    post({ ...rec, channel: 'network', netId: 'n' + ++netSeq + '_' + Date.now() });
  }

  // ── fetch ──
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (...args) {
      const url = reqUrl(args[0]);
      const init = args[1];
      const method = (
        (init && init.method) ||
        (args[0] && typeof args[0] === 'object' && args[0].method) ||
        'GET'
      ).toUpperCase();
      const requestBody = bodyToText(init && init.body);
      const reqHeaders = {
        ...headersToObj(args[0] && typeof args[0] === 'object' && args[0].headers),
        ...headersToObj(init && init.headers),
      };
      const startedAt = Date.now();
      return origFetch.apply(this, args).then(
        (resp) => {
          // Full network-log record for EVERY response (success included).
          try {
            const respHeaders = resp ? headersToObj(resp.headers) : {};
            const ct = respHeaders['content-type'] || '';
            const netBase = {
              type: 'fetch',
              method,
              url,
              status: resp ? resp.status : 0,
              statusText: resp ? resp.statusText : '',
              ok: !!(resp && resp.status >= 200 && resp.status < 400),
              requestHeaders: reqHeaders,
              requestBody,
              responseHeaders: respHeaders,
              contentType: ct,
              durationMs: Date.now() - startedAt,
            };
            if (resp && isTextual(ct)) {
              resp
                .clone()
                .text()
                .then(
                  (txt) => postNet({ ...netBase, responseBody: clipNet(txt) }),
                  () => postNet(netBase),
                );
            } else {
              const len = respHeaders['content-length'];
              postNet({ ...netBase, responseBody: ct ? `[${ct}${len ? ' ' + len + 'b' : ''}]` : undefined });
            }
          } catch (_e) {
            /* ignore */
          }
          try {
            if (resp && resp.status >= 400) {
              const base = {
                kind: 'network',
                subtype: 'fetch',
                method,
                url,
                status: resp.status,
                message: `HTTP ${resp.status} ${resp.statusText || ''} on ${method} ${url}`.trim(),
                requestBody,
              };
              // Read the response off a CLONE so the page's own copy is untouched;
              // post once the body resolves (or immediately if it can't be read).
              try {
                resp
                  .clone()
                  .text()
                  .then(
                    (txt) => post({ ...base, responseBody: clip(txt) }),
                    () => post(base),
                  );
              } catch (_e) {
                post(base);
              }
            }
          } catch (_e) {
            /* ignore */
          }
          return resp;
        },
        (err) => {
          post({
            kind: 'network',
            subtype: 'fetch',
            method,
            url,
            status: 0,
            message: `Network failure on ${method} ${url}: ${(err && err.message) || err}`,
            requestBody,
          });
          postNet({
            type: 'fetch',
            method,
            url,
            status: 0,
            statusText: 'Network failure',
            ok: false,
            requestHeaders: reqHeaders,
            requestBody,
            responseHeaders: {},
            durationMs: Date.now() - startedAt,
            responseBody: `(network failure: ${(err && err.message) || err})`,
          });
          throw err;
        },
      );
    };
  }

  // ── XMLHttpRequest ──
  const OrigXHR = window.XMLHttpRequest;
  if (typeof OrigXHR === 'function') {
    class PatchedXHR extends OrigXHR {
      open(method, url, ...rest) {
        this.__tcMethod = (method || 'GET').toUpperCase();
        this.__tcUrl = url;
        try {
          this.addEventListener('loadend', () => {
            try {
              if (this.readyState !== 4) return;
              if (this.status === 0) {
                post({
                  kind: 'network',
                  subtype: 'xhr',
                  method: this.__tcMethod,
                  url: this.__tcUrl,
                  status: 0,
                  message: `XHR network failure on ${this.__tcMethod} ${this.__tcUrl}`,
                  requestBody: this.__tcReqBody,
                });
              } else if (this.status >= 400) {
                post({
                  kind: 'network',
                  subtype: 'xhr',
                  method: this.__tcMethod,
                  url: this.__tcUrl,
                  status: this.status,
                  message: `HTTP ${this.status} ${this.statusText || ''} on ${this.__tcMethod} ${this.__tcUrl}`.trim(),
                  requestBody: this.__tcReqBody,
                  responseBody: xhrResponseText(this),
                });
              }
              // Full network-log record for EVERY XHR (success included).
              try {
                const respHeaders = parseRawHeaders(this.getAllResponseHeaders && this.getAllResponseHeaders());
                const ct = (this.getResponseHeader && this.getResponseHeader('content-type')) || '';
                postNet({
                  type: 'xhr',
                  method: this.__tcMethod,
                  url: this.__tcUrl,
                  status: this.status,
                  statusText: this.statusText || '',
                  ok: this.status >= 200 && this.status < 400,
                  requestHeaders: this.__tcReqHeaders || {},
                  requestBody: this.__tcReqBody,
                  responseHeaders: respHeaders,
                  contentType: ct,
                  responseBody: this.status === 0 ? '(network failure)' : isTextual(ct) ? xhrResponseText(this) : `[${ct || 'binary'}]`,
                  durationMs: this.__tcStart ? Date.now() - this.__tcStart : undefined,
                });
              } catch (_e) {
                /* ignore */
              }
            } catch (_e) {
              /* ignore */
            }
          });
        } catch (_e) {
          /* ignore */
        }
        return super.open(method, url, ...rest);
      }
      setRequestHeader(name, value) {
        try {
          (this.__tcReqHeaders = this.__tcReqHeaders || {})[name] = value;
        } catch (_e) {
          /* ignore */
        }
        return super.setRequestHeader(name, value);
      }
      send(body) {
        try {
          this.__tcReqBody = bodyToText(body);
          this.__tcStart = Date.now();
        } catch (_e) {
          /* ignore */
        }
        return super.send(body);
      }
    }
    window.XMLHttpRequest = PatchedXHR;
  }

  // ── console.error ──
  const origConsoleError = console.error;
  console.error = function (...a) {
    try {
      post({
        kind: 'console',
        subtype: 'error',
        message: a.map(stringifyArg).join(' ').slice(0, 4000),
      });
    } catch (_e) {
      /* ignore */
    }
    return origConsoleError.apply(this, a);
  };

  // ── uncaught errors + failed resource loads (capture phase) ──
  window.addEventListener(
    'error',
    (e) => {
      try {
        const target = e.target;
        if (target && target !== window && (target.src || target.href)) {
          post({
            kind: 'resource',
            subtype: 'load-error',
            url: target.src || target.href,
            message: `Failed to load ${(target.tagName || 'resource').toLowerCase()}: ${target.src || target.href}`,
          });
          return;
        }
        const message = e.message || (e.error && e.error.message) || 'Uncaught error';
        if (IGNORED_ERROR_RE.test(message)) return;
        post({
          kind: 'js',
          subtype: 'uncaught',
          message,
          stack: e.error && e.error.stack,
          url: e.filename,
        });
      } catch (_e) {
        /* ignore */
      }
    },
    true,
  );

  // ── unhandled promise rejections ──
  window.addEventListener('unhandledrejection', (e) => {
    try {
      const r = e.reason;
      post({
        kind: 'js',
        subtype: 'unhandledrejection',
        message: (r && r.message) || stringifyArg(r) || 'Unhandled promise rejection',
        stack: r && r.stack,
      });
    } catch (_e) {
      /* ignore */
    }
  });
})();
