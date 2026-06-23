import type { BuiltinSkillDefinition } from './types.js';

export const browserControl: BuiltinSkillDefinition = {
  slug: 'browser-control',
  name: 'Browser Control',
  description: "Observe and drive the user's live browser — read DOM/console/network, click/type/navigate elements, and get a per-action DOM diff of what changed — via /api/browser/*",
  allowedTools: ['Bash(curl:*)'],
  content: `# Browser Control

Observe and drive the user's **real, logged-in browser** through the Tide Commander
extension. Reads run in the live session; manipulation drives the actual tab. Wrap
every call with the scaffolding from the API Calling Convention above (host + the
\`X-Auth-Token\` header). These endpoints are NOT agent-scoped — no \`agentId\` in the body.

## Prerequisites
- The extension's **side panel must be open** (it hosts the bridge WebSocket).
- The target tab's **🤖 drive toggle must be ON** (side panel header). Manipulation
  is **OFF by default, per tab** — reads always work, but click/type/navigate are
  refused (\`Agent manipulation is OFF for this tab\`) until that tab is turned on.
- The page origin must be in the extension's allowlist, else drive returns \`Refused: … is not in the allowlist\`.
- Check first: \`GET /api/browser/status\` → \`{extensionConnected, clients[]}\` (each client = ip / userAgent / origin / host).

## Target a tab
Every command accepts \`tabId\` (exact, from \`GET /api/browser/tabs\`) **or** \`tab\` (a
URL/title substring, e.g. \`{"tab":"transfercld"}\`). Omit both to use the active tab.

## Reads (always available)
- \`POST /api/browser/dom\` \`{selector, all?}\` → outerHTML/text/box/styles + **\`field\`** (live \`value\`/\`checked\`/\`selectedText\`/\`disabled\` for input/textarea/select). Read form state from \`field\`, NOT from the value attribute (React often doesn't mirror it) and NOT via \`evaluate\` (its content-script fallback is CSP-blocked). Bulky \`<svg>\` icon markup is stripped to a compact \`<svg data-icon>\` placeholder by default (token saver) — pass \`"keepSvg":true\` to keep it.
- \`POST /api/browser/dom\` \`{actionable:true, selector?, limit?}\` → **one-call map of what you can click/type**: a compact, DOM-ordered list of the interactive elements rendered (\`button\`/\`a\`/\`input\`/\`select\`/\`[role=button]\`/…), each \`{tag, selector, text, role?, type?, placeholder?, value?, checked?, disabled?, href?}\`. Hidden / zero-size elements are skipped, nested ones collapse to the outermost clickable, icon-only buttons get their \`aria-label\` as \`text\`. Scope it with \`selector\` (e.g. \`{"actionable":true,"selector":".Modal-container"}\` = "what can I do in this modal"). **Use this to find your target in ONE read instead of guessing selectors.** Content-script only (no debugger fallback).
- \`POST /api/browser/console\` \`{level?, limit?}\` · \`POST /api/browser/network\` \`{detail?, filter?, limit?}\` · \`POST /api/browser/errors\` \`{limit?}\`
- \`POST /api/browser/page\` → \`{tabId, url, title}\`
- \`POST /api/browser/screenshot\` \`{selector?}\` → \`{path}\` to Read (viewport when no selector)

## Drive (needs 🤖 ON)
- \`POST /api/browser/fill\` \`{fields:[{selector, text, clear?}], submit?, diff?}\` — **fill a whole form in ONE call.** Types every field in order (React-safe), then optionally clicks \`submit\` (a selector) ONCE with a diff so validation errors / the confirm modal come back in the same response. Returns \`{filled:[{selector, ok, error?}], submitted?, diff?}\`. **This is the REQUIRED way to fill multiple fields — do NOT make one \`/type\` call per field.**
- \`POST /api/browser/click\` \`{selector | text, within?}\` — \`text\` matches visible text (exact→ci→contains)
- \`POST /api/browser/type\` \`{selector, text, clear?, within?}\` — React-safe; for a SINGLE field only (≥2 fields → use \`/fill\`)
- **\`within\` (a CSS selector) scopes the match to that subtree** on click/type/select/hover/scroll. Use it whenever the same text/label/selector ALSO appears in background content — e.g. clicking the dropdown option \`{"text":"BBVA BANCOMER"}\` while a transactions table behind the modal has BBVA rows would otherwise hit the first page-wide match (the table row) and open the wrong thing. Scope it: \`{"text":"BBVA BANCOMER","within":".tide-react-select__menu"}\` (or the open modal, \`".Modal-container"\`). Resolution waits for \`within\` to mount, so you can fire it right after opening the menu/modal.
- \`POST /api/browser/navigate\` \`{url}\` · \`/scroll\` \`{selector|text}\` · \`/hover\` \`{selector|text}\`
- \`POST /api/browser/key\` \`{key, selector?}\` — \`Enter\`, \`Tab\`, \`Escape\`, \`ArrowDown\`, …
- \`POST /api/browser/select\` \`{selector, value | label}\` — native \`<select>\` only
- \`POST /api/browser/wait\` \`{selector | text | ms}\` · \`/evaluate\` \`{expression}\` → \`{value}\`
- \`POST /api/browser/drag\` \`{from, to}\` · \`/dialog\` \`{accept?, promptText?}\` · \`/cdp-raw\` \`{method, params?}\`
- \`POST /api/browser/batch\` \`{tab|tabId, steps:[{cmd, …}]}\` — runs ANY steps in order (mixed click/type/wait/…), stops at first failure unless the step has \`continueOnError\`. Use for non-form multi-step flows; for pure form-filling prefer \`/fill\`.
- Tabs: \`POST /api/browser/tab/{open,close,activate}\`

Every call returns \`{ok:true, result}\` or \`{ok:false, error}\`. **If you pipe to \`jq\`, use
the right paths — wrong paths return \`null\`, which is NOT the API failing** (it's your
filter missing). The result nests by command:
- single \`/dom\` → \`.result.node\` (text \`.result.node.text\`, live value \`.result.node.field.value\`, markup \`.result.node.outerHTML\`)
- \`/dom {all:true}\` → \`.result.nodes[]\` · \`/dom {actionable:true}\` → \`.result.actionable[]\`
- drives → \`.result.diff\` and \`.result.ok\` — and a diff of \`{changed:false}\` has NO \`summary\`/\`added\` keys (so \`.result.diff.summary\` is \`null\` = "nothing changed", not a bug)
When in doubt, read the raw JSON once (no \`jq\`) to see the shape, then filter. And after a
click that opened a modal/menu, the fields/options are in \`.result.diff.added[].actions\` —
read THOSE, don't fire another \`/dom\`.

**Batch your actions — minimize round-trips.** Filling a form field-by-field with separate
\`/type\` calls is the #1 thing to avoid (each call re-resolves the tab + adds latency).
Fill the whole form with one \`/fill\` (text fields), or one \`/batch\` when the flow mixes
clicks/types/waits. react-select dropdowns aren't plain inputs — handle those with the
react-select recipe below (not \`/fill\`), then \`/fill\` the remaining text fields together.

Example — fill 5 fields and submit in a single call:
\`\`\`json
POST /api/browser/fill
{"tab":"transfercld","fields":[
  {"selector":"input[placeholder=\\"Cantidad\\"]","text":"5000"},
  {"selector":"input[placeholder=\\"Concepto\\"]","text":"Pago"},
  {"selector":"input[placeholder=\\"Referencia numérica\\"]","text":"1234567"},
  {"selector":"input[placeholder=\\"Cuenta del beneficiario\\"]","text":"5532967210"},
  {"selector":"input[placeholder=\\"Nombre del beneficiario\\"]","text":"Prueba"}
],"submit":"button.button.confirm","diff":true}
\`\`\`

## See what changed (DOM diff) — DEFAULT TO THIS
**Pass \`"diff":true\` on EVERY state-changing drive call** (click / type / select /
navigate / key). Then **READ the returned \`diff\` and confirm the action did what you
intended BEFORE the next step.** This is the cheapest, most reliable way to catch
"nothing happened", "wrong element", "a validation error appeared", or "the modal
didn't open" — do NOT fire a chain of clicks blind and assume they worked.

The result carries \`diff\` next to the action result — no separate read needed. It's a
MutationObserver delta (records mutations around the action, waits for them to settle,
**aggressively filtered for tokens**): \`diff: { summary[], added[], removed[], attrs[],
text[], truncated?, settled }\` — **no \`counts\` key** (it just duplicated the array
lengths) and **empty fields are omitted** (a clean dropdown pick is just
\`{ summary:["seleccionó: X"], settled }\`). Filtering: \`style\` + framework class/aria churn
dropped; presentational add/remove churn dropped (the floating \`<span class="label">\` that
animates in on \`type\`, loading bars/spinners, injected \`<style>\` from extensions like
DarkReader); **react-select chrome is folded** — the chosen value collapses to
\`summary:["seleccionó: <value>"]\` and the wrapper churn (\`__control\`/\`__placeholder\`/
\`__single-value\`/indicators + \`aria-expanded\`/\`class\`/\`value\` attr noise) is dropped,
BUT the **menu/option nodes stay in \`added\`** (with their compact html) and the summary
also lists the labels — \`abrió/filtró lista de opciones (N): opt1, opt2, …\` — so you see
both what's selectable AND its markup without a separate read; only stateful attrs
(\`disabled\`/\`value\`/\`checked\`/\`aria-invalid\`/…) and stateful \`class\` tokens survive (as
\`{attr:'class', add, remove}\`); lists cap at ~10 nodes / ~12 attrs with the overflow
reported in \`truncated\`. Each node is \`{tag,id,classes,selector,text,html}\` — \`html\` is a
COMPACT outerHTML (\`<svg>\`/\`<style>\` stripped, whitespace collapsed, truncated ~400 chars)
so you can see WHAT appeared (a modal's fields, an error block's markup) without a
follow-up \`/dom\` read. **\`added\` nodes ALSO carry \`actions\`** — the interactive
descendants (\`[{selector, text, type?, placeholder?, disabled?}]\`, capped 8, overflow in
\`actionsTruncated\`) of the thing that appeared. So when a modal/menu/dialog opens, the
diff hands you the fields/options/buttons + their exact selectors to act on next — **no
follow-up \`/dom {actionable:true}\` read, and never guess an option selector**;
\`summary\` is deduped & human-readable ("abrió modal/diálogo: Nueva transacción",
"seleccionó: BANAMEX", "+1 fila", "habilitó #ref").
Pass \`"diffVerbose":true\` only if you need the raw firehose (html, style, all attrs).

Read it like this:
- \`summary\` first — a one-glance "did the right thing happen?".
- after a react-select pick, \`summary: ["seleccionó: <value>"]\` confirms the choice
  landed — no need for a separate read of \`.tide-react-select__single-value\`.
- **\`diff: {changed:false}\`** = no meaningful DOM change (the empty skeleton is collapsed
  to this one marker to save tokens). After a **click** that should open a modal / add a
  row / show an error, \`changed:false\` means the action had NO effect → re-check the
  selector before retrying. After a **\`type\` into a plain text field, \`changed:false\` is
  NORMAL** (React doesn't mutate the DOM for value) — it does NOT mean the type failed;
  confirm the value with \`/dom\`'s \`field\` if it matters.
- \`added\` with a modal/dialog/menu ⇒ a form/list opened — its fields/options are already
  in that node's \`actions\` (selector + label), so click/type/fill straight from there
  instead of reading the modal again or guessing an \`#…-option-N\` index.
- \`added\` \`errors-block\` / \`attrs\` with \`disabled\`/validation classes ⇒ a validation
  error showed or a field unlocked — read the error text, that's the actionable signal.

Tune with \`"settleMs"\` (quiet window, default 350; raise for slow/async apps) and
\`"diffRoot"\` (CSS selector to scope the observer and cut noise). Skip \`diff\` only for
pure reads or trivially safe actions where the effect doesn't matter.

## Recipes & gotchas
- **Discover, don't guess selectors.** A missing selector on a drive call fails after an
  ~8s wait with \`no element matches "<selector>" (waited 8s) — re-list current elements
  with /dom {actionable:true}\`. When you see that, do EXACTLY that — DON'T re-guess the
  selector or fall back to screenshots (both just burn more time). Call
  \`/dom {actionable:true}\` (optionally scoped with \`selector\`, e.g. the open modal) to
  get the real clickable elements + selectors/labels in one read, then act. Don't guess
  framework selectors for an app you haven't inspected (e.g. PatternFly \`.pf-v5-c-button\`)
  and don't click tiny ambiguous text like \`{"text":"+"}\` — both just time out.
- **Dynamic forms reshape on selection.** Picking a dropdown/react-select value can ADD or
  REMOVE other fields (e.g. choosing a bank swaps "Cuenta del beneficiario" for a phone
  field and drops "Nombre del beneficiario"). Selectors you read BEFORE the pick can go
  stale. After a select that might restructure the form, **re-read \`/dom {actionable:true}\`
  before \`/fill\`** — don't reuse the pre-selection field list.
- **Content-script driver = simple selectors only.** On a tab where chrome.debugger is
  blocked (foreign-extension frame, e.g. LastPass), drives use the content-script driver,
  which doesn't support complex CSS like \`:has()\` — those time out. Use a plain
  \`#id\`/\`.class\`/\`[attr]\` selector or \`text\`.
- **Click reliability ceiling.** The content-script driver clicks by hit-testing the
  element's centre point and dispatching a real pointer/mouse sequence there — but those
  synthetic events are \`isTrusted:false\` (a browser security invariant; passing
  coordinates does NOT make them trusted). 99% of handlers fire fine; a few that demand a
  trusted click (some drag/native-picker/anti-bot widgets) won't. The ONLY trusted,
  OS-level click is the **chrome.debugger** drive path — which is what a foreign extension
  (LastPass autofill) blocks on a tab. If a click truly won't register, disable that
  extension for the site (or use a browser profile without it) so chrome.debugger attaches;
  then drives are real trusted input. If a \`click\` returns \`changed:false\`, first check
  you're targeting the element that owns the handler (e.g. a react-select control, not its
  input) before assuming a trust problem.
- **react-select** (not a native \`<select>\`): the RELIABLE way to open it is **\`type\` the query straight into \`#react-select-N-input\`** — that opens AND filters in one step (proven). A \`click\` (on the input OR the \`.tide-react-select__control\`) often does NOT open the menu with the synthetic content-script driver and returns \`changed:false\` — so don't fight it with clicks; **just \`type\`.** To open the FULL list without a filter, \`key\` \`ArrowDown\` on \`#react-select-N-input\` (react-select's keyboard-open). Once open, \`click\` the option. **Do NOT click by a raw \`#react-select-N-option-M\` id — react-select RENUMBERS those on every filter/re-render, so the id you read is often stale by the time you click (→ "no element matches").** Two robust ways: (a) \`click\` the \`selector\` the diff's \`actions\` gives you (the bridge now anchors it on the stable \`#react-select-N-listbox\` + position, not the volatile id), or (b) \`click\` by \`text\` **scoped to the menu** — \`{"text":"BBVA BANCOMER","within":"#react-select-N-listbox"}\` (bare \`text\` without \`within\` is the classic mis-click — the same label in a background table/list wins). Confirm via \`.tide-react-select__single-value\`.
- **Submit buttons:** click by a precise \`selector\`, not \`text\` — \`text\` can match a wrapper element whose text equals the button's.
- **Verifying values:** read \`/dom\`'s \`field.value\`/\`field.checked\`/\`field.selectedText\` (live DOM properties) — don't trust the \`value\` attribute (React often won't mirror it) and don't use \`evaluate\` for reads (CSP-blocked unless the debugger path is available).
- **Reads are clean:** a read with no match returns \`no element matches <selector>\` (it no longer falls back to the debugger, so it won't surface the cross-extension error); \`<svg>\` and \`<style>\` blocks are collapsed to compact placeholders (pass \`keepSvg:true\` to keep them).
- **Screenshots:** element-clip uses chrome.debugger; full-viewport \`captureVisibleTab\` needs the tab's window focused (\`/tab/activate\` first).
- **"Cannot access a chrome-extension:// URL of different extension":** another extension (e.g. a password manager's autofill iframe) injected a frame, so chrome.debugger can't attach. The bridge auto-falls-back to a content-script driver for click/type/navigate/scroll/hover/key/select/wait (synthetic events; \`evaluate\`/\`drag\`/\`dialog\`/\`cdp-raw\` stay debugger-only). \`GET /api/browser/targets\` names the culprit extension.

## Safety
These act in the user's authenticated session. For **irreversible or outward-facing
actions** (submitting a payment/transfer, sending a message, deleting data): **fill
the form but STOP before the final Send/Confirm**, and submit only with the user's
explicit confirmation and the actual data. Never invent financial data. With \`/fill\`,
that means **call it WITHOUT \`submit\`** for such forms (fill only) — add \`submit\` only
after the user confirms; for safe/idempotent forms (search, filters) \`submit\` is fine.`,
};
