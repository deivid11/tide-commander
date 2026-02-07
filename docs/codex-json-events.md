# Codex Exec JSON Event Notes

Observed from:

`codex exec --json --full-auto "..."`

## Top-level event envelope

Each line is a JSON object with a `type` field.

Common top-level types seen:

- `thread.started`
- `turn.started`
- `item.started`
- `item.completed`
- `turn.completed`

## Item payload shapes

`item.started` and `item.completed` include an `item` object with `item.type`.

Observed `item.type` values:

- `reasoning`
- `web_search`
- `agent_message`

### `reasoning`

Example:

- `{"item":{"type":"reasoning","text":"**Preparing web search query**"}}`

Normalization idea:

- map to non-user-facing debug/thinking metadata, or ignore for UI output.

### `web_search`

Observed structure:

- `item.id` (tool/event id like `ws_...` or item id)
- `query`
- `action`

Observed `action.type` values:

- `other` (start state placeholder)
- `search` (with `query` and `queries[]`)
- `open_page` (with `url`)

Normalization idea:

- map to `tool_start`/`tool_result` pair:
  - `toolName = "web_search"`
  - `toolInput` from `action.query`/`action.queries`/`action.url`.

### `agent_message`

Observed structure:

- `{"item":{"type":"agent_message","text":"..."}}`

Normalization idea:

- map to `text` output event.
- multiple `agent_message` items can occur in one turn.

## Turn completion

`turn.completed` includes `usage`:

- `input_tokens`
- `cached_input_tokens`
- `output_tokens`

Normalization idea:

- map to `step_complete` with tokens:
  - `input = input_tokens + cached_input_tokens` (or keep cached separate in modelUsage)
  - `output = output_tokens`

## Parser implications for Tide Commander

- Do not assume Claude-style `stream-json` event schema.
- Build a Codex-specific parser for line events first, then convert to runtime-normalized events.
- Keep provider-specific metadata (`action`, `queries`, `url`) in `toolInput`.
