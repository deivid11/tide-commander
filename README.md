<p align="center">
  <img src="https://raw.githubusercontent.com/deivid11/tide-commander/master/docs/tide-commander-logo.png" alt="Tide Commander" width="360" />
</p>

<h1 align="center">Tide Commander</h1>

<p align="center">
  <strong>The visual AI build suite for a new generation of creators.</strong>
</p>

<p align="center">
  Turn ideas into software, automations, workflows, documents, data tools, and 3D projects—without living inside an IDE.
</p>

<p align="center">
  Claude Code &nbsp;·&nbsp; Codex &nbsp;·&nbsp; OpenCode &nbsp;·&nbsp; Grok &nbsp;·&nbsp; Pi
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/tide-commander"><img src="https://img.shields.io/npm/v/tide-commander?style=flat-square&logo=npm" alt="npm version" /></a>
  <a href="https://github.com/deivid11/tide-commander/stargazers"><img src="https://img.shields.io/github/stars/deivid11/tide-commander?style=flat-square&logo=github" alt="GitHub stars" /></a>
  <a href="https://github.com/deivid11/tide-commander/blob/master/LICENSE"><img src="https://img.shields.io/github/license/deivid11/tide-commander?style=flat-square" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 18+" />
</p>

<p align="center">
  <a href="https://tidecommander.com/app"><img src="https://img.shields.io/badge/TRY_LIVE_DEMO-OPEN-2563EB?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Try the live demo" /></a>
  <a href="https://www.youtube.com/watch?v=r1Op_xfhqOM"><img src="https://img.shields.io/badge/WATCH_DEMO-YOUTUBE-DC2626?style=for-the-badge&logo=youtube&logoColor=white" alt="Watch the demo" /></a>
</p>

