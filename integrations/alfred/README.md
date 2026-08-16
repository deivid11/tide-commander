# Tide Commander — Alfred Workflow

Search Tide Commander from Alfred on macOS. The server does the searching and
returns ready-to-render Alfred items (`GET /api/alfred/search` and
`GET /api/alfred/sessions` in `src/packages/server/routes/alfred.ts`), so the
workflow itself is a thin `curl` — no dependencies beyond macOS built-ins.

## Keywords

| Keyword | What it searches | Enter | ⌘+Enter | ⌥+Enter |
|---|---|---|---|---|
| `tc [query]` | Agents (name · class · status · cwd · area · last task), buildings, areas. Empty query = most recently active agents. | Focus the agent in any **open** Tide Commander UI (via `POST /api/focus-agent`) | Open the agent in the browser (`?agentId=…` deep link) | Copy the agent id |
| `tcs [query]` | Full-text across every agent conversation — claude, grok, codex, opencode and pi harnesses (AND-of-words, ≥3 chars) | Focus the agent holding the conversation | Open that agent in the browser | — |

Areas appear as autocomplete rows: pressing Enter on an area fills the query
with its name, listing every agent inside it.

## Keyword-less search (fallbacks + hotkey)

Alfred does not let workflows inject rows inline into its default results, but
the workflow ships two triggers that get you keyword-less access:

- **Fallback searches** — type `daisy designer` bare and pick
  "Search Tide Commander" (or "…conversations") from the fallback rows; Alfred
  re-enters the query through the live `tc`/`tcs` filter. Enable once in
  Alfred Preferences → **Features → Default Results → Setup fallback results**
  → **+** → *Workflow Triggers* → add both Tide Commander entries. Fallbacks
  show front-and-center when nothing else matches, and at the bottom otherwise.
- **Hotkey** — the workflow has an (unassigned) Hotkey node wired to open
  Alfred directly in `tc ` search mode. Assign a combo in Alfred Preferences →
  Workflows → Tide Commander → double-click the Hotkey node (e.g. ⌥Space).

## Install

Copy this folder into Alfred's workflows directory (or double-click a packaged
`.alfredworkflow`):

```bash
DEST="$HOME/Library/Application Support/Alfred/Alfred.alfredpreferences/workflows/user.workflow.tide-commander"
mkdir -p "$DEST" && cp info.plist icon.png "$DEST/"
```

Then in Alfred → Workflows → Tide Commander → **Configure Workflow** set:

- **Server URL** — where the Tide Commander server is reachable from the Mac
  (e.g. `http://192.168.1.100:5174`), no trailing slash.
- **API token** — the server's `X-Auth-Token`.

## Packaging

A `.alfredworkflow` file is just a zip of this folder's contents:

```bash
cd integrations/alfred && zip -j tide-commander.alfredworkflow info.plist icon.png
```

## Requirements

The Tide Commander server must include the `/api/alfred/*` routes (v1.189+).
Older servers make the workflow show "Tide Commander unreachable".
