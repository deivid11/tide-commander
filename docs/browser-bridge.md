# Browser Bridge — driving the live browser from the Commander

The browser bridge lets a server-side agent **observe and drive the user's real,
logged-in browser** through the Tide Commander extension. Agents can only reach
`localhost`, so the Commander server is the bridge: it relays commands to the
extension side panel over the WebSocket, and the extension runs them in the live
session.

Everything is exposed under **`/api/browser/*`** and protected by the global
`X-Auth-Token` middleware (same token as the rest of the API).

```bash
# scaffolding used by every example below
curl -s -X POST -H "X-Auth-Token: abcd" -H "Content-Type: application/json" \
  http://localhost:5174/api/browser/<path> -d '<json-body>'
```

---

## How it works

```
agent (curl localhost) ──▶ Commander server ──WS──▶ extension side panel ──▶ the page
        REST /api/browser/*        browser-bridge-service        sidepanel.js / background.js
```

Two halves, by design:

- **Reads** run through the extension's content script in the live session (DOM,
  console, network, errors, page, screenshot).
- **Drive** (click/type/navigate/…) runs through **`chrome.debugger`** attached to
  the real tab — no `--remote-debugging-port`, so it works on the default profile
  (Chrome 136+ blocks the port there). When the debugger can't attach (another
  extension injected a frame — e.g. a password manager's autofill iframe), the
  bridge **automatically falls back to a content-script driver** that dispatches
  synthetic events and isn't subject to the debugger's access check.

## Prerequisites (activation)

1. The **extension is installed** and its **side panel is open** (the panel hosts
   the WebSocket that serves both reads and drive).
