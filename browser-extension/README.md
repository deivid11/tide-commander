# Tide Commander — Error Trigger + Cockpit (browser extension)

A browser-side cockpit for Tide Commander. It:

1. **Captures console/network errors**, dedupes them, and **auto-sends a brief**
   to the agent assigned to the page. The agent pulls *more* context itself via
   the **chrome-devtools MCP** (other requests, console logs, screenshots).
2. **Chats** with that agent from a **side panel** (Guake-style terminal, live
   token streaming over the TC WebSocket, markdown rendered). Clicking the
   toolbar icon **toggles this chat** open/closed. The captured errors live in a
   collapsible **Errors** section at the top of the chat (send/mute/delete/clear),
   and a **Network** section lists *every* request for the active page (method,
   status, timing) — expand any one to see its request/response headers + bodies
   and **Send as context** (or **Copy**) it to the agent. **Pin** agents (📌 in
   the selector) to get a thumbnail quick-switch bar above the composer. Type
   **`@`** in the composer to **mention files/folders** from the agent's working
   directory — pick from the autocomplete and their contents (or a folder's
   structure) are attached to the message as context.
3. **Picks DOM elements** — hover-pick or right-click → attaches the element's
   selector, HTML, computed styles, box and a screenshot crop as chat context so
   the agent knows exactly what to change.
4. Connects to **multiple commanders** (TC servers by host/IP + optional token);
   each origin remembers its commander + agent.

> Division of labor: the extension is the **trigger + cockpit** (capture, chat,
> pick). The **agent** does the investigation/streaming through the
> chrome-devtools MCP and TC's own APIs — the extension stays thin.

## What it captures

- **Network**: `fetch` / `XMLHttpRequest` responses with status `>= 400`, plus
  outright network failures (status `0`). The **request body sent** and
  **response body received** are captured too (truncated + redacted) and included
  in the brief so the agent sees the failing payloads without an MCP round-trip.
- **JS**: uncaught errors (`window.onerror`) and unhandled promise rejections.
- **Console**: `console.error(...)` calls.
- **Resource** (off by default): failed `img` / `script` / `css` loads.

Each capture is **fingerprinted** (URL + message normalized — UUIDs, ids and
numbers collapsed) so the same logical error becomes one row with a count. The
agent is auto-notified when a count crosses a **threshold** (`1, 10, 100, 1000`
by default), and a server-side rate-limit prevents an error loop from spamming
the agent.

## Install (load unpacked)

1. Open `brave://extensions` (or `chrome://extensions`).
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select this `browser-extension/` folder.
4. Click the toolbar icon to open the chat, then its **⚙ / Settings** and set:
   - **Endpoint** — your Tide Commander URL (default `http://localhost:5174`).
   - **Auth token** — your `X-Auth-Token`.
   - **Target agent** — click *Load agents* and pick one, or leave blank to let
     the server route to its first agent.
5. Keep the default **allowlist** (`http://localhost:*`, `http://127.0.0.1:*`)
   or add the origins of the apps you want watched. **Only allowlisted origins
   are ever captured.**

Requires a Chromium-based browser with content-script `world: "MAIN"` support
(Chrome/Brave 111+).

## Using it

- Click the toolbar icon to **toggle the chat** side panel. Captured errors show
  newest-first in the chat's **Errors** section (click the header to expand).
- Per error: **Send now** (manual push), **Mute** (keep counting, never send),
  **Delete**. **Clear** wipes the list.
- The **Auto** toggle in the Errors header flips auto-send on/off globally.
- The toolbar badge shows the number of distinct (un-muted) errors.

## Privacy

- Nothing leaves the browser for non-allowlisted origins.
- **Redaction** is on by default: `Bearer` tokens, JWTs, and values of sensitive
  keys (`authorization`, `cookie`, `token`, `password`, `secret`, …) are masked
  in the message/stack/URL before sending. Tune the key list in Settings.
- Screenshots are only captured for the **visible** tab, attached to the brief,
  and saved server-side (never persisted inside the browser).
- **Local persistence** (all in the extension's private `chrome.storage.local`,
  never page-readable): settings + commander tokens (`tc_config`), captured
  errors (`tc_errors`), the network log (`tc_netlog`, redacted), the composer
  draft (`tc_draft`), theme and input height. The network log is capped and
  redacted before storage. Chat transcripts are **not** copied locally — they
  live server-side and reload from the agent's history when the panel opens.

## Server contract

The extension POSTs to `POST /api/triggers/browser-error` (auth: `X-Auth-Token`),
handled by `src/packages/server/services/browser-error-service.ts` and routed in
`src/packages/server/routes/trigger-routes.ts`.

```jsonc
{
  "fingerprint": "fp_xxx",
  "kind": "network",          // network | js | console | resource
  "subtype": "fetch",
  "status": 500,
  "method": "GET",
  "url": "https://api.example.com/v1/orders/123",
  "pageUrl": "http://localhost:3000/orders",
  "message": "HTTP 500 on GET /v1/orders/123",
  "stack": "…",
  "requestBody": "…",         // optional; payload SENT (network errors, truncated+redacted)
  "responseBody": "…",        // optional; payload RECEIVED (network errors, truncated+redacted)
  "occurrenceCount": 1,
  "firstSeen": 1718760000000,
  "lastSeen": 1718760000000,
  "agentId": "",              // optional; server falls back to first agent
  "screenshot": "data:image/jpeg;base64,…"  // optional
}
```

Response: `{ "delivered": true, "agentId": "…", "agentName": "…", "fingerprint": "…", "screenshotSaved": true }`
or `{ "deduped": true }` when rate-limited.

## Files

```
browser-extension/
  manifest.json        MV3 manifest (icon toggles side_panel + context menus)
  sidepanel.html       chat cockpit (terminal-style, markdown, errors section, element context)
  options.html         settings (commanders + capture + redaction)
  src/
    inject.js          MAIN world — patches fetch/XHR/console, error listeners
    content.js         ISOLATED world — relays captures + element picker
    background.js      service worker — multi-commander hub, dedup/send, chat/history proxy, picker crop
    sidepanel.js/.css  chat + errors feed + WebSocket streaming + dependency-free markdown renderer
    options.js / options.css
  icons/               generated by icons/generate.py
```
