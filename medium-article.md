# I Built a Visual Command Center for AI Coding Agents — and It Looks Like an RTS Game

## How Tide Commander turns the chaos of managing multiple Claude Code and Codex terminals into a single, game-inspired battlefield

---

If you've ever worked with multiple AI coding agents at the same time, you know the pain. Terminal windows pile up. You forget which agent has context on which task. Switching between them breaks your flow. And when one finishes, you might not even notice.

I built **Tide Commander** to fix all of that.

It's a visual multi-agent orchestrator for **Claude Code** and **OpenAI Codex** that lets you deploy, control, and monitor AI coding agents from a single interface. Agents appear as 3D characters on a battlefield. You click to select, type to command, and watch them work in real-time.

It looks like a game. But make no mistake — this is a serious developer tool.

---

## Why Not Just Use Terminals?

The core problem is simple: **AI coding agents work best when you run several in parallel**, each focused on a different file, feature, or bug. But managing them is a mess.

- Which terminal has context on the auth module?
- Did the agent working on tests finish yet?
- Where's the output from that database migration?

Tide Commander replaces that chaos with a single visual interface where you can see every agent, their status, and their output at a glance. For many workflows, an IDE becomes almost unnecessary — the same interface has file diff viewers on agent conversations, a file explorer showing uncommitted changes, and a built-in terminal with full syntax highlighting.

---

## The Concepts That Make It Work

Beyond the visual layer, Tide Commander introduces several organizational concepts that genuinely change how you work with multiple agents.

### Boss Agents

The **Boss** agent has context of other agents assigned to it. When you send a task to the Boss, it decides which subordinate agent is most capable of handling the request and delegates accordingly.

This saves enormous amounts of time. Instead of remembering which terminal has context on which part of the codebase, you talk to one Boss, and it routes work intelligently. The Boss can also summarize the progress of all its workers on demand.

### Supervisor

The **Supervisor** is like a god-mode observer. It sees everything on the field, knows when any agent finishes a task, and automatically generates a summary that gets appended to a global, centralized panel. You never miss a completed task again.

### Group Areas

Areas help you **organize agents by project**. Draw a rectangle on the battlefield, name it "Backend API" or "Mobile App," and drag agents into it. Areas can have assigned folders, which enables the built-in file explorer for those directories. Completed areas can be archived and restored later.

### Classes

Inspired by class systems in games like Call of Duty or Minecraft, **Classes** define an agent's role. Each class has a linked 3D model, a set of instructions (like a project-specific claude.md), and assigned skills.

Built-in classes include Scout, Builder, Debugger, Architect, Warrior, Support, and Boss. But you can create **custom classes** with your own 3D models (GLB format), custom instructions, and default skill sets.

### Buildings

This is still a work in progress, but the concept is powerful: **place functional buildings on the battlefield** that control real infrastructure.

- **Server Buildings** — Start/stop/restart services with real-time log streaming. Full PM2 integration with CPU/memory monitoring.
- **Database Buildings** — Connect to MySQL, PostgreSQL, or Oracle. Interactive SQL query editor, schema browser, query history with favorites.
- **Docker Buildings** — Manage containers and compose projects. Health checks, resource stats, log streaming.
- **Boss Buildings** — Manage groups of subordinate buildings with bulk controls.

These aren't decorative. They're functional infrastructure widgets embedded in the battlefield.

---

## The Commander View

Sometimes you want to see everything at once. The **Commander View** displays all agent terminals in a grid layout, grouped by area. You can expand any panel to full size, or just monitor all agents simultaneously.

Think of it as mission control for your coding team.

---

## Developer Tools Hidden Behind the Game Aesthetic

Despite the RTS visuals, this is packed with developer-first features:

### File Explorer with Git Diffs
A built-in file browser that shows **uncommitted changes** with side-by-side diff viewing. It supports git branch switching, merge conflict resolution, and file tabs. Navigation uses **less/vim-style keybindings** — `j/k` for lines, `d/u` for half-page, `/` for search, `n/N` for matches, `?` for help.

