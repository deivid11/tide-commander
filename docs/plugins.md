# Trusted local plugins

Tide Commander plugins are local software extensions that can contribute slash commands, Guake output cards, sidebar views, modals, server command/action handlers, and browser UI.

> Plugins are trusted code. A server entry runs with the same filesystem and network permissions as Tide Commander. A browser entry runs inside the Commander page. Only install plugins you trust.

## Package layout

```text
my-plugin/
├── manifest.json
├── dist/
│   ├── server.js
│   └── client.js
└── styles.css
```

Browser entries must be self-contained bundled ESM files. They are fetched through Tide Commander's authenticated API and loaded at runtime.

## Manifest

```json
{
  "id": "my-tasks",
  "name": "My Tasks",
  "version": "1.0.0",
  "description": "Interactive task integration",
  "main": "dist/server.js",
  "browser": "dist/client.js",
  "contributes": {
    "slashCommands": [
      {
        "name": "/show-pending-tasks",
        "aliases": ["/tasks"],
        "summary": "Show pending tasks",
        "handler": "show-pending-tasks",
        "renderer": "task-list"
      }
    ],
    "views": [
      {
        "id": "pending-tasks",
        "title": "Tasks",
        "icon": "list-checks",
        "location": "sidebar.right"
      }
    ],
    "modals": [
      { "id": "task-details", "title": "Task details" }
    ],
    "outputRenderers": [
      { "id": "task-list" }
    ]
  }
}
```

Plugin IDs must be lowercase and may contain numbers, dashes, dots, and underscores. Entry paths must remain inside the plugin directory; path traversal and escaping symlinks are rejected.

## Server entry

A server module exports `activate(api)`. It can return command/action maps and a cleanup function.

```js
export function activate(api) {
  return {
    commands: {
      async "show-pending-tasks"(context) {
        const tasks = await loadTasks();
        return {
          kind: "task-list",
          title: "Pending tasks",
          items: tasks,
          actions: {
            complete: "complete",
            reopen: "reopen",
            refresh: "refresh"
          }
        };
      }
    },
    actions: {
      async complete(context) {
        await completeTask(context.itemId);
        return buildTaskList();
      },
      async reopen(context) {
        await reopenTask(context.itemId);
        return buildTaskList();
      },
      async refresh() {
        return buildTaskList();
      }
    },
    deactivate() {
      // Release timers, sockets, listeners, and other resources.
    }
  };
}
```

Plugin slash commands are intercepted by Commander before the selected agent runtime. They do not call the LLM, consume tokens, or wait for an active agent turn to finish.

They can also be run from Spotlight: start the query with `/`, choose an enabled plugin command, and press Enter. Spotlight opens the structured result in a modal using the same native or plugin-contributed renderer. This path is global and does not require an active agent.

Each contributed slash command can also have a configurable global keyboard shortcut. Open **Settings → Plugins → Manage Plugins**, click the shortcut field under the command, and press the desired chord (for example `Ctrl+I`). The shortcut executes the plugin command directly and opens the same structured result modal.

## Built-in task-list renderer

Returning the following data shape uses Tide Commander's native interactive task component:

```js
{
  kind: "task-list",
  title: "Pending tasks",
  count: 2,
  items: [
    {
      id: 42,
      title: "Ship plugin runtime",
      status: "open",
      project: "tide-commander",
      due: "2026-08-21",
      metadata: {}
    }
  ],
  actions: {
    complete: "complete",
    reopen: "reopen",
    refresh: "refresh"
  }
}
```

The built-in renderer supplies status/due badges, overdue highlighting, optimistic completion, loading and error states, refresh, and in-place WebSocket patches.

## Browser entry

A browser module exports `activate(api)`. Framework-neutral views use a `mount(container, context)` function and return cleanup.

```js
export function activate(api) {
  const disposables = [];

  disposables.push(api.registerSidebarView({
    id: "pending-tasks",
    title: "Tasks",
    icon: "list-checks",
    mount(container, context) {
      const button = document.createElement("button");
      button.textContent = "Open task details";
      button.onclick = () => context.openModal("task-details", { id: 42 });
      container.append(button);
      return () => button.remove();
    }
  }));

  disposables.push(api.registerModal({
    id: "task-details",
    title: "Task details",
    mount(container, context) {
      container.textContent = JSON.stringify(context.data, null, 2);
      return () => container.replaceChildren();
    }
  }));

  disposables.push(api.registerOutputRenderer({
    id: "my-custom-card",
    mount(container, context) {
      container.textContent = JSON.stringify(context.output.data, null, 2);
      return () => container.replaceChildren();
    }
  }));

  return () => disposables.reverse().forEach(dispose => dispose());
}
```

All registrations return disposers and are removed when the plugin is disabled.

## Management API

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/plugins` | List built-in and installed plugins |
| `POST` | `/api/plugins/install` | Install from `{ "sourcePath": "/local/folder" }` |
| `POST` | `/api/plugins/:id/enable` | Activate a plugin |
| `POST` | `/api/plugins/:id/disable` | Deactivate and clean up a plugin |
| `POST` | `/api/plugins/:id/commands/:command` | Execute a plugin command over REST |
| `POST` | `/api/plugins/:id/actions/:action` | Execute an interactive UI action |
| `GET` | `/api/plugins/:id/client` | Authenticated browser bundle |

Installed plugin state is persisted under Tide Commander's data directory. Disabling a plugin runs its cleanup and hides its UI contributions without deleting its source folder.

## Bolba Tasks

`bolba-tasks` is the built-in reference plugin. It contributes:

- `/show-pending-tasks` and `/tasks`
- the native interactive card with pending tasks plus the 8 most recently completed tasks
- complete, reopen, and refresh actions; clicking a completed check reopens that task
- a Tasks sidebar with separate pending and recently-completed groups
- registration dates at the start of every row and color-coded task age in details
- a scrollable, stacked task-detail modal with a sticky task header that loads the complete Bolba timeline on demand
- a local dismiss button on Guake plugin widgets
- the legacy rich renderer for Bolba API curls already present in agent history

The server endpoint defaults to `http://127.0.0.1:7492`. Override it with `BOLBA_TASKS_URL` and `BOLBA_TASKS_TOKEN`.
