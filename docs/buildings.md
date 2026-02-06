# Buildings

Buildings are 3D objects placed on the battlefield with real functionality attached. They let you manage infrastructure directly from the Tide Commander interface.

## Building Types

### Server

Start, stop, and restart services with real-time log streaming. Two modes are available:

**Custom Commands** - Define shell commands for each action:
- Start: e.g., `npm run dev`
- Stop: e.g., `pkill -f 'npm run dev'`
- Restart, health check, and log commands

**PM2 Mode** - Full process manager integration:
- Auto-restart on crash
- Real-time CPU, memory, and PID tracking
- Port auto-detection via `ss`
- Persistent across Tide Commander restarts
- Configurable script, interpreter, arguments, and environment variables

PM2 examples:
- Node.js: Script `npm`, Args `run dev`
- Symfony: Script `symfony`, Args `serve --no-daemon`, Interpreter `None`
- Java JAR: Script `app.jar`, Interpreter `Java`, Interpreter Args `-jar`
- Python: Script `app.py`, Interpreter `Python 3`

Requires PM2 installed globally (`npm install -g pm2`).

### Database

Connect to databases and run queries from the battlefield.

**Supported engines:**
- MySQL (port 3306)
- PostgreSQL (port 5432)
- Oracle (port 1521)

**Features:**
- Multiple connection profiles per building
- SSL/TLS support
- Interactive SQL query editor
- Query history with favorites
- Schema browser (tables, columns, indexes, foreign keys)
- Paginated result tables

### Docker

Manage Docker containers and compose projects.

**Container Mode** - Create and manage a new container:
- Image, port mappings, volume mounts, environment variables
- Network and restart policy configuration

**Compose Mode** - Manage a docker-compose project:
- Path to `docker-compose.yml`
- Project name override
- Filter to specific services

**Existing Mode** - Adopt a running container:
- Monitor-only (won't delete the container if the building is removed)
- Full start/stop/restart and log streaming

All modes include health check monitoring, CPU/memory stats, and port detection.

### Link

Quick URL shortcuts with labels. Click to open in the browser. Useful for dashboards, admin panels, and documentation.

### Folder

Opens the file explorer at a configured directory path. One-click access to project folders.

### Boss Building

Manages a group of subordinate buildings with unified controls:
- Bulk start/stop/restart all subordinates
- Aggregated log stream with source labels
- Visual connection lines on the battlefield
- Status overview (running count / total)

## Visual Styles

Buildings can use one of 10 3D styles, each with unique animations:

| Style | Description |
|-------|-------------|
| Server Rack | Classic rack with blinking LEDs |
| Control Tower | Tall tower with rotating antenna |
| Data Dome | Futuristic dome with energy ring |
| Power Pyramid | Pyramid with glowing apex |
| Desktop PC | Retro computer with animated screen |
| Filing Cabinet | Office cabinet with sliding drawers |
| Satellite Dish | Communication dish with rotating receiver |
| Data Crystal | Floating crystal with particle effects |
| Mini Factory | Industrial building with smoke particles |
| Command Center | Grand hub for boss buildings |

## Status Colors

| Status | Color |
|--------|-------|
| Running | Green |
| Stopped | Gray |
| Error | Red |
| Starting/Stopping | Blue/Orange |
| Unknown | Orange |

## Creating a Building

1. Right-click on the battlefield or use the Buildings toolbar button
2. Choose a name, type, and visual style
3. Configure type-specific settings (commands, connections, Docker config, etc.)
4. Optionally add URL links (available on any building type)
5. Save - the building appears on the battlefield
