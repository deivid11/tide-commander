# Tide Commander Alfred Workflow

Search and focus Tide Commander agents directly from [Alfred](https://www.alfredapp.com/) on macOS.

## Features

- **Search agents** by name, class, status, area, or task label
- **Focus agent** — brings the Tide Commander window to front and selects the agent
- **Smart sorting** — active/working agents appear first, then sorted by recent activity
- **Configurable** — set API URL and auth token in workflow settings

## Installation

1. Double-click `Tide Commander.alfredworkflow` to import into Alfred
2. (Optional) Open the workflow settings to configure the API URL and auth token

## Usage

Type in Alfred:

```
tide [search]     — Search agents
```

- `tide` — List all agents (sorted by activity)
- `tide scout` — Filter agents matching "scout"
- `tide working` — Show agents with "working" status

### Actions

- **Enter** — Focus the Tide Commander window and select the agent
- **Cmd+C** — Copy the agent ID

## Configuration

Open the workflow's **Configure Workflow** panel in Alfred to set:

| Variable | Default | Description |
|---|---|---|
| `TIDE_API_BASE` | `http://localhost:5174/api` | Tide Commander API URL |
| `TIDE_AUTH_TOKEN` | _(empty)_ | Auth token (if server requires it) |

## Requirements

- macOS with Alfred (Powerpack license for workflows)
- Python 3 (included with macOS)
- curl (included with macOS)
- Tide Commander server running
