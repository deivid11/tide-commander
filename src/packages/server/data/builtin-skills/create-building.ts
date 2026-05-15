import type { BuiltinSkillDefinition } from './types.js';

const BT = '`';
const BT3 = '```';

export const createBuilding: BuiltinSkillDefinition = {
  slug: 'create-building',
  name: 'Create Building',
  description: 'Create, configure, control, and inspect buildings in Tide Commander via the /api/buildings REST API',
  allowedTools: ['Bash(curl:*)', 'Bash(jq:*)'],
  content: `# Create Building Skill

This skill manages buildings in Tide Commander's battlefield through the
REST API. The server validates input, assigns IDs, encrypts credentials,
broadcasts updates to connected clients, and reconciles PM2 / Docker /
Terminal runtime state. **Do not edit ${BT}buildings.json${BT} directly** — the
server is the authority for that file.

## API Calling Convention

Every call uses the standard scaffolding from your system prompt:

${BT3}bash
curl -s -X <METHOD> -H "X-Auth-Token: <TOKEN>" \\
  http://localhost:5174/api/buildings<path> \\
  -H "Content-Type: application/json" -d '<json-body>'
${BT3}

The substitutions on every call:
- ${BT}<METHOD>${BT} — HTTP verb (GET, POST, PATCH, DELETE)
- ${BT}<path>${BT} — endpoint path (begins with ${BT}/${BT})
- ${BT}<json-body>${BT} — JSON body (omit for GET/DELETE)
- ${BT}<TOKEN>${BT} — the auth token from your system prompt
- **No exclamation marks** anywhere in the command — bash history expansion will corrupt it.

## Endpoint Reference

| Method | Path | Purpose |
|--------|------|---------|
| GET    | ${BT}/api/buildings${BT}                            | List all buildings (secrets redacted) |
| GET    | ${BT}/api/buildings/:id${BT}                        | Get one building (secrets redacted) |
| POST   | ${BT}/api/buildings${BT}                            | Create a building |
| PATCH  | ${BT}/api/buildings/:id${BT}                        | Partial update |
| DELETE | ${BT}/api/buildings/:id?cleanup=false${BT}          | Delete (default: tear down PM2/Docker/etc.) |
| POST   | ${BT}/api/buildings/:id/command${BT}                | ${BT}{"command":"start|stop|restart|healthCheck|logs|delete"}${BT} |
| GET    | ${BT}/api/buildings/:id/logs?lines=200&service=foo${BT} | Snapshot logs (PM2/Docker/custom) |
| POST   | ${BT}/api/buildings/:id/sync-status${BT}            | Force PM2/Docker status refresh |
| POST   | ${BT}/api/buildings/:id/subordinates${BT}           | ${BT}{"subordinateBuildingIds":[...]}${BT} (boss only) |
| POST   | ${BT}/api/buildings/boss/:id/command${BT}           | ${BT}{"command":"start_all|stop_all|restart_all"}${BT} |
| GET    | ${BT}/api/buildings/docker/containers${BT}          | List adoptable Docker containers and compose projects |

The server assigns ${BT}id${BT}, ${BT}createdAt${BT}, ${BT}lastActivity${BT}, and initial
${BT}status${BT}. Do not send them. POST returns the full building (201). PATCH
returns the merged building. DELETE returns ${BT}{"deleted":true}${BT}.

Validation failures return ${BT}400${BT} with ${BT}{"error":"Validation failed","errors":[...]}${BT}.

## Step 1: Inspect what's there

${BT3}bash
# List all buildings — filter with jq for readability
curl -s -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  | jq '.buildings | map({id, name, type, status, cwd})'

# One building's full config
curl -s -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings/<id>

# All PM2 buildings
curl -s -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  | jq '.buildings[] | select(.pm2.enabled == true) | {name, port: .pm2.env.PORT, status}'

# Existing Docker containers ready to be adopted (mode "existing")
curl -s -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings/docker/containers \\
  | jq '.containers | map({id: .id[0:12], name, image, status})'
${BT3}

## Step 2: Building schema

These fields are accepted by ${BT}POST /api/buildings${BT}. ${BT}name${BT}, ${BT}type${BT}, and
${BT}position${BT} are always required. Style defaults per type if omitted.

${BT3}typescript
{
  name: string,                                       // Display name
  type: 'server'|'link'|'database'|'docker'|'monitor'|'folder'|'boss'|'terminal',
  position: { x: number, z: number },
  style?: 'server-rack'|'tower'|'dome'|'pyramid'|'desktop'
        | 'filing-cabinet'|'satellite'|'crystal'|'factory'|'command-center',
  color?: string,                                     // Hex (e.g. "#4a90d9")
  scale?: number,                                     // ~0.5 small, 1.0 large
  cwd?: string,                                       // Working directory
  pm2?:    { ... },                                   // Server type — see below
  docker?: { ... },                                   // Docker type — see below
  database?: { connections: [...] },                  // Database type
  terminal?: { ... },                                 // Terminal type
  folderPath?: string,                                // Folder type — required
  urls?: [{ label, url }],                            // Link type — required
  commands?: { start, stop, restart, healthCheck, logs },  // Non-PM2 server custom commands
  subordinateBuildingIds?: string[],                  // Boss type
}
${BT3}

### PM2 sub-schema (server buildings)

${BT3}typescript
pm2: {
  enabled: true,
  script: string,                                     // REQUIRED
  args?: string,
  interpreter?: ''|'node'|'bun'|'python3'|'python'|'java'|'php'|'bash'|'none',
  interpreterArgs?: string,
  env?: Record<string, string>,
  instances?: number,                                 // Cluster mode (default 1)
  autorestart?: boolean,                              // Default true
  maxRestarts?: number,                               // Default 10
  name?: string,                                      // Custom PM2 app name
}
${BT3}

### Docker sub-schema

${BT3}typescript
docker: {
  enabled: true,
  mode: 'container' | 'compose' | 'existing',

  // mode === 'container' (REQUIRED: image)
  image?: string,
  containerName?: string,
  ports?: string[],                                   // ["3000:3000"]
  volumes?: string[],                                 // ["/host:/container"]
  env?: Record<string, string>,
  network?: string,
  command?: string,
  restart?: 'no'|'always'|'unless-stopped'|'on-failure',
  pull?: 'always'|'missing'|'never',

  // mode === 'compose' (REQUIRED: composePath)
  composePath?: string,                               // Relative to cwd
  services?: string[],
  composeProject?: string,

  // mode === 'existing' (REQUIRED: containerName from /docker/containers)
}
${BT3}

### Database connection sub-schema

${BT3}typescript
database: {
  activeConnectionId?: string,
  activeDatabase?: string,
  connections: [{
    id: string,
    name: string,
    engine: 'mysql'|'postgresql'|'oracle'|'sqlite'|'mssql',
    host: string,                                     // omit for sqlite
    port: number,                                     // omit for sqlite
    username?: string,
    password?: string,                                // Encrypted at rest
    database?: string,                                // Service/PDB name for Oracle
    filepath?: string,                                // REQUIRED for sqlite
    ssl?: boolean,
    sslConfig?: { rejectUnauthorized, ca, cert, key },
    ssh?: {                                           // Optional SSH tunnel
      enabled: true,
      host, port, username,
      authMethod: 'password'|'privateKey',
      password?, privateKey?, privateKeyPath?, passphrase?,
      localPort?, keepaliveIntervalMs?, readyTimeoutMs?,
    },
  }],
}
${BT3}

### Terminal sub-schema

${BT3}typescript
terminal: {
  enabled: true,                                      // REQUIRED for type 'terminal'
  shell?: string,                                     // Defaults to $SHELL or bash
  port?: number,                                      // Auto-assigned from 7681+
  args?: string,                                      // Extra ttyd args
  saveSession?: boolean,                              // tmux-backed persistence
  sessionName?: string,
}
${BT3}

Default ports: MySQL 3306, PostgreSQL 5432, Oracle 1521, SQL Server 1433.

## Step 3: Create the building

### Bun/Node service with PM2

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "Wind Front",
  "type": "server",
  "style": "desktop",
  "color": "#4a3a2a",
  "position": {"x": -3.5, "z": -8.0},
  "cwd": "/home/user/projects/wind/front",
  "pm2": {
    "enabled": true,
    "script": "/home/user/.bun/bin/bun",
    "args": "run dev",
    "interpreter": "none",
    "env": {"PORT": "6205"}
  },
  "scale": 0.75
}'
${BT3}

For Vite frontends, the project's ${BT}vite.config.*${BT} must honour ${BT}process.env.PORT${BT}
(otherwise PM2 sets the var but Vite ignores it).

### Bun with port passed in args (no env var needed)

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "MDO Front",
  "type": "server",
  "position": {"x": -9.5, "z": 2.55},
  "cwd": "/home/user/projects/mdo/front",
  "pm2": { "enabled": true, "script": "bun", "args": "dev --port 6200", "interpreter": "none" }
}'
${BT3}

### Symfony service (port in args, no --daemon)

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "MDO Back",
  "type": "server",
  "position": {"x": -11.67, "z": 2.55},
  "cwd": "/home/user/projects/mdo/back",
  "pm2": {
    "enabled": true,
    "script": "symfony",
    "args": "server:start --allow-http --port=7200",
    "interpreter": "none"
  }
}'
${BT3}

**Symfony notes:** never use ${BT}--daemon${BT} — Symfony forks and exits, PM2 marks it errored.
If PM2 shows errored with "already running", stop the external daemon first:
${BT}symfony server:stop${BT} from the project directory, then ${BT}POST .../command { start }${BT}.

### PHP built-in server

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "Laravel App",
  "type": "server",
  "position": {"x": 0.77, "z": 3.96},
  "cwd": "/home/user/projects/laravel-app",
  "pm2": { "enabled": true, "script": "php", "args": "-S 0.0.0.0:7205 -t public", "interpreter": "none" }
}'
${BT3}

### Maven / Spring Boot

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "Pagamento",
  "type": "server",
  "position": {"x": -11.85, "z": 9.59},
  "cwd": "/home/user/projects/pagamento",
  "pm2": {
    "enabled": true, "script": "mvn", "interpreter": "none",
    "args": "spring-boot:run -Dspring-boot.run.fork=false -Dspring-boot.run.profiles=dev"
  }
}'
${BT3}

### Shell-script server (ActiveMQ)

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "ActiveMQ",
  "type": "server",
  "style": "filing-cabinet",
  "position": {"x": -7.30, "z": -0.15},
  "cwd": "/opt/apache-activemq-6.2.0",
  "pm2": { "enabled": true, "script": "./bin/activemq", "args": "console", "interpreter": "bash" }
}'
${BT3}

### Custom-command server (no PM2)

For servers where PM2 doesn't fit, define ${BT}commands${BT} directly. Each command runs in
${BT}cwd${BT}. Status transitions happen on command completion.

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "Legacy Service",
  "type": "server",
  "position": {"x": 5, "z": 5},
  "cwd": "/srv/legacy",
  "commands": {
    "start":       "./bin/start.sh",
    "stop":        "./bin/stop.sh",
    "restart":     "./bin/restart.sh",
    "healthCheck": "curl -fs http://localhost:9000/health",
    "logs":        "tail -n 200 /srv/legacy/log/app.log"
  }
}'
${BT3}

### Docker — new container

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "Redis",
  "type": "docker",
  "style": "dome",
  "position": {"x": -8, "z": -3},
  "cwd": "/home/user/projects/tide-commander",
  "docker": {
    "enabled": true,
    "mode": "container",
    "image": "redis:7-alpine",
    "ports": ["6379:6379"],
    "restart": "unless-stopped"
  }
}'
${BT3}

### Docker — compose project

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "App Stack",
  "type": "docker",
  "position": {"x": -10, "z": 0},
  "cwd": "/home/user/projects/app",
  "docker": {
    "enabled": true,
    "mode": "compose",
    "composePath": "docker-compose.yml",
    "services": ["web", "worker"]
  }
}'
${BT3}

### Docker — adopt existing container

First discover ${BT}containerName${BT}:

${BT3}bash
curl -s -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings/docker/containers \\
  | jq '.containers | map({name, image, status})'
${BT3}

Then adopt:

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "Postgres 18",
  "type": "docker",
  "style": "dome",
  "color": "#336699",
  "position": {"x": -11.49, "z": -2.31},
  "cwd": "/home/user/projects/tide-commander",
  "docker": { "enabled": true, "mode": "existing", "containerName": "postgres18" }
}'
${BT3}

Mode ${BT}existing${BT} is monitor-only: deleting the building never removes the container.

### Database — MySQL

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "MySQL",
  "type": "database",
  "style": "dome",
  "position": {"x": -9.78, "z": -0.34},
  "database": {
    "connections": [{
      "id": "conn_mysql_prod",
      "name": "Primary",
      "engine": "mysql",
      "host": "localhost",
      "port": 3306,
      "username": "root",
      "password": "root"
    }],
    "activeConnectionId": "conn_mysql_prod"
  }
}'
${BT3}

### Database — PostgreSQL

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "Postgres",
  "type": "database",
  "position": {"x": -8, "z": -0.34},
  "database": {
    "connections": [{
      "id": "conn_pg_dev",
      "name": "Dev",
      "engine": "postgresql",
      "host": "localhost",
      "port": 5432,
      "username": "postgres",
      "password": "postgres",
      "database": "appdb"
    }]
  }
}'
${BT3}

### Database — Oracle

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "Oracle",
  "type": "database",
  "style": "factory",
  "position": {"x": -7, "z": -0.34},
  "database": {
    "connections": [{
      "id": "conn_ora_dev",
      "name": "Dev",
      "engine": "oracle",
      "host": "127.0.0.1",
      "port": 1521,
      "username": "APP_USER",
      "password": "secret",
      "database": "ORCLPDB1"
    }]
  }
}'
${BT3}

### Database — SQLite

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "Local Cache",
  "type": "database",
  "position": {"x": -6, "z": -0.34},
  "database": {
    "connections": [{
      "id": "conn_sqlite",
      "name": "cache.db",
      "engine": "sqlite",
      "filepath": "/home/user/projects/app/cache.db"
    }]
  }
}'
${BT3}

### Database — with SSH tunnel

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "Prod MySQL via Bastion",
  "type": "database",
  "position": {"x": -5, "z": -0.34},
  "database": {
    "connections": [{
      "id": "conn_prod_via_ssh",
      "name": "Prod",
      "engine": "mysql",
      "host": "10.0.0.5",
      "port": 3306,
      "username": "appuser",
      "password": "secret",
      "ssh": {
        "enabled": true,
        "host": "bastion.example.com",
        "port": 22,
        "username": "ops",
        "authMethod": "privateKey",
        "privateKeyPath": "/home/user/.ssh/bastion_ed25519"
      }
    }]
  }
}'
${BT3}

The ${BT}host${BT}/${BT}port${BT} are as seen *from the SSH server*. The server allocates a
local forwarded port automatically unless you set ${BT}ssh.localPort${BT}.

### Terminal (ttyd web shell)

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "Dev Terminal",
  "type": "terminal",
  "style": "desktop",
  "color": "#a855f7",
  "position": {"x": -8, "z": 1.5},
  "cwd": "/home/user/projects/my-project",
  "terminal": { "enabled": true, "shell": "/bin/zsh", "saveSession": true }
}'
${BT3}

Requires ${BT}ttyd${BT} installed; ${BT}saveSession: true${BT} also needs ${BT}tmux${BT}.

### Folder shortcut

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "Projects",
  "type": "folder",
  "style": "filing-cabinet",
  "position": {"x": 8, "z": -2},
  "folderPath": "/home/user/projects"
}'
${BT3}

### Link shortcut

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "Docs",
  "type": "link",
  "style": "tower",
  "position": {"x": 10, "z": 0},
  "urls": [{"label": "Internal Wiki", "url": "https://wiki.example.com"}]
}'
${BT3}

### Monitor

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "Host Metrics",
  "type": "monitor",
  "style": "satellite",
  "position": {"x": 12, "z": 4}
}'
${BT3}

### Boss building

Subordinates must already exist. Get their IDs from a ${BT}GET /api/buildings${BT} list first.

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "Navi",
  "type": "boss",
  "style": "command-center",
  "position": {"x": 11.36, "z": -9.77},
  "subordinateBuildingIds": ["building_..._navi_back", "building_..._navi_front"]
}'
${BT3}

To change the subordinate list later:

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" \\
  http://localhost:5174/api/buildings/<boss-id>/subordinates \\
  -H "Content-Type: application/json" \\
  -d '{"subordinateBuildingIds": ["<id1>", "<id2>"]}'
${BT3}

## Step 4: Control buildings

### Start / stop / restart

${BT3}bash
# Start a single building
curl -s -X POST -H "X-Auth-Token: <TOKEN>" \\
  http://localhost:5174/api/buildings/<id>/command \\
  -H "Content-Type: application/json" -d '{"command":"start"}'

# Stop
curl -s -X POST -H "X-Auth-Token: <TOKEN>" \\
  http://localhost:5174/api/buildings/<id>/command \\
  -H "Content-Type: application/json" -d '{"command":"stop"}'

# Restart
curl -s -X POST -H "X-Auth-Token: <TOKEN>" \\
  http://localhost:5174/api/buildings/<id>/command \\
  -H "Content-Type: application/json" -d '{"command":"restart"}'
${BT3}

Response: ${BT}{"success": true|false, "error?": "..."}${BT}. Status updates broadcast to
the UI separately — the response only confirms the command was dispatched.

### Health check

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" \\
  http://localhost:5174/api/buildings/<id>/command \\
  -H "Content-Type: application/json" -d '{"command":"healthCheck"}'
${BT3}

For PM2 buildings this checks the process is ${BT}online${BT}. For Docker buildings it
checks ${BT}status === 'running'${BT} and health check passing. For custom-command
buildings it runs ${BT}commands.healthCheck${BT}.

### Refresh status without running a command

${BT3}bash
# Pulls the latest PM2/Docker/Terminal status now, updates the building, broadcasts
curl -s -X POST -H "X-Auth-Token: <TOKEN>" \\
  http://localhost:5174/api/buildings/<id>/sync-status
${BT3}

### Boss controls (start_all / stop_all / restart_all)

${BT3}bash
curl -s -X POST -H "X-Auth-Token: <TOKEN>" \\
  http://localhost:5174/api/buildings/boss/<boss-id>/command \\
  -H "Content-Type: application/json" -d '{"command":"start_all"}'
${BT3}

## Step 5: Inspect logs

${BT3}bash
# Snapshot the last 200 lines (default), works for PM2, Docker, and custom-command buildings
curl -s -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings/<id>/logs

# Last N lines (capped at 5000)
curl -s -H "X-Auth-Token: <TOKEN>" "http://localhost:5174/api/buildings/<id>/logs?lines=500"

# Compose-specific service
curl -s -H "X-Auth-Token: <TOKEN>" \\
  "http://localhost:5174/api/buildings/<id>/logs?lines=200&service=web"
${BT3}

Response: ${BT}{"source": "pm2"|"docker"|"custom"|"none", "logs": "...", "lines": N}${BT}.

Live tail-following is **not** exposed over REST — the UI uses WebSocket
streaming for that. Use the snapshot endpoint for debugging.

## Step 6: Update or delete

${BT3}bash
# Partial update — only send the fields that change
curl -s -X PATCH -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings/<id> \\
  -H "Content-Type: application/json" -d '{"position": {"x": 5.0, "z": -2.5}}'

# Change a PM2 env var (the server will restart the process if it was running)
curl -s -X PATCH -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings/<id> \\
  -H "Content-Type: application/json" \\
  -d '{"pm2": {"enabled": true, "script": "bun", "args": "run dev", "env": {"PORT": "6206"}}}'

# Delete (default: tears down PM2 process, Docker container, terminal, DB tunnel)
curl -s -X DELETE -H "X-Auth-Token: <TOKEN>" http://localhost:5174/api/buildings/<id>

# Delete record only, leave runtime artefacts (e.g. when adopting elsewhere)
curl -s -X DELETE -H "X-Auth-Token: <TOKEN>" \\
  "http://localhost:5174/api/buildings/<id>?cleanup=false"
${BT3}

PATCH triggers reconciliation: if you change ${BT}pm2.script${BT}, ${BT}pm2.args${BT},
${BT}pm2.env${BT}, ${BT}cwd${BT}, or anything the PM2 process name derives from, the running
process is removed and restarted (if it was online). Docker container changes
behave the same way. DB tunnel SSH/host/port changes close the tunnel.

## Validation

Validation errors come back as ${BT}400${BT} with a list:

${BT3}json
{
  "error": "Validation failed",
  "errors": [
    "pm2.script is required when pm2.enabled is true",
    "position is required ({x: number, z: number})"
  ]
}
${BT3}

Cross-building checks (e.g. dangling ${BT}subordinateBuildingIds${BT}) also fail at 400.

## Conventions and tips

- **IDs** are server-assigned: ${BT}building_<timestamp>_<name-slug>${BT}. Don't pass them on POST.
- **${BT}status${BT}** is also server-managed — agents don't set it. Use the command
  endpoint to change runtime state.
- **${BT}scale${BT}** is a free number; typical values 0.5 / 0.75 / 1.0 are guidance, not a constraint.
- **Position** should fall inside the building's intended area. Inspect zones
  with ${BT}curl /api/areas | jq '.[] | {id, name, center, width, height, radius}'${BT}.
- **Credentials** (DB passwords, SSH keys) are encrypted at rest. Send plaintext
  in the body; GET responses return ${BT}hasPassword: true${BT} flags instead of the value.
- **${BT}buildings.json${BT}** is server-owned. Reading it directly is fine; writing it
  is not — your edits will be overwritten by the next client sync.
`,
};
