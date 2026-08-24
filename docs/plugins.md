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

### Integration-backed configuration

A plugin that depends on an existing Tide Commander integration can expose setup instructions and secure configuration directly in **Settings → Plugins**:

```json
{
  "contributes": {
    "settings": [{
      "id": "gmail-connection",
      "type": "integration",
      "integrationId": "gmail",
      "title": "Gmail connection",
      "description": "Configure the account used by this plugin.",
      "instructions": ["Enable Gmail API", "Create OAuth Web credentials", "Authorize the account"],
      "secrets": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]
    }]
  }
}
```

The Plugins panel displays the instructions and secret names, never their values. **Configure** opens the integration's native configuration flow above the Plugins panel, including password fields, OAuth authorization, service-account setup, connection status, and secure secret persistence.

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

## User-managed Bash slash commands

Open **Settings → Plugins → Manage Plugins → Slash command scripts** to register a command without creating a plugin package. Each definition includes:

- a slash name and description
- a Bash command or multiline script
- an optional absolute working directory; otherwise it uses the selected agent workspace
- PTY streaming, enabled by default
- an optional **Allow sudo** policy

Slash arguments are parsed without evaluation and passed positionally as `$1`, `$2`, and so on. For example, `/deploy "release candidate"` passes one literal argument. The saved script is executed through `POST /api/exec`, streams into a native Guake exec widget, supports Stop and exit status, bypasses the LLM, and never interpolates arguments into script source.

Scripts with **Allow sudo** request user authorization before launch. User-entered slash commands open Tide Commander's password modal; agent-entered slash commands render the same secure authorization flow inline in the agent conversation. The script itself still runs as the normal Commander user; only lines that invoke `sudo` are elevated. Tide validates the password through `sudo` stdin, then supplies nested `sudo` calls through a private per-run Unix socket and an ephemeral askpass helper. The password is never persisted, logged, placed in argv/environment variables, written to generated scripts, or sent through WebSockets/PTY output. HTTPS is strongly recommended for remote access. On remote HTTP connections, Tide shows a prominent warning but allows the user to continue (for example, over a trusted VPN); localhost remains supported over HTTP without the warning.

The built-in **Execute Slash Commands** skill teaches agents to discover enabled commands with `GET /api/plugins/slash-commands`. Agents can invoke plugin commands through their published endpoint and command scripts through `POST /api/exec` with `shellCommandId` and `shellArgs`. For sudo-enabled scripts, `/api/exec` returns `202 awaitingUserAuthorization` and publishes an inline password card; after the user authorizes it, the browser starts the streamed execution. Agents may include structured top-level `"grep":"literal text"` and `"tail":10` fields; Commander applies literal line filtering followed by tailing only to the returned/callback result while preserving the complete live stream. Shell operators such as `| grep` and `| tail` are never accepted through `shellArgs`, which remain literal positional values. When that execution finishes, Commander invokes the requesting agent with a bounded `COMMANDER_SLASH_COMMAND_RESULT` message containing the command, exit code, duration, and up to the final 12,000 output characters. User-launched slash commands do not trigger this callback. Agents are explicitly prohibited from requesting or handling sudo passwords, credentials, or authorization IDs.

## Management API

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/plugins` | List built-in and installed plugins |
| `GET` | `/api/plugins/slash-commands` | Safe agent-facing catalog of enabled slash commands |
| `GET` | `/api/plugins/shell-commands` | List managed command-script definitions for Settings |
| `POST` | `/api/plugins/shell-commands` | Create a managed command script |
| `PUT/DELETE` | `/api/plugins/shell-commands/:id` | Update or remove a managed command script |
| `POST` | `/api/plugins/shell-commands/:id/prepare` | Parse arguments and create an optional sudo challenge |
| `POST` | `/api/plugins/shell-commands/sudo/authorize` | Validate a short-lived interactive sudo challenge |
| `POST` | `/api/plugins/install` | Install from `{ "sourcePath": "/local/folder" }` |
| `POST` | `/api/plugins/:id/enable` | Activate a plugin |
| `POST` | `/api/plugins/:id/disable` | Deactivate and clean up a plugin |
| `POST` | `/api/plugins/:id/commands/:command` | Execute a plugin command over REST |
| `POST` | `/api/plugins/:id/actions/:action` | Execute an interactive UI action |
| `GET` | `/api/plugins/:id/client` | Authenticated browser bundle |

Installed plugin state is persisted under Tide Commander's data directory. Disabling a plugin runs its cleanup and hides its UI contributions without deleting its source folder.

## Tide Commander runtime utilities

The built-in `tide-commander` plugin contributes `/usages`. It loads daily or short-term and weekly quota windows for every registered account across Claude, Codex, Grok, OpenCode, and Pi without invoking an agent or LLM. Each live window shows both its reset date and a compact days/hours countdown. Expired/revoked accounts stay hidden at the bottom behind **Mostrar expiradas**. Providers that do not publish one of these windows remain visible with an explicit unavailable or dynamic-capacity state.

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

## Gmail Pending

`gmail-pending` is a built-in plugin backed by the existing Gmail integration. It contributes:

- `/gmail [all|unread] [limit]`, with `/gmail-pending`, `/correos`, `/gmail-all`, and `/todos-correos` aliases
- an in-card **No leídos / Todos** switch: unread mode uses `in:inbox is:unread`, while all mode uses `in:inbox` and includes both read and unread messages
- Inbox messages with sender, subject, recipients, labels, attachments, date, read state, and collapsible plain-text content
- a direct **Ver en Gmail** link for every message
- a per-message **Marcar como leído** action that removes Gmail's `UNREAD` label and refreshes the card
- a refresh action and configurable result limit from 1 to 50 (default 10); for example, `/gmail all 25`

Connect Gmail from **Settings → Plugins → Gmail Inbox → Configure**. The plugin uses the same OAuth or service-account credentials as Tide Commander's Gmail integration and does not add another authentication flow.

## Jira Tickets

`jira-tickets` is a built-in plugin backed by the existing Jira Cloud integration. It contributes:

- `/jira` to show all unresolved tickets visible to the configured Jira account, regardless of assignee
- `/jira PROJ-123` to open one exact ticket, including its plain-text description
- `/jira buscar texto` (or simply `/jira texto`) to search recently updated tickets by text
- `/jira pending 30` to change the pending-ticket result limit (1-50)
- an in-card search field that accepts either an issue key or free text
- compact ticket rows with status, priority, assignee, project, issue type, labels, timestamps, and direct **Abrir en Jira** links
- click-to-expand full details loaded on demand: description, reporter, components, fix versions, due date, comments, and attachments
- clicking an attachment securely caches it server-side and opens it in Tide Commander's native File Viewer; each attachment also keeps a dedicated download button
- setup instructions and secure Jira Cloud credentials under **Settings → Plugins → Jira Tickets → Configure**

The pending query is `statusCategory in ("To Do", "In Progress")`, so it includes every visible unresolved ticket regardless of assignee while remaining bounded for Jira Cloud's enhanced search API. Free-text searches are bounded to tickets updated during the last year. Exact issue-key lookups are fetched directly.