2. The target tab's **🤖 drive toggle is ON** (in the side panel header, next to
   the page origin). **Manipulation is OFF by default, per tab** — reads always
   work, but click/type/navigate are refused until you turn the tab on. When a tab
   is ON, the extension injects a small on-page badge (*"🤖 Agente puede controlar
   esta pestaña"*) with a hover tooltip that explains it and how to turn it off, so
   the user always knows an agent may be driving that tab.
3. The page origin is in the extension's **allowlist** (Settings → "Agent browser
   control"). Otherwise drive returns `Refused: … is not in the allowlist`.

Check the connection (and identify the client) with `GET /api/browser/status`.

## Tab targeting

Every command takes an optional target:

- `tabId` — exact numeric id (from `GET /api/browser/tabs`), **or**
- `tab` — a URL/title substring (e.g. `{"tab":"transfercld"}`).

Omit both to use the **active** tab. `GET /api/browser/tabs` lists open `http(s)`
tabs with `{tabId, url, title, active, windowId}`.

---

## Response shapes (don't `jq` the wrong path)

Every call returns `{ok:true, result}` or `{ok:false, error}`. A wrong `jq` path returns
`null` — that's the filter missing, **not** the API failing. The result nests by command:

- single `/dom` → `.result.node` (text `.result.node.text`, live value `.result.node.field.value`, markup `.result.node.outerHTML`)
- `/dom {all:true}` → `.result.nodes[]` · `/dom {actionable:true}` → `.result.actionable[]`
- drives → `.result.diff` and `.result.ok`; a diff of `{changed:false}` has no `summary`/`added` keys, so `.result.diff.summary` is `null` = "nothing changed", not an error
- after a click that opened a modal/menu, the fields/options are in `.result.diff.added[].actions` — read those instead of firing another `/dom`

When unsure, read the raw JSON once (no `jq`) to learn the shape, then filter.

## Endpoints

### Status & diagnostics

| Method · path | Purpose |
|---|---|
| `GET /api/browser/status` | `{extensionConnected, clients[]}` — each client = `{ip, userAgent, origin (chrome-extension://id), host, local, connectedAt, open}`. |
| `GET /api/browser/tabs` | List open tabs. |
| `GET /api/browser/targets` | List every DevTools target (`type/url/tabId/extensionId`) — use to find which extension owns a tab's target when an attach is rejected. |

### Reads (live session)

| Method · path | Body | Returns |
|---|---|---|
| `POST /api/browser/dom` | `selector`, `all?`, `keepSvg?`, `actionable?`, `limit?` | `outerHTML`/`text`/box/styles + **`field`** (live `value`/`checked`/`selectedText`/`disabled` for input/textarea/select) for the node (or up to 20 nodes when `all:true`). Read form state from `field` — not the `value` attribute, not `evaluate`. Bulky `<svg>` icon markup and `<style>` blocks (e.g. injected DarkReader CSS) are collapsed to compact placeholders by default; `keepSvg:true` keeps them. A selector with no match returns `no element matches <selector>` (it no longer falls back to the debugger, so a missing element won't surface the cross-extension error). **`actionable:true`** returns a one-call map of interactive elements instead — see below. |
| `POST /api/browser/console` | `level?`, `limit?` | Captured `console.*`, newest-first. |
| `POST /api/browser/network` | `limit?`, `filter?`, `detail?` | Requests (method/url/status/duration); `detail:true` adds headers+bodies. |
| `POST /api/browser/errors` | `limit?` | Captured + deduped page errors. |
| `POST /api/browser/page` | — | `{tabId, url, title}`. |
| `POST /api/browser/screenshot` | `selector?` | Saves an image, returns `{path}` to `Read`. Viewport when no selector. |

#### `actionable:true` — one-call "what can I click/type here"

`POST /api/browser/dom {"actionable":true}` (optionally `selector` to scope, `limit` to
cap, default 60) returns a compact, DOM-ordered list of the interactive elements actually
rendered — so an agent finds its target in **one** read instead of guessing selectors
(the m17ea3ui run burned four `/dom` reads just locating the create button). Each entry is
`{tag, selector, text, role?, type?, placeholder?, value?, checked?, disabled?, href?}`.
Hidden / zero-size elements are skipped, nested interactives collapse to the outermost
clickable, and icon-only buttons surface their `aria-label` as `text`. Content-script
only (no debugger fallback).

```jsonc
// POST /api/browser/dom  {"actionable":true,"selector":".Modal-container"}
{ "ok": true, "result": { "count": 6, "truncated": 0, "actionable": [
  { "tag":"button", "selector":"button.button.confirm", "text":"Crear transacción" },
  { "tag":"input",  "selector":"input.input.slim", "type":"text", "text":"Cantidad", "placeholder":"Cantidad" },
  { "tag":"button", "selector":"button.close", "role":"button", "text":"Cerrar" },
  { "tag":"a",      "selector":"a", "text":"Volver", "href":"/home" }
] } }
```

### Drive (manipulation — needs 🤖 ON + allowlist)

| Method · path | Body | Notes |
|---|---|---|
| `POST /api/browser/fill` | `fields:[{selector,text,clear?}]`, `submit?`, `diff?` | **Fill a whole form in one call.** Types every field in order (React-safe), then optionally clicks `submit` (a selector) once with a diff → validation errors / confirm modal come back together. Returns `{filled:[{selector,ok,error?}], submitted?, diff?}`. **Prefer this over N `/type` calls.** Safety: omit `submit` for irreversible forms (see Safety). |
| `POST /api/browser/click` | `selector` **or** `text`, `within?` | Trusted click; `text` matches visible text (exact→ci→contains). `within` scopes matching to a subtree. |
| `POST /api/browser/type` | `selector`, `text`, `clear?`, `within?` | React-safe value set + `input`/`change`. Single field — for ≥2 fields use `/fill`. |
| `POST /api/browser/navigate` | `url` | (content-script fallback is same-origin only). |
| `POST /api/browser/scroll` | `selector` **or** `text`, `within?` | Scrolls the element into view. |
| `POST /api/browser/hover` | `selector` **or** `text`, `within?` | |
| `POST /api/browser/key` | `key`, `selector?`, `within?` | Named keys: `Enter`, `Tab`, `Escape`, `ArrowDown`, … |
| `POST /api/browser/select` | `selector`, `value` **or** `label`, `within?` | Native `<select>` only (for react-select see the recipe). |
| `POST /api/browser/drag` | `from`, `to` | Debugger-only. |
| `POST /api/browser/wait` | `selector` **or** `text` **or** `ms` | Polls up to ~30s. |
| `POST /api/browser/evaluate` | `expression` | Runs JS, returns `{value}`. **Debugger path ONLY** — the content-script fallback can't `eval` (the extension's CSP forbids `unsafe-eval`), so on a tab where the debugger is blocked (foreign-extension frame) `evaluate` always fails. Use `/dom` (incl. `field`) + structured commands for reads instead. |
| `POST /api/browser/dialog` | `accept?`, `promptText?` | Arms a one-shot auto-response for the next JS dialog. Debugger-only. |
| `POST /api/browser/cdp-raw` | `method`, `params?` | Escape hatch: any DevTools Protocol method. Debugger-only. |
| `POST /api/browser/batch` | `tab`/`tabId`, `steps[]` | Runs `{cmd, …}` steps in order on one tab; stops at first failure unless `continueOnError`. |

### Tabs

`POST /api/browser/tab/open` (`url?`, `active?`) · `POST /api/browser/tab/close` ·
`POST /api/browser/tab/activate`.

### DOM diff — what an action changed

Add `"diff": true` to any **drive** call (`click`, `type`, `navigate`, `scroll`,
`hover`, `key`, `select`, `wait`, `evaluate`, …) and the result carries a `diff` of
what changed in the DOM — so you don't need a separate read to see the effect.

It's a **MutationObserver delta**, not a full-DOM snapshot: a content-script observer
records mutations around the action (so it captures changes from **both** the
content-script and `chrome.debugger` drive paths), waits for them to **settle**
(quiet for `settleMs`, default 350ms; capped by an internal max), then summarizes
with **aggressive, token-conscious noise filtering**: `style` and framework
class/aria churn are dropped; presentational add/remove churn (the floating
`<span class="label">` that animates in on `type`, loading bars/spinners, and
injected `<style>` from other extensions like DarkReader) is dropped; **react-select
internals are folded into one summary line** (`"seleccionó: <value>"` /
`"abrió/filtró lista de opciones (N): opt1, opt2, …"` — the menu's option labels are
listed so you can pick one without a separate read); the chosen value collapses to
`"seleccionó: X"` and the wrapper churn (`__control`/`__placeholder`/`__single-value`/
indicators + `aria-expanded`/`class`/`value` attr noise) is dropped, but the **menu/option
nodes stay in `added`** with their compact html (so you see the actual markup too); only
stateful attributes (`disabled`/`value`/
`checked`/`aria-invalid`/…) and stateful `class` tokens survive (the latter as
`{attr:"class", add, remove}`); each node carries a **compact `html`** (outerHTML with
`<svg>`/`<style>` stripped, whitespace collapsed, truncated ~400 chars) so you can see
WHAT appeared without a follow-up `/dom`. Each **`added` node also carries `actions`** —
its interactive descendants (`[{selector, text, type?, placeholder?, disabled?}]`, capped
8, overflow in `actionsTruncated`) — so when a modal/menu/dialog mounts the diff hands you
the fields/options/buttons + exact selectors to act on next, with no follow-up
`/dom {actionable:true}` read and no guessing `#…-option-N` indices. Added subtrees
collapse to their root; lists cap at ~10 nodes / ~12 attrs (overflow in `truncated`).
There is **no `counts` key** (it just duplicated the array lengths + an internal
`attrNoise` metric) and **empty fields are omitted** — `added`/`removed`/`attrs`/`text`
appear only when non-empty, so a clean dropdown pick is just
`{ summary:["seleccionó: X"], settled }`. Pass `"diffVerbose": true` to get the unfiltered
firehose (full `html`, `style`, every attribute, every react-select node, plus `counts`).

When the action produced **no meaningful change**, the whole empty
`{counts:{…0}, summary:[], added:[], …}` skeleton collapses to a single
`"diff": { "changed": false, "settled": … }` marker (it was ~140 tokens of empty
arrays). The "nothing happened" signal is preserved — a `click` that should open a
modal but returns `changed:false` had no effect (re-check the selector). Note a
`type` into a plain text field also returns `changed:false` (React doesn't mutate the
DOM for value changes) — that's expected, not a failure; verify via `/dom`'s `field`.

```jsonc
// POST /api/browser/click  {"selector":".add-btn","diff":true}
{ "ok": true, "result": { "ok": true, "diff": {
  "summary": ["abrió modal/diálogo: Nueva transacción"],
  "added": [ { "tag":"div", "id":"", "classes":["Modal-container"], "selector":"div.Modal-container", "text":"Nueva transacción …",
    "html":"<div class=\"Modal-container\"> <h1 class=\"title\">Nueva transacción</h1> <input placeholder=\"Cantidad\"> …",
    "actions": [ {"selector":"#react-select-4-input","type":"text"}, {"selector":"input.input.slim","text":"Cantidad","type":"number","placeholder":"Cantidad"}, {"selector":"button.confirm","text":"Crear transacción"} ], "actionsTruncated": 4 } ],
  "attrs": [ { "selector":"input#ref", "attr":"disabled", "old":"", "new": null } ],
  "settled": true
} } }
// (no `counts`; `removed`/`text`/`truncated` omitted because empty)
```

Tuning fields (alongside `diff`): `settleMs` (quiet window), `diffRoot` (a CSS
selector to scope the observer to one subtree and cut noise), `diffTimeoutMs` (max
observation window). Off by default — opt in when you want "did a modal / row /
validation error appear?" in the same call.

**Inspecting diffs (UI):** the extension side panel has a **🔀 DOM diffs** badge that
lists what each drive action changed — newest first, click a row to expand
added/removed/attribute details. Its **auto** toggle (**ON by default**, persisted)
forces a diff on every drive action so the panel fills during normal driving — even
when the agent didn't pass `diff:true` (auto-captured diffs go to the panel only; they
don't change the agent's API result). Turn it off to drop the per-action settle delay.

