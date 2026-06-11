import type { BuiltinSkillDefinition } from './types.js';

export const serverLogs: BuiltinSkillDefinition = {
  slug: 'server-logs',
  name: 'Server Logs Explorer',
  description: 'Use this skill when the user asks about server logs, backend errors, debugging server issues, checking what happened on the server, or monitoring server activity.',
  allowedTools: ['Bash(tail:*)', 'Bash(head:*)', 'Bash(wc:*)', 'Bash(ls:logs/*)', 'Read', 'Grep'],
  content: `# Server Logs Explorer

Explore Tide Commander server logs to debug issues and monitor activity.

## Location & Format

- Main log: \`logs/server.log\` (relative to project root); rotated older logs: \`server.log.1\`, \`server.log.2\`, ...
- Entry format (app tag, process id, timestamp, level, logger context, source file:line, message):
\`\`\`
[Tide] PID  - MM/DD/YYYY HH:MM:SS AM/PM    LEVEL [Context] file.ts:line Message
\`\`\`
- LEVEL is one of: LOG, ERROR, WARN, DEBUG, VERBOSE
- Contexts: \`[Server]\` main lifecycle, \`[HTTP]\` request/response, \`[WebSocket]\` connections and messages, \`[Claude]\` Claude API interactions, \`[Agent]\` agent lifecycle/operations, \`[Files]\` file system operations, \`[Boss]\` boss agent hierarchy events

## Commands

\`\`\`bash
tail -n 100 logs/server.log                        # recent activity (start here)
tail -f logs/server.log                            # real-time, if server is running
grep "ERROR" logs/server.log | tail -20            # recent errors — check first, often the root cause
grep -B5 -A5 "ERROR" logs/server.log | tail -50    # context around an error
grep "WARN" logs/server.log | tail -20             # possibly related warnings
grep "\\[WebSocket\\]" logs/server.log              # filter by context ([Claude], [Agent], ...)
grep -c "ERROR" logs/server.log                    # count entries by level (same for WARN, etc.)
ls -lh logs/                                       # log file sizes
grep "01/22/2026" logs/server.log | tail -100      # logs around a specific date/time
grep -E "Server started|Server shutting|Server running" logs/server.log   # startup/shutdown events
\`\`\`

Tips: match log timestamps with when the issue occurred; if it happened earlier, check the rotated logs (\`server.log.1\`, etc.).`,
};
