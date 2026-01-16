# Tide Commander

RTS/MOBA-style Claude Code agents commander. Deploy, position, and command multiple Claude Code instances on a strategic battlefield.

## Why Tide Commander?

Working on large projects often requires juggling multiple tasks simultaneously - exploring the codebase, implementing features, fixing bugs, and writing tests. Tide Commander lets you spin up multiple Claude Code agents, each focused on a specific task or area of your project, and manage them all from a single visual interface.

Think of it like having a team of AI developers at your command. Assign one agent to investigate a bug while another implements a feature. Watch them work in real-time, send follow-up commands, and keep your project moving forward on multiple fronts.

## Features

- **3D Battlefield** - Visual command center with Three.js
- **RTS Controls** - Click to select, right-click to move, number keys for quick selection
- **Real-time Activity Feed** - Watch your agents work in real-time
- **Multi-Agent Management** - Spawn and control multiple Claude Code instances
- **Session Persistence** - Agents resume their Claude Code sessions across restarts

## Prerequisites

- Node.js 18+ or Bun
- Claude Code CLI (`claude` command available in PATH)

## Getting Started

```bash
# Install dependencies
bun install

# Start the application
bun run dev
```

Open http://localhost:5173 in your browser and you're ready to go.

## How to Use

1. **Deploy an agent** - Click the **+ New Agent** button
2. **Configure it** - Give it a name and choose a working directory (the folder it will operate in)
3. **Select it** - Click on the agent in the 3D view or press 1-9
4. **Send commands** - Type your task in the command bar and press Enter
5. **Watch it work** - The activity feed shows real-time progress
6. **Send follow-ups** - Agents maintain context, so you can have ongoing conversations

You can spawn multiple agents, each working in different directories or on different tasks. Switch between them by clicking or using number keys.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| 1-9 | Select agent by index |
| Escape | Deselect / Close modal |
| Alt+N | Spawn new agent |
| Enter | Send command (when input focused) |

## How It Works

### Overview

Tide Commander provides a visual interface for managing multiple Claude Code CLI instances simultaneously. Each "agent" you spawn is a real Claude Code process running in the background, and you can send commands to them and watch their output in real-time.

### Core Components

**Frontend (React + Three.js)**
- 3D battlefield where agents are visualized as characters
- WebSocket connection to receive real-time updates
- Command input for sending tasks to agents
- Activity feed showing what each agent is doing

**Backend (Node.js + Express)**
- REST API for agent CRUD operations
- WebSocket server for real-time event streaming
- Process manager that spawns and controls Claude CLI instances

**Claude CLI Integration**
- Each agent runs `claude` with `--output-format stream-json`
- Events (tool usage, text output, errors) are parsed from stdout
- Commands are sent via stdin in stream-json format
- Sessions are persisted and can be resumed

### Architecture

```
┌─────────────────────────────────────────┐
│           Browser (Three.js)            │
│  - 3D battlefield visualization         │
│  - Agent selection & movement           │
│  - Command interface                    │
└─────────────────┬───────────────────────┘
                  │ WebSocket
┌─────────────────▼───────────────────────┐
│           Node.js Server                │
│  - Agent lifecycle management           │
│  - Claude CLI process management        │
│  - Event broadcasting                   │
└─────────────────┬───────────────────────┘
                  │ stdin/stdout (stream-json)
┌─────────────────▼───────────────────────┐
│         Claude Code Instances           │
│  - Each agent = Claude CLI process      │
│  - Events streamed via JSON output      │
└─────────────────────────────────────────┘
```

## Development

```bash
# Run client only (Vite dev server on :5173)
bun run dev:client

# Run server only (Express + WebSocket on :5174)
bun run dev:server

# Run both concurrently
bun run dev

# Build for production
bun run build
```

## Troubleshooting

**Agent stuck in "working" status**
- The Claude process may have died unexpectedly
- Refresh the page - status sync runs on reconnect
- Check server logs for errors

**"Claude Code CLI not found"**
- Ensure `claude` is in your PATH
- Run `which claude` to verify installation

**WebSocket disconnects**
- Check that the server is running on port 5174
- Look for CORS or firewall issues

## License

MIT
