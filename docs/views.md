# Views & UI

Tide Commander has multiple view modes and UI components for interacting with your agents.

## View Modes

Cycle between views with Alt+2, or use the toggle in the top toolbar.

### 3D View

The default view. A Three.js-powered battlefield where agents are rendered as 3D character models. Features:

- Click to select agents, right-click to move them
- Number keys (1-9) for quick agent selection
- Orbit camera controls (zoom, pan, rotate)
- Visual effects for subagent spawning and movement
- Building models with animated status indicators
- Drawing areas (rectangles and circles) for organization

### 2D View

A lightweight canvas-based alternative to the 3D view. Same functionality with lower resource usage - useful on less powerful machines or when running many agents.

### Dashboard

A metrics-focused view with:
- Metrics bar showing agent counts (total, working, idle, errors) and building count
- Filter agents by status (all, working, errors)
- Agent cards with status indicators, class icons, and quick actions (focus in 3D, kill)
- Building cards showing type and status
- Click any agent card to select it; use the focus button to jump to the 3D view centered on that agent

## Commander View

A multi-panel terminal grid where you can see all agent conversations at once. Panels are grouped by area. Each panel shows the live conversation stream for one agent. You can expand any panel to full size for detailed interaction.

Open Commander View from the toolbar or Spotlight search.

## Guake Terminal

A drop-down terminal overlay inspired by the [Guake](http://guake-project.org/) Linux terminal. Toggle it with the backtick key (`` ` ``).

Features:
- Real-time streaming output from the selected agent
- Full conversation history loading from Claude sessions
- Tool output formatting (Bash, Edit, Write, Read) with syntax highlighting
- Markdown rendering with code blocks
- Permission approval dialogs (in interactive mode)
- Snapshot creation
- Message navigation (Alt+J / Alt+K to jump between messages)

## Spotlight Search (Ctrl+K)

A command palette for quick navigation:
- **Agent search** - Find by name, class, current task, or modified files
- **Area search** - Jump to project areas
- **File search** - Find files modified across all agents
- **Command search** - Quick actions (spawn agent, open settings, toggle supervisor)
- Fuzzy matching with keyboard navigation

## Group Areas

Drawing areas on the battlefield for organizing agents by project or purpose.

- **Rectangle and circle shapes** drawn directly on the field
- **Folder assignment** - Attach directories to areas, enabling the file explorer for those folders
- **Agent grouping** - Agents inside an area are visually grouped
- **Archive areas** - Hide completed or inactive areas without deleting them. Archived areas and their agents are hidden from the battlefield but can be restored at any time from the areas panel.

## File Explorer

A built-in file browser accessible via Alt+E or from areas with assigned folders.

- Multi-root support (multiple project directories)
- Git integration showing uncommitted changes
- Side-by-side diff viewer for modified files
- File tabs for viewing multiple files
- Search across files

## Sidebar & Right Panel

- **Sidebar** (Alt+S) - Agent list, area management, building controls
- **Right Panel** (Alt+R) - Tabbed panel with agent details, file changes, token usage, and more
