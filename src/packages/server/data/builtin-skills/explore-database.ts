import type { BuiltinSkillDefinition } from './types.js';

const BT3 = '```';

export const exploreDatabase: BuiltinSkillDefinition = {
  slug: 'explore-database',
  name: 'Explore Database',
  description: 'Inspect database buildings via the Tide Commander API: list connections, browse databases/tables, read schemas, and run SQL.',
  allowedTools: ['Bash(curl:*)', 'Bash(jq:*)'],
  content: `# Explore Database Skill

This skill lets you inspect any **database building** in Tide Commander through the
internal HTTP API. You can list connections, list databases/tables, read schemas,
and execute SQL — all without leaving the curl pattern.

All endpoints live under \`/api/database/\` and use the same auth header as every
other Tide Commander skill (\`X-Auth-Token\`). Passwords are never returned by the
API; responses include a \`hasPassword\` boolean instead.

---

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

Engines supported: **mysql, postgresql, oracle, sqlite, mssql**. SSH tunnels are
applied automatically when configured on the connection.

---

## Step 1: Discover database buildings

${BT3}bash
# List all DB buildings + their connections (redacted)
curl -s http://localhost:5174/api/database/buildings | jq

# Compact view: just id/name/engine of each connection
curl -s http://localhost:5174/api/database/buildings \\
  | jq '.buildings[] | {id, name, conns: [.connections[] | {id, engine, host, port, database}]}'
${BT3}

Pick the **buildingId** and **connectionId** you want to explore. The \`activeConnectionId\`
field hints at the one the user typically works with.

## Step 2: Verify the connection

Always run a test before any heavy query — it brings up SSH tunnels and validates
credentials cheaply.

${BT3}bash
curl -s -X POST http://localhost:5174/api/database/buildings/BUILDING_ID/connections/CONNECTION_ID/test
# → {"success":true,"serverVersion":"8.0.36"} or {"success":false,"error":"..."}
${BT3}

## Step 3: Browse databases and tables

${BT3}bash
# List databases on the server
curl -s http://localhost:5174/api/database/buildings/BUILDING_ID/connections/CONNECTION_ID/databases | jq

# List tables/views in a specific database
curl -s http://localhost:5174/api/database/buildings/BUILDING_ID/connections/CONNECTION_ID/databases/MY_DB/tables | jq

# Compact: just names
curl -s http://localhost:5174/api/database/buildings/BUILDING_ID/connections/CONNECTION_ID/databases/MY_DB/tables \\
  | jq '.tables | map(.name)'
${BT3}

For Oracle, "database" means **schema/owner** (e.g. \`SCOTT\`, \`HR\`). For SQLite the
"database" is the file path or \`main\`.

## Step 4: Inspect a table's schema

${BT3}bash
curl -s http://localhost:5174/api/database/buildings/BUILDING_ID/connections/CONNECTION_ID/databases/MY_DB/tables/users/schema | jq
${BT3}

Returns \`{ database, table, columns, indexes, foreignKeys }\`. Use this to
discover columns before writing a SELECT.

## Step 5: Run SQL

${BT3}bash
# Read query — limit defaults to 1000, capped at 10000
curl -s -X POST http://localhost:5174/api/database/buildings/BUILDING_ID/connections/CONNECTION_ID/query \\
  -H "Content-Type: application/json" \\
  -d '{"database":"MY_DB","query":"SELECT id, email FROM users WHERE created_at > NOW() - INTERVAL 1 DAY","limit":50}'

# Persist into the building's query history (visible in the UI)
curl -s -X POST http://localhost:5174/api/database/buildings/BUILDING_ID/connections/CONNECTION_ID/query \\
  -H "Content-Type: application/json" \\
  -d '{"database":"MY_DB","query":"SELECT COUNT(*) AS n FROM users","recordHistory":true}'

# Mutating statements work too — affectedRows is reported instead of rows
curl -s -X POST http://localhost:5174/api/database/buildings/BUILDING_ID/connections/CONNECTION_ID/query \\
  -H "Content-Type: application/json" \\
  -d '{"database":"MY_DB","query":"UPDATE users SET active = 1 WHERE id = 42"}'
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

**Response shape (error):** \`{ "status": "error", "error": "...", "errorCode": "..." }\`
The HTTP status is \`400\` for SQL errors and \`500\` only for unexpected failures.

## Step 6: Review history

${BT3}bash
curl -s "http://localhost:5174/api/database/buildings/BUILDING_ID/history?limit=20" | jq '.history[] | {executedAt, status, duration, query}'
${BT3}

Only queries explicitly run with \`recordHistory:true\` (or executed via the UI)
appear here.

---

## Important Rules

1. **LIMIT is automatic.** SELECTs without a LIMIT/TOP/FETCH clause are wrapped
   server-side using the \`limit\` body field (default 1000, max 10000). You don't
   need to add it manually for safety, but you can.
2. **One query per request.** The execute endpoint runs a single statement; do
   not send multi-statement scripts.
3. **Mutations are real.** \`UPDATE\`, \`DELETE\`, \`DROP\`, etc. execute against the
   live connection — confirm the building/connection IDs before destructive ops.
4. **Engine quirks:**
   - Oracle: pass the **schema name** as \`{database}\`.
   - SQLite: typically \`main\`. Pragma queries work as raw SQL.
   - SQL Server: \`TOP n\` is auto-injected for SELECTs without it.
5. **Never log credentials.** Connection objects from the API never include
   passwords — \`hasPassword: true\` is the only signal.

## Example Workflow

${BT3}bash
# 1) Find DB buildings and pick one
curl -s http://localhost:5174/api/database/buildings \\
  | jq '.buildings[] | {id, name, activeConnectionId}'

# 2) Verify
curl -s -X POST http://localhost:5174/api/database/buildings/building_xxx/connections/conn_yyy/test

# 3) Pick a database, list its tables
curl -s http://localhost:5174/api/database/buildings/building_xxx/connections/conn_yyy/databases | jq
curl -s http://localhost:5174/api/database/buildings/building_xxx/connections/conn_yyy/databases/app_prod/tables \\
  | jq '.tables | map(.name)'

# 4) Inspect a table
curl -s http://localhost:5174/api/database/buildings/building_xxx/connections/conn_yyy/databases/app_prod/tables/orders/schema \\
  | jq '.columns | map({name, type, primaryKey, nullable})'

# 5) Run an exploratory query
curl -s -X POST http://localhost:5174/api/database/buildings/building_xxx/connections/conn_yyy/query \\
  -H "Content-Type: application/json" \\
  -d '{"database":"app_prod","query":"SELECT status, COUNT(*) c FROM orders GROUP BY status"}' \\
  | jq '.rows'
${BT3}
`,
};