### Fallback: throwaway Chrome over the debug port

`GET /api/browser/cdp-status` + `POST /api/browser/cdp/{click,type,navigate,scroll}`
drive a **separate** Chrome launched with `--remote-debugging-port` (a throwaway
`--user-data-dir` profile or Chrome for Testing) via puppeteer-core — **not** your
live session. Use the relay endpoints above for the real browser.

---

## Recipes & gotchas

**Discover selectors, don't guess** — a missing selector on a drive call fails after an
~8s wait with `no element matches "<selector>" (waited 8s) — re-list current elements
with /dom {actionable:true}`. When you get that, do exactly that: re-list with
`/dom {actionable:true}` (optionally scoped to the open modal) — **don't re-guess the
selector or fall back to screenshots**, both just burn more time. Don't guess framework
selectors for an app you haven't inspected (e.g. PatternFly `.pf-v5-c-button`) and don't
click tiny ambiguous text like `{"text":"+"}` — both just time out. On a tab where
chrome.debugger is blocked (foreign-extension frame), the content-script driver runs the
action and it **doesn't support complex CSS like `:has()`** — use a plain
`#id`/`.class`/`[attr]` or `text`.

**Dynamic forms reshape on selection** — picking a dropdown / react-select value can ADD
or REMOVE other fields (choosing a bank can swap "Cuenta del beneficiario" for a phone
field and drop "Nombre del beneficiario"). Field selectors read BEFORE the pick may go
stale and time out. After a select that might restructure the form, **re-read
`/dom {actionable:true}` before `/fill`** instead of reusing the pre-selection list.

