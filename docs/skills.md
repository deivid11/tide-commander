# Skills System

Skills are instruction sets that extend what agents can do. Each skill contains a markdown prompt, a list of allowed tools, and can be assigned to specific agents or entire classes.

## Built-in Skills

| Skill | Description |
|-------|-------------|
| Full Notifications | Send notifications via browser, Android, or Linux desktop |
| Send Message to Agent | Inter-agent messaging through the API |
| Git Captain | Git workflow automation (commit, changelog, tags, conflicts) |
| Server Logs | Access to Tide Commander server logs |
| Streaming Exec | Execute long-running commands with real-time output |
| Bitbucket PR | Bitbucket pull request management |
| PM2 Logs | PM2 process manager log access |

Built-in skills cannot be deleted but can be disabled.

## Creating Custom Skills

Open the **Skills** tab in the Skills panel and click **New Skill**. Define:

- **Name and description** - The description helps Claude know when to use the skill
- **Content** - Markdown instructions with examples, templates, and guidelines
- **Allowed tools** - Tool permissions the skill grants (e.g., `Bash(git:*)`, `Read`, `Edit`)
- **Model override** (optional) - Use a specific Claude model for this skill
- **Context mode** - `inline` (runs in agent's context) or `fork` (isolated sub-agent)

### Tool Permission Format

Skills define which tools the agent can use without prompting:

- `Read` - Allow the Read tool
- `Bash(git:*)` - Allow Bash but only for git commands
- `Bash(curl:*)` - Allow Bash but only for curl commands
- `Edit` - Allow file editing

## Assigning Skills

Skills can be assigned in two ways:

1. **To individual agents** - Assign directly through the skill editor or agent settings
2. **To agent classes** - All agents of that class automatically receive the skill

When a skill is assigned to a class, any new agent spawned with that class gets the skill immediately.

## How Skills Work

When an agent starts or receives a command, all assigned skills are injected into the system prompt. The agent sees the skill instructions and allowed tools as part of its context.

Skills that reference the localhost API (e.g., notification or exec endpoints) automatically get the server's auth token injected into curl commands.

## Hot Reload

Updating a skill's content triggers an automatic agent restart for all agents using that skill. The session is preserved so the agent resumes with the updated instructions.
