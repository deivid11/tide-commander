---
title: "I Built an RTS-Style Command Center for AI Coding Agents (Claude Code + Codex)"
published: false
description: "Tide Commander is a free, open-source visual orchestrator that turns managing multiple AI coding agents into something that looks like a strategy game — but is packed with real developer tools."
tags: opensource, ai, webdev, productivity
cover_image: https://raw.githubusercontent.com/deivid11/tide-commander/master/docs/preview-3d.png
canonical_url:
series:
---

If you run multiple Claude Code or Codex terminals at the same time, you already know the pain: tabs everywhere, lost context, missed completions. I built **Tide Commander** to solve that.

It's a visual multi-agent orchestrator where your AI agents appear as **3D characters on a battlefield**. Click to select, type to command, watch them work in real-time. It looks like a game, but internally it's a full developer toolkit.

{% youtube r1Op_xfhqOM %}

## Quick Start

```bash
bunx tide-commander
```

That's it. Node.js 18+, Linux or Mac, and Claude Code or Codex CLI in your PATH.

> **[IMAGE PLACEHOLDER: 3D battlefield overview — `docs/preview-3d.png`]**

---

## The Problem

AI coding agents work best in parallel — one on tests, one on features, one on bugs. But managing five terminals at once is chaos. Which one has context on the auth module? Did the test agent finish? Tide Commander puts everything in **one visual interface** with file diffs, a git-integrated file explorer, and real-time streaming output. For many workflows, an IDE becomes almost unnecessary.

---

## Key Concepts

**Boss Agents** — Has context of subordinate agents, delegates tasks to the most capable one, summarizes worker progress. Talk to one Boss instead of juggling terminals.

**Supervisor** — God-mode observer. Auto-generates summaries when agents finish. You never miss a completed task.

**Group Areas** — Draw areas on the battlefield to organize agents by project. Assign folders to enable the file explorer.

**Classes** — Like COD or Minecraft classes: each has a 3D model, instructions (like claude.md), and skills. Create custom classes with your own GLB models.

**Buildings** — Functional 3D structures that control **real infrastructure**:

| Type | What It Does |
|:---|:---|
| Server | PM2 integration, real-time logs, CPU/memory stats |
| Database | MySQL/PostgreSQL/Oracle — SQL editor, schema browser |
| Docker | Container management, health checks, log streaming |
| Boss Building | Bulk controls for subordinate buildings |

> **[IMAGE PLACEHOLDER: Building panel with PM2 stats and logs]**

---

## Developer Tools

Despite the RTS aesthetic, this is developer-first:

- **File Explorer + Git Diffs** — Side-by-side diff viewer, branch switching, merge conflict UI, vim-style navigation (`j/k/d/u/f/b/g/G//n/N`)
- **Context Tracking** — Mana bar per agent showing context window usage
- **Snapshots** — Save full conversations + modified files, restore later
- **Secrets** — AES-256-GCM encrypted `{{PLACEHOLDER}}` injection, never in logs
- **Permissions** — Bypass or interactive mode, per agent
- **Spotlight** (`Ctrl+K`) — Fuzzy search for agents, files, areas, actions
- **Paste Anything** — File paths auto-attach, screenshots paste inline, large text auto-compacts
- **Commander View** — All agent terminals in a grid, grouped by area

> **[IMAGE PLACEHOLDER: File explorer with git diff viewer]**

---

## Three View Modes

Cycle with `Alt+2`: **3D** (Three.js battlefield, 12 built-in models, custom GLB support), **2D** (canvas, same features, lighter), **Dashboard** (status cards and metrics).

> **[IMAGE PLACEHOLDER: 2D view — `docs/preview-2d.png`]**

---

## Skills System

Plugins with tool permissions and markdown instructions. Built-in: Git Captain, Notifications (browser/Android/desktop), Streaming Exec, inter-agent messaging, DB & server logs. Create custom skills and assign to agents or classes.

---

## Architecture

```
User → React + Three.js → WebSocket → Node.js/Express → claude/codex CLI
```

Each agent is a real CLI process. Backend parses stdout events and streams to the frontend. Sessions persist across restarts. ~130k lines of TypeScript. All data stays local.

> **[IMAGE PLACEHOLDER: Architecture diagram — `docs/system-architecture.png`]**

---

## Also Included

Multiplayer (WSS), mobile + Android APK, custom hotkeys, Docker deployment, WSS debugger, HTML-rendered output (no terminal flicker), custom idle/working animations per class.

---

## Free and Open Source

MIT license. No paid tiers. No sign-up. No telemetry.

```bash
npm i -g tide-commander@latest
tide-commander start
```

{% github deivid11/tide-commander %}

[Discord](https://discord.gg/MymXXDCvf) | [YouTube Demo](https://www.youtube.com/watch?v=r1Op_xfhqOM)

---

If you're juggling multiple AI coding agents, give it a try. Feedback welcome.

> **[IMAGE PLACEHOLDER: Hero banner — full UI with agents and buildings]**