**Scope matching with `within`** — click/type/select/hover/scroll accept `within` (a
CSS selector) that confines selector/text resolution to that subtree. Use it whenever
the same text/label/selector also appears in background content: clicking a dropdown
option `{"text":"BBVA BANCOMER"}` while a transactions table behind the modal has BBVA
rows would otherwise resolve to the first page-wide match (the table row) and open the
wrong thing. Scope it — `{"text":"BBVA BANCOMER","within":".tide-react-select__menu"}`
or `"within":".Modal-container"`. Resolution polls until `within` itself mounts, so it's
safe to fire right after opening the menu/modal. Honored on both the chrome.debugger and
content-script drivers.

**react-select dropdowns** — `/select` only does native `<select>`. The RELIABLE open is
`type` the query straight into `#react-select-N-input` (opens + filters in one step). A
`click` — on the input OR the `.tide-react-select__control` — often does NOT open the menu
with the synthetic content-script driver (`changed:false`, the "clicked but the dropdown
didn't show"); don't fight it, just `type`. For the full unfiltered list, `key` `ArrowDown`
on `#react-select-N-input`. Once open, `click` the option. (The driver was also fixed to
not pre-focus before the click sequence, which is what broke react-select's
mousedown→focus→open chain — but `type` remains the reliable path.) **Don't click a raw `#react-select-N-option-M` id — react-select
renumbers those on every filter/re-render, so a read id is often stale by click time** (→
"no element matches"). Robust ways: click the `selector` from the diff's `actions` (the
bridge anchors it on the stable `#react-select-N-listbox` + position, dropping the volatile
id — see selector stability below), or click by `text` **scoped to the menu**:
`{"text":"BBVA BANCOMER","within":"#react-select-N-listbox"}`. Confirm via
`.tide-react-select__single-value`.

