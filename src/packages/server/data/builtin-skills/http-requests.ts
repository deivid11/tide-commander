import type { BuiltinSkillDefinition } from './types.js';

export const httpRequests: BuiltinSkillDefinition = {
  slug: 'http-requests',
  name: 'HTTP Request Tests',
  description:
    'Browse and fire IntelliJ-style .http request files via the Tide Commander http-requests API; results render as rich cards in the terminal (method, status, timing, body preview).',
  allowedTools: ['Bash(curl:*)', 'Bash(jq:*)'],
  // Not assigned to anyone by default — enable it per agent/class in the Skills panel.
  assignedAgentClasses: [],
  content: `# HTTP Request Tests

Run requests from IntelliJ-style \`.http\` / \`.rest\` files through \`/api/http-requests/*\` (never by hand-crafting the HTTP call yourself) so each result is persisted to the building's history and renders as a **rich card** in the user's terminal — method, status pill, timing, size and a body preview instead of raw JSON.

Use this when asked to fire/test HTTP requests from a project's \`.http\` files, smoke-test API endpoints defined there, or report on past request runs. The folder usually comes from an \`http\`-type building — find it with \`GET /api/buildings\` (look for \`"type":"http"\`, use its \`folderPath\`).

All calls use the API Calling Convention scaffolding (host, \`-H "X-Auth-Token: ..."\`). No exclamation marks in commands.

## 1. Scan — list files, requests and environments

\`POST /api/http-requests/scan\`
\`\`\`json
{"path":"/abs/path/to/http-folder"}
\`\`\`
Returns every parsed file with its requests (0-based \`index\`, \`name\`, \`method\`, \`url\`, \`variables\`) plus \`environments\` (from \`http-client.env.json\` / \`http-client.private.env.json\`) and \`envFiles\`. Pipe through \`jq\` to keep it short, e.g. \`jq '{environments, files: [.files[] | {relFile, requests: [.requests[] | {index, name, method}]}]}'\`.

## 2. Run one request

\`POST /api/http-requests/run\`
\`\`\`json
{"agentId":"YOUR_AGENT_ID","path":"/abs/path/to/http-folder","relFile":"payment-order.http","requestIndex":2,"env":"dev"}
\`\`\`
- \`agentId\` (IMPORTANT) — your agent ID from the system prompt. With it, a live card appears in the user's terminal under your curl the moment the request fires (spinner → method/status/time/body, with Re-run and copy-curl buttons). Without it, nothing renders.
- \`requestIndex\` — the request's 0-based \`index\` from the scan.
- \`env\` (optional but usually required) — environment name for \`{{variable}}\` resolution; omit only when the file has no variables. \`unresolvedVariables\` in the response tells you what was missing.

Synchronous: the response IS the result (\`ok\`, \`status\`, \`timeMs\`, \`sizeBytes\`, \`headers\`, \`body\`, resolved \`request\`, \`runId\`). 60s timeout, 2 MB body cap.

Silence the response with \`-o /dev/null\` if you don't need to inspect it (the card already shows everything to the user), or print it as-is (plain \`curl -s\`, no jq filter) — printed run JSON also renders as a card. To READ a field yourself, fetch \`GET /runs/RUN_ID\` afterwards and jq that.

## 3. Run several / "run all in a file"

Run each request as its OWN curl command (one Bash call per request, agentId included) so every run gets its own live card in the terminal. Avoid shell for-loops — a loop is a single Bash line, so only the last run's card would attach to it. Do not parallelize.

## 4. History

\`GET /api/http-requests/history?folder=/abs/path&limit=20\` — recent executed requests for that folder (newest first). Printing this JSON also renders as a card (compact list of runs). \`GET /api/http-requests/runs/RUN_ID\` returns one stored run with the full request/response detail.

## Rules
- A non-2xx status or \`"ok":false\` (connection refused, timeout) is a **normal result to report**, not an API error — summarize which requests passed/failed and why.
- Prefer the building's configured folder; for ad-hoc paths anything under the home directory works.
- Requests hit real endpoints. Fire GETs freely; for POST/PUT/PATCH/DELETE against non-test systems, confirm with the user first unless they explicitly asked.
- After a batch, finish with a short written summary (counts + failures); the cards complement it, they don't replace it.`,
};
