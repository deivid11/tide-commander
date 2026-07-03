import type { BuiltinSkillDefinition } from './types.js';

const BT = '`';
const BT3 = '```';

export const createBuilding: BuiltinSkillDefinition = {
  slug: 'create-building',
  name: 'Create Building',
  description: 'Create, configure, control, and inspect buildings in Tide Commander via the /api/buildings REST API',
  allowedTools: ['Bash(curl:*)', 'Bash(jq:*)'],
  content: `# Create Building Skill

Manage buildings in Tide Commander's battlefield via the REST API. The server validates input, assigns IDs, encrypts credentials, broadcasts updates to clients, and reconciles PM2/Docker/Terminal runtime state. Never write ${BT}buildings.json${BT} directly (reading it is fine) — the server owns it and overwrites manual edits on the next sync.

## Calling convention

Use the standard API scaffolding from your system prompt (auth header, ${BT}Content-Type: application/json${BT}); examples below show only method, URL, and body. Omit the body for GET/DELETE. **No exclamation marks** anywhere in the command — bash history expansion corrupts it.

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

The server assigns ${BT}id${BT} (${BT}building_<timestamp>_<name-slug>${BT}), ${BT}createdAt${BT}, ${BT}lastActivity${BT}, and ${BT}status${BT} — never send or set them; change runtime state via the command endpoint. POST returns the full building (201), PATCH the merged building, DELETE ${BT}{"deleted":true}${BT}. Validation failures (including cross-building checks like dangling ${BT}subordinateBuildingIds${BT}) return ${BT}400${BT} with ${BT}{"error":"Validation failed","errors":[...]}${BT}.

## Inspect

${BT3}bash
curl -s http://localhost:5174/api/buildings | jq '.buildings | map({id, name, type, status, cwd})'
curl -s http://localhost:5174/api/buildings/<id>          # one building, full config
curl -s http://localhost:5174/api/buildings/docker/containers \\
  | jq '.containers | map({id: .id[0:12], name, image, status})'   # adoptable (mode "existing")
${BT3}

## Schema — POST /api/buildings

${BT}name${BT}, ${BT}type${BT}, and ${BT}position${BT} are always required. Style defaults per type if omitted.

${BT3}typescript
{
  name: string,                                       // Display name
  type: 'server'|'link'|'database'|'docker'|'monitor'|'folder'|'boss'|'terminal'|'tests',
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
  folderPath?: string,                                // Folder + tests types — required
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

## Create recipes

All recipes are ${BT}POST /api/buildings${BT} bodies. Full example — Bun/Node service with PM2:

${BT3}bash
curl -s -X POST http://localhost:5174/api/buildings \\
  -H "Content-Type: application/json" -d '{
  "name": "Wind Front",
  "type": "server",
  "style": "desktop",
  "color": "#4a3a2a",
  "position": {"x": -3.5, "z": -8.0},
  "cwd": "/home/user/projects/wind/front",
  "pm2": {"enabled": true, "script": "/home/user/.bun/bin/bun", "args": "run dev", "interpreter": "none", "env": {"PORT": "6205"}},
  "scale": 0.75
}'
${BT3}

### PM2 variants (swap the ${BT}pm2${BT} object)

- Port in args, no env var: ${BT}{"enabled":true,"script":"bun","args":"dev --port 6200","interpreter":"none"}${BT}
- Symfony: ${BT}{"enabled":true,"script":"symfony","args":"server:start --allow-http --port=7200","interpreter":"none"}${BT}. Never ${BT}--daemon${BT} — Symfony forks and exits, PM2 marks it errored. If errored with "already running", run ${BT}symfony server:stop${BT} from the project directory, then ${BT}POST .../command {"command":"start"}${BT}.
- PHP built-in server: ${BT}{"enabled":true,"script":"php","args":"-S 0.0.0.0:7205 -t public","interpreter":"none"}${BT}
- Maven / Spring Boot: ${BT}{"enabled":true,"script":"mvn","args":"spring-boot:run -Dspring-boot.run.fork=false -Dspring-boot.run.profiles=dev","interpreter":"none"}${BT}
- Shell-script server (e.g. ActiveMQ): ${BT}{"enabled":true,"script":"./bin/activemq","args":"console","interpreter":"bash"}${BT}
- Vite frontends: the project's ${BT}vite.config.*${BT} must honour ${BT}process.env.PORT${BT} (otherwise PM2 sets the var but Vite ignores it); or pass the port in ${BT}args${BT}.

### Custom-command server (no PM2)

When PM2 doesn't fit, define ${BT}commands${BT} instead. Each command runs in ${BT}cwd${BT}; status transitions happen on command completion.

${BT3}json
{"name":"Legacy Service","type":"server","position":{"x":5,"z":5},"cwd":"/srv/legacy",
 "commands":{"start":"./bin/start.sh","stop":"./bin/stop.sh","restart":"./bin/restart.sh",
   "healthCheck":"curl -fs http://localhost:9000/health","logs":"tail -n 200 /srv/legacy/log/app.log"}}
${BT3}

### Docker (type ${BT}"docker"${BT}; include name/position/cwd as usual)

- New container: ${BT}"docker":{"enabled":true,"mode":"container","image":"redis:7-alpine","ports":["6379:6379"],"restart":"unless-stopped"}${BT}
- Compose project: ${BT}"docker":{"enabled":true,"mode":"compose","composePath":"docker-compose.yml","services":["web","worker"]}${BT}
- Adopt existing: discover ${BT}containerName${BT} via ${BT}GET /api/buildings/docker/containers${BT}, then ${BT}"docker":{"enabled":true,"mode":"existing","containerName":"postgres18"}${BT}. Mode ${BT}existing${BT} is monitor-only: deleting the building never removes the container.

### Database

${BT3}json
{"name":"MySQL","type":"database","style":"dome","position":{"x":-9.78,"z":-0.34},
 "database":{"connections":[{"id":"conn_mysql_prod","name":"Primary","engine":"mysql",
   "host":"localhost","port":3306,"username":"root","password":"root"}],
  "activeConnectionId":"conn_mysql_prod"}}
${BT3}

- ${BT}postgresql${BT} / ${BT}oracle${BT} / ${BT}mssql${BT}: same shape with ${BT}engine${BT}, ${BT}port${BT}, and ${BT}database${BT} adjusted (${BT}database${BT} = DB name; for Oracle the service/PDB name, e.g. ${BT}ORCLPDB1${BT}).
- ${BT}sqlite${BT}: no host/port/credentials — connection ${BT}{"id":"conn_sqlite","name":"cache.db","engine":"sqlite","filepath":"/home/user/projects/app/cache.db"}${BT}.
- SSH tunnel: add to a connection ${BT}"ssh":{"enabled":true,"host":"bastion.example.com","port":22,"username":"ops","authMethod":"privateKey","privateKeyPath":"/home/user/.ssh/bastion_ed25519"}${BT}. The connection's ${BT}host${BT}/${BT}port${BT} are as seen *from the SSH server*; a local forwarded port is allocated automatically unless you set ${BT}ssh.localPort${BT}.

### Terminal (ttyd web shell)

${BT}{"name":"Dev Terminal","type":"terminal","style":"desktop","color":"#a855f7","position":{"x":-8,"z":1.5},"cwd":"/home/user/projects/my-project","terminal":{"enabled":true,"shell":"/bin/zsh","saveSession":true}}${BT}

Requires ${BT}ttyd${BT} installed; ${BT}saveSession: true${BT} also needs ${BT}tmux${BT}.

### Folder / Link / Monitor

- ${BT}{"name":"Projects","type":"folder","style":"filing-cabinet","position":{"x":8,"z":-2},"folderPath":"/home/user/projects"}${BT}
- ${BT}{"name":"Docs","type":"link","style":"tower","position":{"x":10,"z":0},"urls":[{"label":"Internal Wiki","url":"https://wiki.example.com"}]}${BT}
- ${BT}{"name":"Host Metrics","type":"monitor","style":"satellite","position":{"x":12,"z":4}}${BT}

### Boss

Subordinates must already exist — get their IDs from ${BT}GET /api/buildings${BT} first.

${BT}{"name":"Navi","type":"boss","style":"command-center","position":{"x":11.36,"z":-9.77},"subordinateBuildingIds":["<id1>","<id2>"]}${BT}

Change the list later: ${BT}POST /api/buildings/<boss-id>/subordinates${BT} with ${BT}{"subordinateBuildingIds":["<id1>","<id2>"]}${BT}.

## Control

${BT3}bash
curl -s -X POST http://localhost:5174/api/buildings/<id>/command \\
  -H "Content-Type: application/json" -d '{"command":"start"}'   # or stop|restart|healthCheck|logs|delete
${BT3}

Response ${BT}{"success": true|false, "error?": "..."}${BT} only confirms dispatch — status updates broadcast to the UI separately. ${BT}healthCheck${BT} semantics: PM2 → process is ${BT}online${BT}; Docker → ${BT}status === 'running'${BT} and health check passing; custom-command → runs ${BT}commands.healthCheck${BT}.

- Refresh status without running a command: ${BT}POST /api/buildings/<id>/sync-status${BT} — pulls the latest PM2/Docker/Terminal status now, updates the building, broadcasts.
- Boss bulk control: ${BT}POST /api/buildings/boss/<boss-id>/command${BT} with ${BT}{"command":"start_all"}${BT} (or ${BT}stop_all${BT} / ${BT}restart_all${BT}).

## Logs

${BT}GET /api/buildings/<id>/logs?lines=500&service=web${BT} — snapshot for PM2, Docker, and custom-command buildings. ${BT}lines${BT} defaults to 200, capped at 5000; ${BT}service${BT} targets one compose service. Response: ${BT}{"source": "pm2"|"docker"|"custom"|"none", "logs": "...", "lines": N}${BT}. Live tail-following is **not** exposed over REST (the UI uses WebSocket streaming) — use snapshots for debugging.

## Update / delete

${BT3}bash
# Partial update — send only the fields that change
curl -s -X PATCH http://localhost:5174/api/buildings/<id> \\
  -H "Content-Type: application/json" -d '{"position": {"x": 5.0, "z": -2.5}}'

# Delete (default: tears down PM2 process, Docker container, terminal, DB tunnel)
curl -s -X DELETE http://localhost:5174/api/buildings/<id>

# Delete record only, leave runtime artefacts (e.g. when adopting elsewhere)
curl -s -X DELETE "http://localhost:5174/api/buildings/<id>?cleanup=false"
${BT3}

PATCH triggers reconciliation: changing ${BT}pm2.script${BT}, ${BT}pm2.args${BT}, ${BT}pm2.env${BT}, ${BT}cwd${BT}, or anything the PM2 process name derives from removes and restarts the process if it was online (e.g. PATCH ${BT}{"pm2":{"enabled":true,"script":"bun","args":"run dev","env":{"PORT":"6206"}}}${BT} restarts on the new port). Docker container changes behave the same. DB tunnel SSH/host/port changes close the tunnel.

## Tips

- ${BT}scale${BT} is a free number; typical values 0.5 / 0.75 / 1.0 are guidance, not a constraint.
- Position should fall inside the building's intended area — inspect zones with ${BT}curl /api/areas | jq '.[] | {id, name, center, width, height, radius}'${BT}.
- Credentials (DB passwords, SSH keys) are encrypted at rest: send plaintext in the body; GET responses return ${BT}hasPassword: true${BT} flags instead of the value.
`,
};
