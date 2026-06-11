import type { BuiltinSkillDefinition } from './types.js';

const BT3 = '```';

export const exploreDatabase: BuiltinSkillDefinition = {
  slug: 'explore-database',
  name: 'Explore Database',
  description: 'Inspect database buildings via the Tide Commander API: list connections, browse databases/tables, read schemas, and run SQL.',
  allowedTools: ['Bash(curl:*)', 'Bash(jq:*)'],
  content: `# Explore Database Skill

Inspect any **database building** via the internal HTTP API: list connections, browse databases/tables, read schemas, execute SQL. All endpoints live under \`/api/database/\` and use the standard \`X-Auth-Token\` auth header. Engines: **mysql, postgresql, oracle, sqlite, mssql**. SSH tunnels are applied automatically when configured on the connection. Passwords are never returned — \`hasPassword: true\` is the only signal; never log credentials.

## Endpoint Reference

| Endpoint | Method | Purpose |
|---|---|---|
| \`/api/database/buildings\` | GET | List every database building (redacted connections) |
| \`/api/database/buildings/{buildingId}\` | GET | One database building with all its connections |
| \`/api/database/buildings/{buildingId}/connections/{connectionId}/test\` | POST | Verify the connection works |
| \`/api/database/buildings/{buildingId}/connections/{connectionId}/databases\` | GET | List databases on the server |
| \`/api/database/buildings/{buildingId}/connections/{connectionId}/databases/{database}/tables\` | GET | List tables/views in a database |
| \`/api/database/buildings/{buildingId}/connections/{connectionId}/databases/{database}/tables/{table}/columns\` | GET | **Describe table — columns only** (lean) |
| \`/api/database/buildings/{buildingId}/connections/{connectionId}/databases/{database}/tables/{table}/schema\` | GET | Full schema: columns + indexes + foreign keys |
| \`/api/database/buildings/{buildingId}/connections/{connectionId}/query\` | POST | Run SQL — body \`{database, query, limit?, recordHistory?}\` |
| \`/api/database/buildings/{buildingId}/history\` | GET | Recent query history (\`?limit=N\`) |

## Workflow

${BT3}bash
# 1) Discover buildings + connections; activeConnectionId hints at the user's usual one
curl -s http://localhost:5174/api/database/buildings \\
  | jq '.buildings[] | {id, name, activeConnectionId, conns: [.connections[] | {id, engine, host, port, database}]}'

CONN=http://localhost:5174/api/database/buildings/BUILDING_ID/connections/CONNECTION_ID

# 2) Always test before heavy queries — brings up SSH tunnels, validates credentials cheaply
curl -s -X POST $CONN/test
# → {"success":true,"serverVersion":"8.0.36"} or {"success":false,"error":"..."}

# 3) Browse
curl -s $CONN/databases | jq
curl -s $CONN/databases/MY_DB/tables | jq '.tables | map(.name)'

# 4) Table schema → { database, table, columns, indexes, foreignKeys }; use /columns for the lean version
curl -s $CONN/databases/MY_DB/tables/users/schema | jq

# 5) Run SQL
curl -s -X POST $CONN/query -H "Content-Type: application/json" \\
  -d '{"database":"MY_DB","query":"SELECT id, email FROM users WHERE created_at > NOW() - INTERVAL 1 DAY","limit":50}'

# Mutations execute too — affectedRows is reported instead of rows.
# recordHistory:true persists the query into the building's history (visible in the UI):
curl -s -X POST $CONN/query -H "Content-Type: application/json" \\
  -d '{"database":"MY_DB","query":"SELECT COUNT(*) AS n FROM users","recordHistory":true}'

# 6) History — only queries run with recordHistory:true (or executed via the UI) appear
curl -s "http://localhost:5174/api/database/buildings/BUILDING_ID/history?limit=20" \\
  | jq '.history[] | {executedAt, status, duration, query}'
${BT3}

**Response shape (success):**
${BT3}json
{
  "id": "q_1700000000000_abc123",
  "status": "success",
  "duration": 12,
  "rows": [{"id":1,"email":"a@b.com"}],
  "fields": [{"name":"id","type":"INT"}, {"name":"email","type":"VARCHAR"}],
  "rowCount": 1
}
${BT3}

**Response shape (error):** \`{ "status": "error", "error": "...", "errorCode": "..." }\` — HTTP \`400\` for SQL errors, \`500\` only for unexpected failures.

## Rules

1. **LIMIT is automatic.** SELECTs without a LIMIT/TOP/FETCH clause are wrapped server-side using the \`limit\` body field (default 1000, max 10000); adding one manually is optional.
2. **One query per request.** The execute endpoint runs a single statement — no multi-statement scripts.
3. **Mutations are real.** \`UPDATE\`, \`DELETE\`, \`DROP\`, etc. execute against the live connection — confirm building/connection IDs before destructive ops.
4. **Engine quirks:** Oracle — \`{database}\` is the **schema/owner** (e.g. \`SCOTT\`, \`HR\`). SQLite — \`{database}\` is typically \`main\` (or the file path); pragma queries work as raw SQL. SQL Server — \`TOP n\` is auto-injected for SELECTs without it.
`,
};