![Tide Commander visual multi-agent command center](https://raw.githubusercontent.com/deivid11/tide-commander/master/docs/preview-3d.png)

> **More than an agent manager. More than an IDE.** Tide Commander is a complete build environment designed around teams of AI agents. Every character is a real process working on real project files with native tools, credentials, context, and session history.

Traditional creation tools split the work across an IDE, terminal multiplexer, Git client, file browser, automation canvas, infrastructure dashboard, and a growing pile of AI chats. Tide Commander brings those surfaces together so you can move from intent to finished output in one place.

You do not have to live in code to use it. Start with natural language and visual controls; open the exact files, commands, diffs, data, or infrastructure only when you want deeper control.

## ⚡ Run it in 30 seconds

```bash
npx tide-commander@latest
```

Open **[http://localhost:6200](http://localhost:6200)**. If Claude Code, Codex, OpenCode, Grok, or Pi is already installed and authenticated, you are ready to spawn your first agent.

Prefer Bun? Use `bunx tide-commander@latest`.

## Why creators use Tide Commander

Traditional IDEs were designed for one person editing one file at a time. AI-native creation is different: multiple agents can research, plan, build, test, document, automate, and operate in parallel. Tide Commander is a workspace for that shift—a visual build suite where you direct the outcome while the team handles the execution.

<p align="center"><strong>For solo creators, founders, researchers, operators, engineers, product teams, and anyone who builds with AI.</strong></p>

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>✨ Create from intent</h3>
      Start with the outcome you want. Spawn specialists, give them context, and let boss agents coordinate the work.
    </td>
    <td width="33%" valign="top">
      <h3>👀 See the work happen</h3>
      Follow tool calls, PTY output, background jobs, queues, context usage, and blockers live instead of watching silent spinners.
    </td>
    <td width="33%" valign="top">
      <h3>🛠️ Replace tool switching</h3>
      Work with files, source, Git, tests, documents, data, terminals, services, and rich previews in the same build suite.
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <h3>🔀 Use the right harness</h3>
      Mix Claude, Codex, OpenCode, Grok, and Pi in one team—and migrate a conversation when another runtime fits better.
    </td>
    <td width="33%" valign="top">
      <h3>⚙️ Automate the repeatable</h3>
      Build workflows and triggers, connect your services, or add local plugins and slash commands that bypass the LLM.
    </td>
    <td width="33%" valign="top">
      <h3>📱 Pick up anywhere</h3>
      Reconnect to the same server-side sessions from desktop, mobile, Android, or the browser extension.
    </td>
  </tr>
</table>

## Everything you need to create

| | |
|---|---|
| **🎯 Orchestration**<br>Boss/subordinate teams, delegation reports, project areas, task labels, tracking boards, agent memory, prompt stacking, skills, and runtime migration. | **📡 Observability**<br>Structured tool cards, streamed PTY commands, a live background-task rail, server-side message queues, interrupts, context gauges, account limits, and reconnect recovery. |
| **📁 Unified build workspace**<br>Multi-root file explorer, source editing, Git status/diffs/history, branch comparison, project-wide filename/content search, tests, and `@file` / `@folder` / `@agent` context. | **🧩 Extensibility**<br>Trusted plugins, slash commands, shell scripts, workflows, webhooks, integrations, custom skills/classes/models, REST API, WebSocket API, and browser automation. |
| **🖼️ Rich previews**<br>Markdown, Mermaid, PlantUML, Office documents, spreadsheets, archives, images, PDF, audio/video, STL, GLB, FreeCAD, and G-code. | **🌐 Flexible UI**<br>3D, 2D, Flat, Dashboard, Commander, and Guake views; Android support; custom themes, shortcuts, sounds, haptics, and 10 UI languages. |

## 🤖 Bring your favorite AI harness

Use different harnesses side by side—even inside the same project. Tide Commander normalizes their event streams into one conversation, tool, status, context, and file-diff experience without hiding each provider's native sessions or strengths.

| Harness | Required command | Default runtime | Optional persistent/streaming mode |
|---|---|---|---|
| **Claude Code** | `claude` | Headless `stream-json` process with stdin follow-ups | Interactive Claude TUI in tmux; general tmux mode can preserve processes across Commander restarts |
| **Codex** | `codex` | `codex exec --experimental-json` with native session resume | Persistent `codex app-server` for token streaming, detached turns, reconnect, and native thread forking |
| **OpenCode** | `opencode` | `opencode run --format json` with session resume | Persistent `opencode serve` daemon with streaming and restart recovery |
| **Grok** | `grok` | Headless `streaming-json` with native resume | Model/effort selection, account profiles, context tracking, and usage gauges |
| **Pi** | `pi` | `pi --mode json` NDJSON sessions | Persistent `pi --mode rpc` with mid-turn steering, native `/compact`, live model/provider switching, and tmux reconnect |

Persistent modes are opt-in under **Settings → General**. Pi can use any model provider loaded by Pi—for example Anthropic, OpenAI Codex, xAI, Gemini, Copilot, OpenCode Go, or a local provider—and Tide displays the active model provider separately from the Pi harness.

### Switch harness without throwing the conversation away

The agent editor can change any agent to any supported harness:

- **Smart Context** — a compact hand-off fitted to the target context window
- **Visible Transcript** — a budgeted readable copy of the conversation
- **Fresh Start** — change the runtime without importing conversation content

Claude, Codex, Grok, and Pi have writable native session stores and support imported context. OpenCode can be selected with Fresh Start. Every provider can be the source of a migration. Tide validates the new session, reports imported/dropped content, archives the original, and provides rollback through session history.

## 📦 Installation and CLI

### Requirements

- **Node.js 18+** (Node.js 22 is used in CI), or Bun for `bunx`
- At least one supported AI agent CLI installed and authenticated: `claude`, `codex`, `opencode`, `grok`, or `pi`
- Optional: `tmux` for process persistence, Pi RPC restart recovery, and Claude interactive TUI mode

### Run without installing

```bash
# Bun
bunx tide-commander@latest

# Or npm
npx tide-commander@latest
```

Open `http://localhost:6200`.

### Install globally

```bash
npm install -g tide-commander@latest
tide-commander start
```

The server starts in the background by default:

```bash
tide-commander start                 # Start in background
tide-commander start --foreground    # Keep attached to this terminal
tide-commander stop
tide-commander status
tide-commander logs
tide-commander logs --follow
tide-commander version
```

Common server options:

```bash
tide-commander start --port 8080 --host 127.0.0.1
tide-commander start --listen-all --port 8080
tide-commander start --restart
tide-commander start --https --tls-key ./certs/key.pem --tls-cert ./certs/cert.pem
tide-commander start --install-local-cert --https
tide-commander start --https --generate-auth-token
```

Run `tide-commander --help` for the complete CLI reference.

## 🔒 Remote Access and HTTPS

Tide Commander executes local tools and exposes project files, so use HTTPS/WSS and an auth token whenever it is reachable beyond localhost.

```bash
tide-commander start \
  --listen-all \
  --https \
  --install-local-cert \
  --generate-auth-token
```

You can also serve HTTP and HTTPS from the same process. `PORT` keeps the plain listener and `HTTPS_PORT` adds TLS; both listeners share the same agents and WebSocket clients.

```bash
PORT=6200 \
HTTPS_PORT=6201 \
TLS_KEY_PATH=~/.tide-commander/certs/localhost-key.pem \
TLS_CERT_PATH=~/.tide-commander/certs/localhost.pem \
tide-commander start
```

This is useful when localhost can stay on HTTP while a phone or another computer needs a secure context. If `HTTPS=1` is used without `HTTPS_PORT`, HTTPS replaces the plain listener.

Notes:

- `--install-local-cert` uses `mkcert` and stores certificates in `~/.tide-commander/certs/`.
- Add LAN or VPN addresses to the certificate SAN list when remote clients use those addresses.
- Keep generated auth tokens in a password manager.
- HTTPS protects transport; `AUTH_TOKEN` controls access. Use both remotely.

## 🎖️ Core Concepts

### Agents, bosses, and delegation

Every character is a real AI harness process with its own working directory, provider, model, session, prompt stack, memory, permissions, skills, context usage, and task state. A **boss** can own subordinate agents, choose specialists, send tasks through the Tide Commander API, wait for reports, and summarize the team's progress.

Task labels and tracking states make the work visible outside the chat. Agents can report that they are thinking, working, blocked, waiting for subordinates, ready for review, or safe to clear from context.

### Areas

Rectangle or circular areas organize agents by project or responsibility. Areas can own multiple project folders, add area-specific instructions to agents inside them, expose an instant tmux terminal rooted in the project, and group agents in Commander and Flat views. Finished areas can be archived and restored without deleting their agents.

### Agent classes and custom models

Classes bundle a role, model, instructions, and default skills. Tide includes Scout, Builder, Debugger, Architect, Warrior, Support, and Boss classes. Custom classes can use uploaded GLB character models with scale, offsets, and idle/walk/working animation mappings.

![Create Agent Class](https://raw.githubusercontent.com/deivid11/tide-commander/master/docs/img/create_agent_class.png)

### Prompt stacking and memory

Instructions are composed in layers:

1. Tide Commander base rules
2. Global system prompt
3. Area prompt
4. Agent-class instructions
5. Individual agent instructions
6. Assigned skills, identity, and persistent agent memory

This lets you define organization-wide conventions once, specialize them by project/class, and keep durable notes per agent without copying the same prompt everywhere.

### Skills

Skills are reusable instruction sets with tool permissions and optional model/context behavior. They can be assigned directly or inherited from a class. Built-ins cover notifications, inter-agent messaging, delegation reports, tracking, persistent memory, streaming execution, Git/release workflows, server/PM2 logs, tests, databases, browser/computer control, HTTP requests, workflows, triggers, Mermaid, Bitbucket review, and backup/restore.

Custom skills are Markdown-based and can be managed from the UI. Changes hot-reload into assigned agents while preserving their sessions.

### Plugins

Trusted local plugins can add:

- slash commands that bypass the LLM
- structured Guake/Spotlight result cards
- right-sidebar views and modals
- interactive actions and WebSocket patches
- browser-side UI bundles and styles
- server handlers and integration-backed settings
- configurable global shortcuts

Recent built-ins expose Gmail inbox cards, Jira ticket search/details, account usage across every harness, task boards, and managed shell commands. Plugins run with Tide Commander's local privileges, so only install code you trust.

### Workflows and triggers

The workflow editor builds state machines from action, wait, decision, and end states. Actions can assign agent tasks, wait for events, set variables, and transition on agent completion, variable conditions, timeouts, cron schedules, triggers, or manual decisions. Running instances support pause, resume, cancel, timelines, variables, reasoning traces, and scoped workflow chat.

Triggers can react to webhooks, cron/one-shot schedules, Gmail, Slack, Jira, WhatsApp, and Bitbucket. Matching can be structural, LLM-based, or hybrid, with optional variable extraction, signature validation, delivery deduplication, and fire/matcher history.

### Buildings

Buildings are functional objects, not decoration:

| Type | What it does |
|---|---|
| **Server** | Custom or PM2 start/stop/restart, logs, health, CPU/memory, and port detection |
| **Docker** | Create/adopt containers or control Compose projects, logs, health, and ports |
| **Database** | MySQL, PostgreSQL, and Oracle connections, schema browser, SQL editor, and history |
| **Terminal** | Persistent browser terminal through ttyd |
| **Tests** | Scan and run Maven/JUnit, Cucumber, Vitest, and PHPUnit suites down to a method |
| **HTTP Requests** | Browse and run IntelliJ-style `.http`/`.rest` requests with environments |
| **Monitor** | System metrics and monitoring |
| **Folder** | Open a project path in the file explorer |
| **Link** | Open a dashboard, admin panel, or other URL |
| **Boss Building** | Aggregate subordinate buildings and control them together |

## 🖥️ Views and Navigation

### 3D battlefield

The default Three.js view provides RTS-style selection, movement, camera controls, buildings, project areas, custom characters, and animated work/status effects.

![3D View](https://raw.githubusercontent.com/deivid11/tide-commander/master/docs/example-battlefield.png)

### 2D view

A lightweight top-down canvas with the same agents, areas, and buildings for lower-power devices or very large teams.

![2D View](https://raw.githubusercontent.com/deivid11/tide-commander/master/docs/preview-2d.png)

### Flat view

An IDE-style, low-overhead project layout with area status bars, buildings, agent lists, and embedded conversations. It keeps the operational controls without rendering a battlefield.

### Dashboard

Metrics and cards for agent state, current work, errors, context, and infrastructure.

![Dashboard View](https://raw.githubusercontent.com/deivid11/tide-commander/master/docs/img/dashboard_view.png)

### Commander view

A live multi-terminal grid grouped by area. See every conversation at once, switch area tabs, and expand an agent without losing the overview.

![Commander View](https://raw.githubusercontent.com/deivid11/tide-commander/master/docs/img/commander_view.png)

### Guake terminal

The main agent conversation surface supports multiple rendering levels, Markdown, syntax highlighting, structured tool cards, permission prompts, Git/building/workflow/tracking side panels, message search, pinned/recent agents, file attachments, screenshots, interrupts, and queued follow-ups.

### Spotlight

Press **Ctrl+K** (or **Alt+P**) to search and act across Tide Commander. Spotlight finds:

- agents by name, class, area, provider, status, current task, or recent activity
- current and archived conversations, with ranked matching extracts
- filenames and file contents across every area project
- modified files and Git changes
- buildings, areas, folders, settings, sessions, and commands
- plugin slash commands and their structured results

Search is accent-insensitive, supports multi-word matches across different fields, and can open a file directly at the matching line.

## 🧰 The build workspace that can replace your IDE

For many projects, the whole creation loop—from brief and research to files, commands, diffs, tests, previews, and operations—can stay inside Tide Commander. The file explorer supports multiple project roots, project-scoped tabs and expanded folders, source editing, Git status, working-tree diffs, binary/image/PDF diffs, branch comparison, file history, and test results. Files changed by an agent are clickable directly from its tool card or message.

![File Explorer with Git Diffs](https://raw.githubusercontent.com/deivid11/tide-commander/master/docs/img/diffs_view_2.png)

![Inline File Inspection](https://raw.githubusercontent.com/deivid11/tide-commander/master/docs/img/edit_dtails_while_chatting.png)

Specialized viewers include:

- rendered Markdown, Mermaid, PlantUML, SVG, images, and PDF
- `.docx`, `.docm`, `.odt`, `.fodt`, `.doc`, and `.rtf` documents
- `.xlsx`, `.xlsm`, `.xls`, `.ods`, `.csv`, and `.tsv` spreadsheets with virtualized grids, filter/sort, selections, and statistics
- zip/tar/7z/rar and many package/archive formats as browsable trees
- audio waveforms and video playback
- interactive STL, GLB, FreeCAD (`.FCStd`), and layer-aware G-code previews

You can browse from inside a viewer, drag files out to the desktop, download folders as streaming zip files, and export rendered Markdown to PDF.

## 🔌 Integrations and External Control

Built-in integrations provide settings, secure secrets, API routes, agent skills, and trigger handlers for:

- Slack (including multiple instances, messages, threads, files, reactions, and inbound events)
- Gmail
- Google Calendar
- Google Drive
- Jira Cloud / Service Desk
- WhatsApp through the local bridge
- DOCX document generation

Tide Commander also ships an optional Chromium browser extension that captures console/network failures, opens an agent chat side panel, sends requests or selected DOM/React components as context, and supports multiple Commander servers. macOS Alfred and KDE KRunner launch/search integrations are included in the repository.

## 📡 Live Execution and Session Control

Long commands can run through Tide Commander's exec API in a PTY-backed card. Output streams with ANSI color and terminal redraw handling, survives UI reconnects, can be stopped with its whole process tree, and returns a bounded tail to the agent without hiding the full live output from the user. Active ordinary CLI Bash/Task jobs also appear in the background-task rail.

Prompts sent while an agent is busy are kept in a server-side queue. Message bursts are merged into one follow-up, queued items can be interrupted or removed, and supported persistent runtimes reconnect to in-flight turns after a Commander restart. **Ctrl+C** in an open terminal interrupts the active run when no text selection is being copied.

Session history can restore a past conversation onto the same or a new agent, pre-filling its original harness/model/reasoning configuration. Spotlight searches both active and archived sessions.

## 📲 Resume Anywhere

Agent sessions live on the server rather than in one browser tab. Start on desktop and reconnect from a phone, tablet, browser extension, or another computer. The Android app adds local notifications, haptics, optional background connectivity, and in-app APK/UI updates.

![Mobile Remote Session Resume](https://raw.githubusercontent.com/deivid11/tide-commander/master/docs/img/mobile-remote-resume.png)

## 🎮 What a real workflow looks like

1. **Create a project area** and attach one or more project folders.
2. **Spawn a small team**—for example a boss, a researcher, a builder, and a test/review specialist—using whichever harness fits each role.
3. **Give the boss the outcome**, not a list of terminal commands. It can delegate focused tasks and collect reports from its subordinates.
4. **Watch execution live** in Commander view: tool cards, streamed commands, background jobs, current prompts, blockers, and context pressure stay visible.
5. **Review the result in place** through rendered documents, data grids, 3D previews, file viewers, Git diffs, and test output.
6. **Keep the useful context** by sending follow-ups, restoring an older session, or moving the conversation to another harness.
7. **Walk away without losing visibility**—notifications and the mobile clients keep you connected to the same running team.

## ⌨️ Default Keyboard Shortcuts

| Key | Action |
|---|---|
| `Ctrl+K` / `Alt+P` | Open Spotlight |
| `Tab` | Toggle Commander view |
| `Alt+N` | Spawn an agent |
| `Ctrl+1` … `Ctrl+9` | Select agent by index |
| `Space` | Open the selected agent terminal |
| `Alt+2` | Cycle 3D / 2D / Flat / Dashboard |
| `Alt+E` | Toggle file explorer |
| `Ctrl+L` | Open recent agents and buildings |
| `Ctrl+Shift+F` | Open the global session finder |
| `Ctrl+T` | Toggle test results |
| `Alt+J` / `Alt+K` | Cycle pinned agents in the terminal |
| `Alt+H` / `Alt+L` | Previous / next agent |
| `Escape` | Deselect or close the active surface |

Shortcuts can be rebound or disabled in Settings. Plugin commands can also define global shortcuts.

## 🔐 Permission Modes and Secrets

- **Bypass mode** lets a trusted autonomous CLI execute without approval prompts.
- **Interactive mode** asks for approval on protected operations and supports remembered file/command patterns. Claude uses Tide's hook-based approval bridge; other harness behavior follows the capabilities of their CLI runtime.
- **Plugin command sudo** always requires a short-lived user authorization flow. Passwords are not persisted, logged, put in command arguments/environment variables, or exposed to agents.
- **Secrets** are encrypted in the server store and referenced as `{{SECRET_NAME}}`; the real value is injected server-side instead of being saved in agent prompts.

## ⚙️ Configuration

The most common environment variables are:

| Variable | Default | Description |
|---|---:|---|
| `PORT` | `6200` | Backend and production web-app port |
| `HOST` | `127.0.0.1` | Backend bind host |
| `VITE_PORT` | `5173` | Development frontend port |
| `LISTEN_ALL_INTERFACES` | unset | Set to `1` to bind `0.0.0.0` |
| `AUTH_TOKEN` | unset | HTTP and WebSocket authentication token |
| `HTTPS` | unset | Set to `1` to replace HTTP with HTTPS/WSS |
| `HTTPS_PORT` | unset | Add an HTTPS/WSS listener alongside `PORT` |
| `TLS_KEY_PATH` | `~/.tide-commander/certs/localhost-key.pem` | Backend TLS private key |
| `TLS_CERT_PATH` | `~/.tide-commander/certs/localhost.pem` | Backend TLS certificate |
| `DEV_HTTPS` | unset | Enable HTTPS for Vite development |
| `DEV_TLS_KEY_PATH` | unset | Vite TLS private key |
| `DEV_TLS_CERT_PATH` | unset | Vite TLS certificate |
| `CODEX_BINARY` | auto | Override the Codex executable path |

See [`.env.example`](.env.example) for the maintained template.

### Data storage

Tide Commander stores application state under the XDG data directory, normally `~/.local/share/tide-commander/`. This includes agents, areas, buildings, skills, classes, secrets, session history, workflows, triggers, plugin state, command definitions, and the SQLite integration/monitoring event store. Runtime-only process state is also persisted there for recovery.

Provider conversations remain in each CLI's native session store. Tide references and reads those sessions rather than replacing the provider's own history format. Custom 3D models are stored under `~/.tide-commander/custom-models/`.

## 🧑‍💻 Development

```bash
# Install dependencies
bun install

# Start Vite (5173) and the API server (6200)
bun run dev

# Individual processes
bun run dev:client
bun run dev:server

# Quality checks
bun run lint:types
bun run lint
bun run test

# Production build
bun run build
```

## 🐳 Docker

```bash
docker build -t tide-commander .
docker run -p 6200:6200 \
  -v ~/.local/share/tide-commander:/root/.local/share/tide-commander \
  tide-commander
```

At least one supported AI agent CLI and its credentials must also be available inside the container for agents to run. See the Docker guide for host CLI mounts and deployment details.

## 📱 Android APK

Prerequisites: Android SDK and Java 17+.

```bash
make apk
make apk-release
make dev-apk CAP_SERVER_URL=http://192.168.1.100:5173
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. For a normal APK, leave `CAP_SERVER_URL` unset and configure the Commander server URL in the app. Remote Android connections require the server to listen beyond localhost; HTTPS is strongly recommended.

## 📚 Documentation

| Topic | Guide |
|---|---|
| Architecture | [Runtime and server architecture](docs/architecture.md) |
| Buildings | [Servers, Docker, databases, tests, HTTP requests, and more](docs/buildings.md) |
| Views | [3D, 2D, Dashboard, Commander, Guake, and UI navigation](docs/views.md) |
| Custom classes | [Custom classes, GLB models, and animation mapping](docs/custom-classes.md) |
| Skills | [Built-in/custom skills, permissions, assignment, and hot reload](docs/skills.md) |
| Plugins | [Trusted local plugins, slash commands, renderers, sidebars, and actions](docs/plugins.md) |
| Secrets | [Encrypted values and prompt placeholders](docs/secrets.md) |
| Browser bridge | [Browser control and integration](docs/browser-bridge.md) |
| Headless CAD | [FreeCAD jobs and generated previews](docs/headless-cad.md) |
| Bitbucket review | [Automated pull-request review triggers](docs/bitbucket-pr-review.md) |
| Android | [Build and configure the Android app](docs/android.md) |
| Docker | [Container deployment](docs/docker.md) |
| REST API | [OpenAPI 3.1 specification](docs/openapi.yaml) |
| WebSocket API | [AsyncAPI 2.6 specification](docs/asyncapi.yaml) |
| Releases | [Full changelog](CHANGELOG.md) |
| Contributing | [Contributor guide](CONTRIBUTING.md) |
| Security | [Security policy](SECURITY.md) |

## 🐛 Troubleshooting

**A harness is not detected**

- Run `which claude`, `which codex`, `which opencode`, `which grok`, or `which pi` as appropriate.
- Authenticate the CLI outside Tide Commander once before spawning an agent.
- Pi validates that `pi` is the coding agent rather than the unrelated Anaconda utility with the same command name.

**An agent is stuck in “working”**

- Open its background-task rail and server logs to check for a live child process.
- Use the terminal interrupt/stop action before killing the agent.
- Persistent Codex, OpenCode, and Pi modes may reconnect to a still-running detached turn after a server restart.

**The web app cannot connect**

- The production default is `http://localhost:6200`; development uses `http://localhost:5173` for Vite and proxies to port `6200`.
- Verify `tide-commander status`, then inspect `tide-commander logs`.
- For remote clients, verify bind host, firewall, URL scheme, certificate, and auth token.

## Ready to command the team?

```bash
npx tide-commander@latest
```

<p align="center">
  <a href="https://tidecommander.com/app"><strong>Try the live demo</strong></a>
  &nbsp;·&nbsp;
  <a href="https://www.youtube.com/watch?v=r1Op_xfhqOM"><strong>Watch it in action</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/deivid11/tide-commander/stargazers"><strong>Star the project</strong></a>
</p>

## 💬 Community

[![Discord](https://img.shields.io/badge/Discord-Join%20Server-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/MymXXDCvf)

Found a bug or have a feature idea? Open a [GitHub issue](https://github.com/deivid11/tide-commander/issues) or join the Discord community. If Tide Commander improves your workflow, a GitHub star helps more creators find it.

## 📄 License

MIT