**Selector stability** — `cssPath` (used by `actionable`, diff `actions`, the element
picker) deliberately **skips auto-generated volatile ids** (`react-select-N-option-M`,
React `useId` `:r1:`, `radix-`/`headlessui-`/`reach-` prefixes) and **state/modifier
classes** (`--is-focused`, `is-selected`, hashed CSS-in-JS state), anchoring instead on the
nearest stable id + semantic classes + `:nth-of-type`. So the selectors it hands you
survive the next re-render. Still, for list/menu items the most robust target is `text` +
`within`.

**Robot cursor (visual feedback)** — on the **content-script driver** path, every
`click`/`hover`/`type` shows a fake arrow cursor that glides to the target's centre
coordinates and pulses a ring on click, so you can watch the agent act like a hand-moved
mouse. It's a `pointer-events:none` shadow-root overlay (`#tc-agent-cursor`, `data-tc-ignore`)
— transparent to `elementFromPoint`, ignored by the diff/picker, top-frame only — so it
never affects what gets clicked. The cursor glides from its last spot (distance-scaled
~120–420ms) and fades after ~2.6s idle. It appears only while the tab's 🤖 drive toggle is
ON (that's the only time drives run). NOTE: the chrome.debugger drive path (clean tabs) is
OS-level and does not paint this overlay — it shows on the content-script path (e.g. a tab
where a foreign extension forced the fallback).

**Click the button, not its wrapper** — `click` by `text` matches the first
element in DOM order with that text, which can be a wrapper `div` whose text equals
the button's, OR a same-text element elsewhere on the page. For submit buttons click by
a precise `selector`; to disambiguate a repeated label, add `within`.

**Verifying field values** — value-attribute reflection is inconsistent across
inputs (some React fields don't mirror `.value` to the attribute). Read the whole
modal's input list rather than trusting one attribute, or screenshot.

**Screenshots / background tabs** — drive and reads work on background tabs without
focus (chrome.debugger Input and content-script events don't need a focused window).
Full-viewport screenshots use `captureVisibleTab` scoped to the tab's own window, so
they work on a **background window's active tab** too — no `/tab/activate` needed.
Element-clipped screenshots still use `chrome.debugger` (blocked when a foreign
extension injected a frame). A truly hidden tab (not the active tab of its window, or
a minimized window) can only be screenshotted via the debugger, or after activating.

**"Cannot access a chrome-extension:// URL of different extension"** — `chrome.debugger`
refuses any tab that contains a frame owned by **another** extension (e.g. a
password-manager autofill iframe). The bridge auto-falls-back to the content-script
driver for `click/type/navigate/scroll/hover/key/select/wait`; `drag/dialog/cdp-raw/
evaluate` stay debugger-only. To restore the debugger path, disable the offending
extension for that site (`GET /targets` names it).

**Dependent fields** — some fields enable only after an upstream selection (e.g. a
reference field that unlocks after choosing an account); fill in the right order.

---

## Safety

These endpoints act in the user's real, authenticated session. For
**irreversible or outward-facing actions** — submitting a payment/transfer,
sending a message, deleting data — **fill the form but stop before the final
Send/Confirm**, and only submit with the user's explicit confirmation and the
actual data. Never invent financial data. With `/fill`, that means **call it
without `submit`** for such forms (fill only); add `submit` only after the user
confirms. For safe/idempotent forms (search, filters), `submit` is fine.

See also: the `Browser Control` built-in skill (a concise, agent-facing version of
this reference).
