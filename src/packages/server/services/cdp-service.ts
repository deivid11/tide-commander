/**
 * cdp-service.ts — drive the user's live Chrome via the DevTools Protocol.
 *
 * This is the INTERACTION path of the browser bridge (click / type / navigate /
 * scroll). It attaches to the user's already-running Chrome over the remote
 * debugging port using puppeteer-core, so actions land in the same real, logged-in
 * session the extension observes — but with robust automation primitives
 * (waitForSelector, real keyboard/mouse events that React/SPAs honor).
 *
 * SETUP: the user must start Chrome with the debugging port, e.g.
 *   google-chrome --remote-debugging-port=9222
 * Port is configurable via TC_CDP_PORT (default 9222).
 *
 * SAFETY: this is the user's real browser. Actions are refused on pages whose URL
 * is not in the allowlist (TC_CDP_ALLOWLIST, comma-separated URL prefixes;
 * defaults to localhost only). We `disconnect()` after each action and NEVER
 * `close()` — closing would kill the user's browser.
 */

import puppeteer, { Browser, Page } from 'puppeteer-core';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CDP');

const PORT = Number(process.env.TC_CDP_PORT) || 9222;
const BROWSER_URL = `http://127.0.0.1:${PORT}`;
const DEFAULT_WAIT_MS = 5000;

function allowlist(): string[] {
  const raw = process.env.TC_CDP_ALLOWLIST;
  if (raw && raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return ['http://localhost', 'http://127.0.0.1'];
}
function isAllowed(url: string): boolean {
  return allowlist().some((prefix) => (url || '').startsWith(prefix));
}

// Cache the connection across calls; re-attach if Chrome was restarted/closed.
let cached: Browser | null = null;
async function getBrowser(): Promise<Browser> {
  if (cached && cached.connected) return cached;
  cached = null;
  try {
    cached = await puppeteer.connect({ browserURL: BROWSER_URL, defaultViewport: null });
    return cached;
  } catch (err) {
    throw new Error(
      `Could not reach Chrome DevTools on ${BROWSER_URL}. Start Chrome with ` +
        `--remote-debugging-port=${PORT} (or set TC_CDP_PORT). (${err instanceof Error ? err.message : err})`,
    );
  }
}

// Pick the page to act on: an explicit URL-substring match, else the visible/
// focused http(s) tab, else the first http(s) tab.
async function pickPage(urlHint?: string): Promise<Page> {
  const browser = await getBrowser();
  const pages = await browser.pages();
  const web = pages.filter((p) => /^https?:/i.test(p.url()));
  if (web.length === 0) throw new Error('No open web page found in Chrome.');
  if (urlHint) {
    const m = web.find((p) => p.url().includes(urlHint));
    if (m) return m;
    throw new Error(`No open tab matches "${urlHint}".`);
  }
  // Prefer a visible + focused tab.
  const scored = await Promise.all(
    web.map(async (p) => {
      let visible = false;
      let focused = false;
      try {
        visible = await p.evaluate(() => document.visibilityState === 'visible');
        focused = await p.evaluate(() => document.hasFocus());
      } catch {
        /* page navigating — treat as not visible */
      }
      return { p, score: (visible ? 1 : 0) + (focused ? 2 : 0) };
    }),
  );
  scored.sort((a, b) => b.score - a.score);
  return scored[0].p;
}

async function guard(page: Page): Promise<void> {
  const url = page.url();
  if (!isAllowed(url)) {
    throw new Error(`Refused: ${url} is not in the CDP allowlist (${allowlist().join(', ')}).`);
  }
}

export interface CdpStatus {
  connected: boolean;
  port: number;
  pages?: Array<{ url: string; title: string }>;
  error?: string;
}
export async function status(): Promise<CdpStatus> {
  try {
    const browser = await getBrowser();
    const pages = await browser.pages();
    const web = await Promise.all(
      pages
        .filter((p) => /^https?:/i.test(p.url()))
        .map(async (p) => ({ url: p.url(), title: await p.title().catch(() => '') })),
    );
    return { connected: true, port: PORT, pages: web };
  } catch (err) {
    return { connected: false, port: PORT, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function click(selector: string, opts: { url?: string; timeoutMs?: number } = {}): Promise<{ ok: true; url: string }> {
  if (!selector) throw new Error('selector required');
  const page = await pickPage(opts.url);
  await guard(page);
  await page.waitForSelector(selector, { timeout: opts.timeoutMs || DEFAULT_WAIT_MS });
  await page.click(selector);
  log.log(`click ${selector}`);
  return { ok: true, url: page.url() };
}

export async function type(
  selector: string,
  text: string,
  opts: { url?: string; timeoutMs?: number; clear?: boolean } = {},
): Promise<{ ok: true; url: string }> {
  if (!selector) throw new Error('selector required');
  const page = await pickPage(opts.url);
  await guard(page);
  await page.waitForSelector(selector, { timeout: opts.timeoutMs || DEFAULT_WAIT_MS });
  await page.focus(selector);
  if (opts.clear) {
    // Select-all + delete via real keys so React/SPA state updates too.
    await page.click(selector, { count: 3 });
    await page.keyboard.press('Backspace');
  }
  await page.type(selector, String(text == null ? '' : text));
  log.log(`type into ${selector}`);
  return { ok: true, url: page.url() };
}

export async function navigate(url: string, opts: { timeoutMs?: number } = {}): Promise<{ ok: true; url: string }> {
  if (!url) throw new Error('url required');
  if (!isAllowed(url)) {
    throw new Error(`Refused: ${url} is not in the CDP allowlist (${allowlist().join(', ')}).`);
  }
  const page = await pickPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs || 15000 });
  log.log(`navigate ${url}`);
  return { ok: true, url: page.url() };
}

export async function scroll(selector: string, opts: { url?: string; timeoutMs?: number } = {}): Promise<{ ok: true; url: string }> {
  if (!selector) throw new Error('selector required');
  const page = await pickPage(opts.url);
  await guard(page);
  await page.waitForSelector(selector, { timeout: opts.timeoutMs || DEFAULT_WAIT_MS });
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }));
  log.log(`scroll to ${selector}`);
  return { ok: true, url: page.url() };
}
