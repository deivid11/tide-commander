import type { BuiltinSkillDefinition } from './types.js';

export const serverLogs: BuiltinSkillDefinition = {
  slug: 'server-logs',
  name: 'Server Logs Explorer',
  description: 'Use this skill when the user asks about server logs, backend errors, debugging server issues, checking what happened on the server, or monitoring server activity.',
  allowedTools: ['Bash(tail:*)', 'Bash(head:*)', 'Bash(wc:*)', 'Bash(ls:logs/*)', 'Read', 'Grep'],
  content: `# Server Logs Explorer

A skill for exploring and analyzing Tide Commander server logs to help debug issues, monitor activity, and understand system behavior.

## Log File Location

- **Main log file:** \`logs/server.log\` (relative to project root)
- **Rotated logs:** \`server.log.1\`, \`server.log.2\`, etc. (older logs)

## Log Format

Each log entry follows this format:
\`\`\`
[Tide] PID  - MM/DD/YYYY HH:MM:SS AM/PM    LEVEL [Context] file.ts:line Message
\`\`\`

Components:
- \`[Tide]\` - Application identifier
- \`PID\` - Process ID
- Timestamp - When the log was written
- \`LEVEL\` - One of: LOG, ERROR, WARN, DEBUG, VERBOSE
- \`[Context]\` - Logger context (Server, HTTP, WebSocket, Claude, Agent, etc.)
- \`file.ts:line\` - Source file and line number
- Message - The actual log content

## Common Tasks

### View Recent Logs
\`\`\`bash
tail -n 50 logs/server.log
\`\`\`

### View Logs in Real-Time (if server is running)
\`\`\`bash
tail -f logs/server.log
\`\`\`

### Search for Errors
\`\`\`bash
grep "ERROR" logs/server.log
\`\`\`

### Search for Specific Context
\`\`\`bash
grep "\\[WebSocket\\]" logs/server.log
grep "\\[Claude\\]" logs/server.log
grep "\\[Agent\\]" logs/server.log
\`\`\`

### Search for Warnings
\`\`\`bash
grep "WARN" logs/server.log
\`\`\`

### Count Log Entries by Level
\`\`\`bash
grep -c "ERROR" logs/server.log
grep -c "WARN" logs/server.log
\`\`\`

### View Log File Size
\`\`\`bash
ls -lh logs/
\`\`\`

### View Logs Around a Specific Time
Use grep with a date pattern:
\`\`\`bash
grep "01/22/2026" logs/server.log | tail -100
\`\`\`

### View Server Startup/Shutdown Events
\`\`\`bash
grep -E "Server started|Server shutting|Server running" logs/server.log
\`\`\`

## Log Contexts Reference

| Context | Description |
|---------|-------------|
| \`[Server]\` | Main server lifecycle events |
| \`[HTTP]\` | HTTP request/response logging |
| \`[WebSocket]\` | WebSocket connections and messages |
| \`[Claude]\` | Claude API interactions |
| \`[Agent]\` | Agent lifecycle and operations |
| \`[Files]\` | File system operations |
| \`[Supervisor]\` | Supervisor service events |
| \`[Boss]\` | Boss agent hierarchy events |

## Best Practices

1. **Start with recent logs** - Use \`tail -n 100\` first to see recent activity
2. **Filter by context** - If investigating a specific component, filter by its context
3. **Look for ERROR first** - Errors often indicate the root cause
4. **Check timestamps** - Match log times with when the issue occurred
5. **Check rotated logs** - If the issue was earlier, check \`server.log.1\`, etc.

## Example Investigation Flow

1. Check if there are any recent errors:
   \`\`\`bash
   grep "ERROR" logs/server.log | tail -20
   \`\`\`

2. Get context around an error (5 lines before and after):
   \`\`\`bash
   grep -B5 -A5 "ERROR" logs/server.log | tail -50
   \`\`\`

3. Check for warnings that might be related:
   \`\`\`bash
   grep "WARN" logs/server.log | tail -20
   \`\`\`

4. View the most recent server activity:
   \`\`\`bash
   tail -n 100 logs/server.log
   \`\`\``,
};
