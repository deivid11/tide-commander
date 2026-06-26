/**
 * browser.ts — /api/browser/* — lets server-side agents observe and drive the
 * user's live browser.
 *
 *  - READS (DOM / console / network / errors / page / screenshot) are relayed to
 *    the extension side panel over the WebSocket bridge, so they run in the
 *    user's real logged-in session. See browser-bridge-service.ts.
 *  - INTERACTION (click / type / navigate / scroll) goes through CDP attached to
 *    the user's Chrome. See cdp-service.ts. (Added once puppeteer-core is wired.)
 *
 * Auth: the global X-Auth-Token middleware (mounted on /api) already guards these.
 */

import { Router, Request, Response } from 'express';
import { runBrowserCommand, browserConnected, getBrowserClients } from '../services/browser-bridge-service.js';
import * as cdp from '../services/cdp-service.js';

const router = Router();

// Run a CDP interaction and shape a uniform JSON response.
async function drive(res: Response, fn: () => Promise<unknown>): Promise<void> {
  try {
    const result = await fn();
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// Relay a command to the extension (live session) and shape a uniform response.
async function relay(res: Response, cmd: string, args: Record<string, unknown>, timeoutMs?: number): Promise<void> {
  try {
    const result = await runBrowserCommand(cmd, args, timeoutMs);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// Is a browser (extension side panel) currently connected? `clients` identifies who
// opened each bridge socket — IP, User-Agent, extension origin, and (for a loopback
// peer) the host machine name.
router.get('/status', (_req: Request, res: Response) => {
  res.json({ extensionConnected: browserConnected(), clients: getBrowserClients() });
});

// List the user's open tabs (so an agent can target one by id or url).
router.get('/tabs', (_req: Request, res: Response) => relay(res, 'tabs', {}));

// Diagnostic: list every DevTools debug target (type/url/tabId/extensionId). Use to
// see which extension owns a tab's target when chrome.debugger attach is rejected with
// "Cannot access a chrome-extension:// URL of different extension".
router.get('/targets', (_req: Request, res: Response) => relay(res, 'targets', {}));

// Every command below accepts an optional tab target: `tabId` (exact) or `tab`
// (a URL/title substring). Omit both to use the active tab.
//
// The `diff*` fields are only honored by DRIVE commands: pass `diff:true` to get a
// MutationObserver summary of what the action changed in the DOM (added/removed/
// attribute/text changes + a short semantic summary). `settleMs` tunes the quiet
// window (default 350), `diffRoot` scopes the observer to a CSS selector. They are
// undefined for reads ⇒ JSON.stringify omits them, so reads are unaffected.
function target(req: Request): Record<string, unknown> {
  return {
    tabId: req.body?.tabId,
    tab: req.body?.tab,
    diff: req.body?.diff,
    diffRoot: req.body?.diffRoot,
    diffVerbose: req.body?.diffVerbose,
    settleMs: req.body?.settleMs,
    diffTimeoutMs: req.body?.diffTimeoutMs,
  };
}

// ── reads (relayed to the extension's live session) ──

// Read a DOM element (or all matches) by CSS selector → outerHTML/text/box/styles.
// `actionable:true` instead returns a compact, DOM-ordered list of the interactive
// elements rendered under `selector` (or the whole page) — each with a click-ready
// selector + visible label + form state — so an agent finds its target in one read.
router.post('/dom', (req: Request, res: Response) =>
  relay(res, 'dom', {
    ...target(req),
    selector: req.body?.selector,
    all: !!req.body?.all,
    keepSvg: !!req.body?.keepSvg,
    actionable: !!req.body?.actionable,
    limit: req.body?.limit,
  }),
);

// Captured console.* output (optionally filtered by level), newest-first.
router.post('/console', (req: Request, res: Response) =>
  relay(res, 'console', { ...target(req), level: req.body?.level, limit: req.body?.limit }),
);

// Captured network requests (method/url/status/duration), newest-first. Set
// `detail:true` to include request/response headers + bodies.
router.post('/network', (req: Request, res: Response) =>
  relay(res, 'network', { ...target(req), limit: req.body?.limit, filter: req.body?.filter, detail: !!req.body?.detail }),
);

// Captured + deduped browser errors.
router.post('/errors', (req: Request, res: Response) => relay(res, 'errors', { ...target(req), limit: req.body?.limit }));

// Page url + title of the target tab.
router.post('/page', (req: Request, res: Response) => relay(res, 'page', target(req)));

// Screenshot the target tab's viewport, or a single element when `selector` is
// given. Returns a saved path the agent can Read.
router.post('/screenshot', (req: Request, res: Response) =>
  relay(res, 'screenshot', { ...target(req), selector: req.body?.selector }),
);

// ── interaction (live session, via the extension's chrome.debugger) ──
// These drive the user's REAL logged-in browser — chrome.debugger doesn't use the
// remote-debugging port, so it isn't blocked on the default profile (Chrome 136+).
const DRIVE_TIMEOUT_MS = 30000;
// `wait` can block up to its own 30s cap, so give the bridge a little more headroom.
const WAIT_TIMEOUT_MS = 35000;
// A batch runs several steps; allow more time than a single action.
const BATCH_TIMEOUT_MS = 90000;

// click / hover / scroll accept EITHER a CSS `selector` OR visible `text` (e.g.
// {"text":"Volver"}) — no selector needed. Discarded/slept tabs are auto-woken.
router.post('/click', (req: Request, res: Response) =>
  relay(res, 'click', { ...target(req), selector: req.body?.selector, text: req.body?.text, within: req.body?.within, timeoutMs: req.body?.timeoutMs }, DRIVE_TIMEOUT_MS),
);
router.post('/type', (req: Request, res: Response) =>
  relay(res, 'type', { ...target(req), selector: req.body?.selector, text: req.body?.text, within: req.body?.within, clear: !!req.body?.clear, timeoutMs: req.body?.timeoutMs }, DRIVE_TIMEOUT_MS),
);
router.post('/navigate', (req: Request, res: Response) =>
  relay(res, 'navigate', { ...target(req), url: req.body?.url, timeoutMs: req.body?.timeoutMs }, DRIVE_TIMEOUT_MS),
);
router.post('/scroll', (req: Request, res: Response) =>
  relay(res, 'scroll', { ...target(req), selector: req.body?.selector, text: req.body?.text, within: req.body?.within, timeoutMs: req.body?.timeoutMs }, DRIVE_TIMEOUT_MS),
);
router.post('/hover', (req: Request, res: Response) =>
  relay(res, 'hover', { ...target(req), selector: req.body?.selector, text: req.body?.text, within: req.body?.within, timeoutMs: req.body?.timeoutMs }, DRIVE_TIMEOUT_MS),
);
// Run a sequence of steps in one call on one tab. Each step is {cmd, ...args} using
// the same vocabulary as the endpoints; stops at the first failure unless the step
// sets continueOnError. e.g. {"tab":"6200","steps":[{"cmd":"click","text":"Volver"},{"cmd":"page"}]}
router.post('/batch', (req: Request, res: Response) =>
  relay(res, 'batch', { tab: req.body?.tab, tabId: req.body?.tabId, steps: req.body?.steps }, BATCH_TIMEOUT_MS),
);
// Fill a whole form in ONE call: `fields:[{selector,text,clear?}]` are typed in order
// (React-safe, 🤖-gated like /type), then optional `submit` (a selector) is clicked once
// WITH a diff so validation errors / the confirm modal come back in the same response.
// Returns {filled:[{selector,ok,error?}], submitted?, diff?}. Prefer this over N /type calls.
router.post('/fill', (req: Request, res: Response) =>
  relay(
    res,
    'fill',
    {
      tab: req.body?.tab,
      tabId: req.body?.tabId,
      fields: req.body?.fields,
      submit: req.body?.submit,
      diff: req.body?.diff,
      settleMs: req.body?.settleMs,
      continueOnError: !!req.body?.continueOnError,
    },
    BATCH_TIMEOUT_MS,
  ),
);
// Drag from one selector to another.
router.post('/drag', (req: Request, res: Response) =>
  relay(res, 'drag', { ...target(req), from: req.body?.from, to: req.body?.to, timeoutMs: req.body?.timeoutMs }, DRIVE_TIMEOUT_MS),
);
// Press a named key (Enter, Tab, Escape, ArrowDown, …), optionally focusing a selector first.
router.post('/key', (req: Request, res: Response) =>
  relay(res, 'key', { ...target(req), key: req.body?.key, selector: req.body?.selector, within: req.body?.within, timeoutMs: req.body?.timeoutMs }, DRIVE_TIMEOUT_MS),
);
// Pick a <select> option by `value` or visible `label`.
router.post('/select', (req: Request, res: Response) =>
  relay(res, 'select', { ...target(req), selector: req.body?.selector, value: req.body?.value, label: req.body?.label, within: req.body?.within, timeoutMs: req.body?.timeoutMs }, DRIVE_TIMEOUT_MS),
);
// Run arbitrary JS in the page and return its (JSON-serializable) result.
router.post('/evaluate', (req: Request, res: Response) =>
  relay(res, 'evaluate', { ...target(req), expression: req.body?.expression ?? req.body?.script }, DRIVE_TIMEOUT_MS),
);
// Wait for a selector, a text string, or a fixed delay (ms).
router.post('/wait', (req: Request, res: Response) =>
  relay(res, 'wait', { ...target(req), selector: req.body?.selector, text: req.body?.text, ms: req.body?.ms, timeoutMs: req.body?.timeoutMs }, WAIT_TIMEOUT_MS),
);
// Arm a one-shot auto-response for the next JS dialog (accept/dismiss + promptText).
router.post('/dialog', (req: Request, res: Response) =>
  relay(res, 'dialog', { ...target(req), accept: req.body?.accept, promptText: req.body?.promptText }, DRIVE_TIMEOUT_MS),
);
// Escape hatch: run ANY DevTools Protocol command on the target tab.
router.post('/cdp-raw', (req: Request, res: Response) =>
  relay(res, 'cdp_raw', { ...target(req), method: req.body?.method, params: req.body?.params }, DRIVE_TIMEOUT_MS),
);

// ── tabs (open / close / activate) ──
router.post('/tab/open', (req: Request, res: Response) =>
  relay(res, 'tab_open', { url: req.body?.url, active: req.body?.active }),
);
router.post('/tab/close', (req: Request, res: Response) => relay(res, 'tab_close', target(req)));
router.post('/tab/activate', (req: Request, res: Response) => relay(res, 'tab_activate', target(req)));

// ── fallback: drive a SEPARATE Chrome via puppeteer-core over the debug port ──
// For a throwaway --user-data-dir profile or Chrome for Testing (not your live
// session). Requires Chrome launched with --remote-debugging-port. See cdp-service.ts.
router.get('/cdp-status', async (_req: Request, res: Response) => {
  res.json(await cdp.status());
});
router.post('/cdp/click', (req: Request, res: Response) =>
  drive(res, () => cdp.click(req.body?.selector, { url: req.body?.url, timeoutMs: req.body?.timeoutMs })),
);
router.post('/cdp/type', (req: Request, res: Response) =>
  drive(res, () =>
    cdp.type(req.body?.selector, req.body?.text, { url: req.body?.url, clear: !!req.body?.clear, timeoutMs: req.body?.timeoutMs }),
  ),
);
router.post('/cdp/navigate', (req: Request, res: Response) =>
  drive(res, () => cdp.navigate(req.body?.url, { timeoutMs: req.body?.timeoutMs })),
);
router.post('/cdp/scroll', (req: Request, res: Response) =>
  drive(res, () => cdp.scroll(req.body?.selector, { url: req.body?.url, timeoutMs: req.body?.timeoutMs })),
);

export default router;
