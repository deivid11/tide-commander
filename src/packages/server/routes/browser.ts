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
import { runBrowserCommand, browserConnected } from '../services/browser-bridge-service.js';
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

// Relay a read command to the extension and shape a uniform JSON response.
async function relay(res: Response, cmd: string, args: Record<string, unknown>): Promise<void> {
  try {
    const result = await runBrowserCommand(cmd, args);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// Is a browser (extension side panel) currently connected?
router.get('/status', (_req: Request, res: Response) => {
  res.json({ extensionConnected: browserConnected() });
});

// ── reads (relayed to the extension's live session) ──

// Read a DOM element (or all matches) by CSS selector → outerHTML/text/box/styles.
router.post('/dom', (req: Request, res: Response) =>
  relay(res, 'dom', { selector: req.body?.selector, all: !!req.body?.all }),
);

// Captured console.* output (optionally filtered by level), newest-first.
router.post('/console', (req: Request, res: Response) =>
  relay(res, 'console', { level: req.body?.level, limit: req.body?.limit }),
);

// Captured network requests (method/url/status/duration), newest-first.
router.post('/network', (req: Request, res: Response) =>
  relay(res, 'network', { limit: req.body?.limit, filter: req.body?.filter }),
);

// Captured + deduped browser errors.
router.post('/errors', (req: Request, res: Response) => relay(res, 'errors', { limit: req.body?.limit }));

// Active page url + title.
router.post('/page', (_req: Request, res: Response) => relay(res, 'page', {}));

// Screenshot the visible viewport, or a single element when `selector` is given.
// Returns a saved path the agent can Read.
router.post('/screenshot', (req: Request, res: Response) =>
  relay(res, 'screenshot', { selector: req.body?.selector }),
);

// ── interaction (CDP, attached to the user's Chrome via the debug port) ──

// Is Chrome reachable over CDP, and which tabs are open?
router.get('/cdp-status', async (_req: Request, res: Response) => {
  res.json(await cdp.status());
});

// Click an element by CSS selector.
router.post('/click', (req: Request, res: Response) =>
  drive(res, () => cdp.click(req.body?.selector, { url: req.body?.url, timeoutMs: req.body?.timeoutMs })),
);

// Type text into an element (set `clear:true` to replace existing content).
router.post('/type', (req: Request, res: Response) =>
  drive(res, () =>
    cdp.type(req.body?.selector, req.body?.text, { url: req.body?.url, clear: !!req.body?.clear, timeoutMs: req.body?.timeoutMs }),
  ),
);

// Navigate the active (or matched) tab to a URL.
router.post('/navigate', (req: Request, res: Response) =>
  drive(res, () => cdp.navigate(req.body?.url, { timeoutMs: req.body?.timeoutMs })),
);

// Scroll an element into view.
router.post('/scroll', (req: Request, res: Response) =>
  drive(res, () => cdp.scroll(req.body?.selector, { url: req.body?.url, timeoutMs: req.body?.timeoutMs })),
);

export default router;