### Context Tracking (Mana Bar)
Each agent displays a **mana bar** showing how much of its context window has been consumed. At a glance, you know which agents are running low and might need a fresh session.

### Snapshots
Capture the full conversation history and any files created or modified during a session. Snapshots can be reviewed later with full tool formatting, and files can be restored from them.

### Secrets Management
Store API keys and credentials securely with AES-256-GCM encryption. Use `{{SECRET_NAME}}` placeholders in your prompts, and the server injects real values before sending to the agent. Secrets never appear in logs or conversation history.

### Permission Control
Run agents in **bypass mode** (full autonomy) or **interactive mode** (approve dangerous operations like file writes and bash commands). Permissions are configurable per agent.

### Spotlight Search
Press `Ctrl+K` to open a command palette. Search for agents by name, class, or current task. Find modified files across all agents. Jump to areas. Trigger quick actions with fuzzy matching.

### Paste Anything
Paste file paths and they auto-attach as file references. Paste screenshots directly into the terminal. Paste large blocks of text and they get compacted automatically.

---

## Three Ways to View the Battlefield

Tide Commander offers three rendering modes, and you can cycle between them with `Alt+2`:

1. **3D View** — Full Three.js battlefield with 12 built-in character models, custom model support, post-processing effects, and cinematic camera. This is the default and the most visually impressive.

2. **2D View** — A lightweight canvas-based rendering. Same functionality, lower resource usage. Great for laptops or when you need to save GPU cycles for the agents themselves.

3. **Dashboard** — Agent status cards, building overview, and metrics in a traditional layout.

---

## Skills: Extending What Agents Can Do

Skills are like plugins. Each skill has defined tool permissions and markdown instructions that get injected into the agent's context. Built-in skills include:

- **Git Captain** — Commit management, changelog generation, conflict resolution
- **Full Notifications** — Browser, Android, and Linux desktop notifications on task completion
- **Streaming Exec** — Long-running commands with real-time output (builds, tests, dev servers)
- **Send Message** — Inter-agent communication
- **Database & Server Logs** — Access infrastructure from within the agent context

You can create **custom skills** with your own instructions and tool permissions, then assign them to specific agents or entire classes.

---

## Technical Architecture

Under the hood, Tide Commander is a **React + Three.js frontend** paired with a **Node.js + Express backend**, communicating over WebSocket for real-time events.

Each agent you spawn is a real `claude` or `codex` CLI process. The backend manages process lifecycle, parses stdout for events (tool usage, text output, errors), and streams everything to the frontend in real-time.

Sessions are persisted and resume across server restarts. Agent configurations, positions, token usage, and conversation history are all saved locally.

---

## Getting Started

Requirements are minimal: **Node.js 18+**, **Linux or Mac**, and either **Claude Code** or **Codex CLI** installed.

```bash
# Run directly without installing
bunx tide-commander

# Or install globally
npm i -g tide-commander@latest
tide-commander start
```

That's it. Open your browser and you're on the battlefield.

The project also supports **Docker deployment**, an optional **Android APK** for remote monitoring, and **multiplayer** via WebSocket for teams working together.

---

## What's Next

The roadmap includes a **buildings plugin system** for custom building types, **multilingual support** (i18n), comprehensive **test coverage**, and **API documentation** with OpenAPI/Swagger.

---

## Free and Open Source

Tide Commander is completely free under the **MIT license**. No paid tiers. No sign-up required. No telemetry. All data stays on your machine.

- **GitHub**: [deivid11/tide-commander](https://github.com/deivid11/tide-commander)
- **npm**: `tide-commander`
- **Discord**: [Join the community](https://discord.gg/MymXXDCvf)
- **Demo**: [Watch on YouTube](https://www.youtube.com/watch?v=r1Op_xfhqOM)

---

If you're juggling multiple AI coding agents and feeling the terminal fatigue, give Tide Commander a try. It turned my workflow from chaos into something that actually feels... fun.

Feedback welcome — find me on the Discord or open an issue on GitHub.

---

*David Alcala is the creator of Tide Commander, an open-source visual orchestrator for AI coding agents.*
