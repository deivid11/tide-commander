import type { BuiltinSkillDefinition } from './types.js';

const BT = '`';
const BT3 = '```';

export const createBuilding: BuiltinSkillDefinition = {
  slug: 'create-building',
  name: 'Create Building',
  description: 'Create and manage buildings in Tide Commander with full control over configuration and placement',
  allowedTools: ['Bash(jq:*)', 'Bash(curl:*)', 'Bash(cat:*)'],
  content: `# Create Building Skill

This skill enables you to create, configure, and manage buildings in Tide Commander's battlefield.

## IMPORTANT: Use PM2 Mode for All Server Buildings

**Always use PM2 mode when possible** - it provides:
- Auto-restart on crash
- CPU/memory/PID tracking
- Port auto-detection
- Process persistence across restarts
- Unified log streaming
- Status monitoring

Only use custom commands if PM2 cannot handle your use case.

## Step 1: Explore Existing Buildings First

Before creating a new building, ALWAYS examine existing ones for patterns and positioning:

${BT3}bash
# List all buildings with their main properties
jq '.buildings | map({name, type, cwd, "pm2_script": .pm2.script, status})' ~/.local/share/tide-commander/buildings.json

# View a specific building's full config (use as template)
jq '.buildings[] | select(.name == "Navi Back")' ~/.local/share/tide-commander/buildings.json

# See all PM2 configurations
jq '.buildings[] | select(.pm2.enabled == true) | {name, cwd, pm2}' ~/.local/share/tide-commander/buildings.json

# See all boss buildings and their subordinates
jq '.buildings[] | select(.type == "boss") | {name, subordinateBuildingIds}' ~/.local/share/tide-commander/buildings.json

# Find buildings listening on specific ports
jq '.buildings[] | select(.pm2.env.PORT != null) | {name, port: .pm2.env.PORT}' ~/.local/share/tide-commander/buildings.json

# Count buildings by type
jq '[.buildings[].type] | group_by(.) | map({type: .[0], count: length})' ~/.local/share/tide-commander/buildings.json

# List all areas with positions (to know where to place buildings)
jq '.areas | map({name, center, width, height})' ~/.local/share/tide-commander/areas.json
${BT3}

## Step 2: Create the Building

### Building Types

- **server**: PM2-managed service with start/stop/restart and log streaming
- **database**: Database connection (MySQL 3306, PostgreSQL 5432, Oracle 1521)
- **docker**: Docker container/compose management (container, compose, or existing mode)
- **link**: Quick URL shortcuts
- **folder**: Opens file explorer at configured path
- **boss**: Manages group of subordinate buildings with unified controls
- **monitor**: System metrics display

### Building Styles

server-rack, tower, dome, pyramid, desktop, filing-cabinet, satellite, crystal, factory, command-center

## Real Examples from Existing Buildings

### Bun/Node.js Service (Navi Back - Port 8008)

${BT3}bash
jq '.buildings += [{
  "name": "Navi Back",
  "type": "server",
  "style": "server-rack",
  "color": "#2a4a3a",
  "position": {"x": 9.66, "z": -7.87},
  "cwd": "/home/riven/d/navi/back",
  "pm2": {
    "enabled": true,
    "script": "/home/riven/.bun/bin/bun",
    "args": "run dev",
    "interpreter": "none",
    "env": {"PORT": "8008"}
  },
  "scale": 0.75,
  "id": "building_1707471234567_navi_back",
  "status": "stopped",
  "createdAt": 1707471234567,
  "lastActivity": 1707471234567
}]' ~/.local/share/tide-commander/buildings.json > /tmp/b.json && mv /tmp/b.json ~/.local/share/tide-commander/buildings.json
${BT3}

Key: Full path to Bun binary, interpreter "none", PORT via env var.

### Symfony Service (MDO Back - Port 7200)

${BT3}bash
jq '.buildings += [{
  "name": "MDO back",
  "type": "server",
  "style": "server-rack",
  "color": "#2a3a3a",
  "position": {"x": -11.67, "z": 2.55},
  "cwd": "/home/riven/d/mdo/back",
  "pm2": {
    "enabled": true,
    "script": "symfony",
    "args": "server:start --allow-http --port=7200",
    "interpreter": "none"
  },
  "scale": 0.75,
  "id": "building_1769553740335_mdo_back",
  "status": "stopped",
  "createdAt": 1769553740335
}]' ~/.local/share/tide-commander/buildings.json > /tmp/b.json && mv /tmp/b.json ~/.local/share/tide-commander/buildings.json
${BT3}

**Symfony-Specific Instructions:**
- Script: "symfony" (requires Symfony CLI installed and in PATH)
- Args: "server:start --allow-http --port=XXXX --daemon"
- --allow-http: Allows HTTP (use for dev). Remove for HTTPS
- **IMPORTANT: Add --daemon flag** - Symfony runs as daemon by default, required for PM2 tracking
- Port goes in args, not env vars
- PM2 auto-detects port from startup output
- Note: Symfony server opens an extra port (42421 in example) for the server monitor
- Tip: Check status with: symfony server:status

### PHP Built-in Server (Wind Back - Port 7205)

${BT3}bash
jq '.buildings += [{
  "name": "Wind Back",
  "type": "server",
  "style": "server-rack",
  "color": "#2a3a4a",
  "position": {"x": 0.77, "z": 3.96},
  "cwd": "/home/riven/d/wind/back",
  "pm2": {
    "enabled": true,
    "script": "php",
    "args": "-S 0.0.0.0:7205 -t public",
    "interpreter": "none"
  },
  "scale": 0.75,
  "id": "building_1770769766821_wind_back",
  "status": "stopped",
  "createdAt": 1770769766821
}]' ~/.local/share/tide-commander/buildings.json > /tmp/b.json && mv /tmp/b.json ~/.local/share/tide-commander/buildings.json
${BT3}

**PHP Server-Specific Instructions:**
- Script: "php" (built-in web server, no extra tools needed)
- Args: "-S 0.0.0.0:PORT -t DOCROOT"
- -S: Start server on address:port
- -t: Document root directory
- Use 0.0.0.0 to listen on all interfaces (accessible from network)
- Port goes in args after -S flag

### Maven Java Project (Pagamento)

${BT3}bash
jq '.buildings += [{
  "name": "Pagamento",
  "type": "server",
  "style": "server-rack",
  "color": "#3a2a3a",
  "position": {"x": -11.85, "z": 9.59},
  "cwd": "/home/riven/d/pagamento",
  "pm2": {
    "enabled": true,
    "script": "mvn",
    "args": "spring-boot:run -Dspring-boot.run.fork=false -Dspring-boot.run.profiles=dev",
    "interpreter": "none"
  },
  "scale": 0.75,
  "id": "building_1769555952700_pagamento",
  "status": "stopped",
  "createdAt": 1769555952700
}]' ~/.local/share/tide-commander/buildings.json > /tmp/b.json && mv /tmp/b.json ~/.local/share/tide-commander/buildings.json
${BT3}

Key: Script "mvn" (Maven), PM2 auto-detects port from Spring Boot logs.

### Shell Script Binary (ActiveMQ)

${BT3}bash
jq '.buildings += [{
  "name": "ActiveMQ",
  "type": "server",
  "style": "filing-cabinet",
  "color": "#2a2a4a",
  "position": {"x": -7.30, "z": -0.15},
  "cwd": "/opt/apache-activemq-6.2.0",
  "pm2": {
    "enabled": true,
    "script": "./bin/activemq",
    "args": "console",
    "interpreter": "bash"
  },
  "scale": 0.5,
  "id": "building_1769556341280_activemq",
  "status": "stopped",
  "createdAt": 1769556341280
}]' ~/.local/share/tide-commander/buildings.json > /tmp/b.json && mv /tmp/b.json ~/.local/share/tide-commander/buildings.json
${BT3}

Key: Relative path script, interpreter "bash" for shell scripts.

### Concurrently (Tide Commander itself - Client + Server)

${BT3}bash
jq '.buildings += [{
  "name": "Tide Commander",
  "type": "server",
  "style": "command-center",
  "color": "#6a4a9a",
  "position": {"x": 6.57, "z": 10.80},
  "cwd": "/home/riven/d/tide-commander",
  "pm2": {
    "enabled": true,
    "script": "/home/riven/.bun/bin/bun",
    "args": "run dev",
    "interpreter": "none",
    "env": {"PORT": "5174", "LISTEN_ALL_INTERFACES": "1"}
  },
  "scale": 1.0,
  "id": "building_1707471234571_tide_commander",
  "status": "stopped",
  "createdAt": 1707471234571
}]' ~/.local/share/tide-commander/buildings.json > /tmp/b.json && mv /tmp/b.json ~/.local/share/tide-commander/buildings.json
${BT3}

Key: Full bun path, multiple env vars, uses concurrently internally.

### Vite + Bun Frontend (Wind Front - Port 6205)

${BT3}bash
jq '.buildings += [{
  "name": "Wind Front",
  "type": "server",
  "style": "desktop",
  "color": "#4a3a2a",
  "position": {"x": -3.5, "z": -8.0},
  "cwd": "/home/riven/d/wind/front",
  "pm2": {
    "enabled": true,
    "script": "/home/riven/.bun/bin/bun",
    "args": "run dev",
    "interpreter": "none",
    "env": {"PORT": "6205"}
  },
  "scale": 0.75,
  "id": "building_1707471234572_wind_front",
  "status": "stopped",
  "createdAt": 1707471234572
}]' ~/.local/share/tide-commander/buildings.json > /tmp/b.json && mv /tmp/b.json ~/.local/share/tide-commander/buildings.json
${BT3}

**Vite Frontend Configuration:**
- Script: Full path to bun binary (or "npm" if using npm)
- Args: "run dev" (Vite dev server command)
- **IMPORTANT: Update vite.config.mjs to read PORT env var:**
  - Add to server config: ${BT}port: parseInt(process.env.PORT || "6205", 10)${BT}
  - Add: ${BT}host: true${BT} to allow network access
  - Set ${BT}open: false${BT} to prevent auto-opening browser
- Port passed via env var, not args
- Tip: Check config with: cat vite.config.mjs | grep -A 5 "server:"

### Boss Building (Navi - Manages Back & Front)

${BT3}bash
jq '.buildings += [{
  "name": "Navi",
  "type": "boss",
  "style": "command-center",
  "color": "#4a4a6a",
  "position": {"x": 11.36, "z": -9.77},
  "cwd": "/home/riven/d/navi",
  "commands": {},
  "subordinateBuildingIds": [
    "building_1707471234567_navi_back",
    "building_1707471234568_navi_front"
  ],
  "scale": 0.6,
  "id": "building_1707471234570_navi_boss",
  "status": "running",
  "createdAt": 1707471234570
}]' ~/.local/share/tide-commander/buildings.json > /tmp/b.json && mv /tmp/b.json ~/.local/share/tide-commander/buildings.json
${BT3}

Key: subordinateBuildingIds must contain exact IDs of existing buildings.

### Docker Existing Container (Postgres 18)

${BT3}bash
jq '.buildings += [{
  "name": "Postgres 18",
  "type": "docker",
  "style": "dome",
  "color": "#336699",
  "position": {"x": -11.49, "z": -2.31},
  "cwd": "/home/riven/d/tide-commander",
  "docker": {
    "enabled": true,
    "mode": "existing",
    "containerId": "fc1e2a1e0481",
    "containerName": "postgres18"
  },
  "scale": 0.6,
  "id": "building_1707471234569_postgres",
  "status": "stopped",
  "createdAt": 1707471234569
}]' ~/.local/share/tide-commander/buildings.json > /tmp/b.json && mv /tmp/b.json ~/.local/share/tide-commander/buildings.json
${BT3}

Key: mode "existing" = monitor-only (won't delete container if building removed). Get containerId from "docker ps -a".

### Database Building (MySQL)

${BT3}bash
jq '.buildings += [{
  "name": "MySql",
  "type": "database",
  "style": "dome",
  "position": {"x": -9.78, "z": -0.34},
  "cwd": "/home/riven/d/tide-commander",
  "commands": {},
  "database": {
    "connections": [{
      "id": "conn_1769620529754_db",
      "name": "Connection 1",
      "engine": "mysql",
      "host": "localhost",
      "port": 3306,
      "username": "root",
      "password": "root"
    }],
    "activeConnectionId": "conn_1769620529754_db"
  },
  "id": "building_1769620533827_mysql",
  "status": "stopped",
  "createdAt": 1769620533827
}]' ~/.local/share/tide-commander/buildings.json > /tmp/b.json && mv /tmp/b.json ~/.local/share/tide-commander/buildings.json
${BT3}

Key: Engines: mysql, postgresql, oracle. Each with host/port/username/password.

## Step 3: Verify

${BT3}bash
# Validate JSON
jq empty ~/.local/share/tide-commander/buildings.json && echo "Valid JSON"

# Count buildings
jq '.buildings | length' ~/.local/share/tide-commander/buildings.json

# Check the new building
jq '.buildings[-1] | {name, type, status}' ~/.local/share/tide-commander/buildings.json
${BT3}

## Framework-Specific Configuration

### Symfony (PHP Framework)

**Requirements:**
- Symfony CLI must be installed and in PATH
- Use "server:start" command (Symfony local web server)

**Configuration:**
${BT3}bash
"pm2": {
  "enabled": true,
  "script": "symfony",
  "args": "server:start --allow-http --port=7200",
  "interpreter": "none"
}
${BT3}

**Key Options:**
- server:start: Start the Symfony local web server
- --allow-http: Allow HTTP (remove for production/HTTPS)
- --port=XXXX: Listening port
- Extra ports: Symfony opens additional monitoring ports (e.g., 42421)
- Auto-detects port from startup logs

**Debugging Symfony:**
${BT3}bash
# Check if symfony CLI is installed
symfony --version

# Run manually to debug issues
cd /path/to/symfony/project && symfony server:start --allow-http --port=7200

# View logs
pm2 logs [building_name_from_pm2_list]
${BT3}

### PHP Built-in Server

**Requirements:**
- PHP installed and in PATH
- No extra tools needed

**Configuration:**
${BT3}bash
"pm2": {
  "enabled": true,
  "script": "php",
  "args": "-S 0.0.0.0:7205 -t public",
  "interpreter": "none"
}
${BT3}

**Key Options:**
- -S address:port: Bind server to address and port
- 0.0.0.0: Listen on all interfaces (accessible from network)
- localhost: Only accessible locally
- -t docroot: Document root (where index.php is)

**Ideal for:**
- Laravel projects (document root: "public")
- Custom PHP apps
- Quick prototypes
- Development only (not production-grade)

## Lessons Learned from Real Deployments

### Symfony Server with PM2
- **Problem**: Symfony server runs as daemon and PM2 loses track (shows as "errored")
- **Solution**: Add ${BT}--daemon${BT} flag explicitly to args
- **Verification**: ${BT}symfony server:status${BT} shows running instance
- **Port Monitoring**: Opens main port + monitor port (e.g., 7205 + 42421)

### Vite Configuration for Environment Variables
- **Problem**: PORT env var set in PM2 but Vite ignores it (uses hardcoded port)
- **Solution**: Update vite.config.mjs to read PORT from process.env:
  - ${BT3}javascript
  - server: {
  -   port: parseInt(process.env.PORT || "6205", 10),
  -   open: false,
  -   host: true,
  - }
  - ${BT3}
- **Verification**: ${BT}ss -tlnp | grep PORT_NUMBER${BT} shows process listening
- **Tip**: Set ${BT}open: false${BT} to prevent browser pop-ups in headless environments

### Binary Corruption Issues
- **Problem**: Bun binary shows "cannot execute binary file" errors
- **Solution**: Reinstall with ${BT}curl -fsSL https://bun.sh/install | bash${BT}
- **Verification**: ${BT}bun --version${BT} returns version number

## PM2 Configuration Rules

1. **Always use PM2 mode** for server buildings (pm2.enabled: true)
2. **Script paths**:
   - Full path for binaries not in PATH: /home/riven/.bun/bin/bun
   - Short name for PATH tools: symfony, php, mvn, node, bun
   - Relative path for project scripts: ./bin/activemq
3. **Interpreter values**:
   - "none": Direct binary execution (most common - php, mvn, symfony, bun)
   - "bash": Shell scripts needing interpretation
   - "node": Explicitly running a .js file
4. **Port strategy**:
   - Vite/Node apps: set via env var (PORT)
   - PHP/Symfony/Java: set via args (--port=XXXX or -S ADDR:PORT)
   - PM2 auto-detects ports from console output
5. **Special cases**:
   - Symfony: Add --daemon flag for PM2 tracking
   - Vite: Update vite.config.mjs to read PORT env var
   - Full bun path: Use /home/riven/.bun/bin/bun (not just "bun")

## Important Notes

- File: ~/.local/share/tide-commander/buildings.json
- IDs must be unique: building_<timestamp>_<name>
- Scale: 0.5 (small), 0.75 (normal), 1.0 (large)
- Always validate JSON after modifications
- Refresh Tide Commander UI to see new buildings
- Check "pm2 list" to verify building started correctly
- Position buildings inside their designated area (check areas.json for coordinates)
`,
};
