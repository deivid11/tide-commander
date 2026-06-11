import type { BuiltinSkillDefinition } from './types.js';

export const pm2Logs: BuiltinSkillDefinition = {
  slug: 'pm2-logs',
  name: 'PM2 Logs Fetcher',
  description: 'Use this skill to fetch PM2 logs for buildings, search logs for errors and patterns, analyze process output, and debug issues. You can search by building name or PM2 process name.',
  allowedTools: ['Bash(pm2:*)', 'Read', 'Grep'],
  content: `# PM2 Logs Fetcher

Fetch and analyze PM2 logs for Tide Commander buildings by building name or PM2 process name.

## PM2 Naming Convention

- Pattern: \`tc-{sanitized-building-name}-{last-8-chars-of-id}\`; the \`tc-\` prefix marks all TC-managed processes.
- Example: building "Backend API" with ID "building-abc123def456" → \`tc-backend-api-def456\`
- Sanitization: lowercased; spaces → hyphens; only alphanumeric/dash/underscore kept; truncated to 50 chars max.

## Find Process and Fetch Logs

\`\`\`bash
pm2 list | grep -i "backend"   # search by partial building name (case-insensitive)
pm2 list | grep "tc-"          # list ALL TC processes
pm2 jlist 2>/dev/null | jq '.[] | select(.name | startswith("tc-")) | {name: .name, status: .pm2_env.status, pid: .pid}'

pm2 logs "tc-backend-api-def456" --nostream --lines 100   # default; use --lines 500 for investigation
\`\`\`

Other core commands: \`pm2 show "PROCESS_NAME"\` (detailed status), \`pm2 status\` (full table), \`pm2 logs "PROCESS_NAME"\` (real-time stream, Ctrl+C to stop), \`pm2 flush "PROCESS_NAME"\` (flush old logs).

## Search Patterns

Pipe \`pm2 logs "PROCESS_NAME" --nostream --lines 500\` (use 1000 for wider sweeps) through grep:

- Errors: \`grep -i "error"\`; broader: \`grep -iE "error|failed|exception|crash"\`; with context: \`grep -B5 -A5 -i "error"\`
- Warnings: \`grep -iE "warn|warning|deprecated"\`; errors+warnings: \`grep -iE "error|warn|fail"\`
- HTTP 4xx/5xx (lines 1000): \`grep -E " [45][0-9]{2} "\`; endpoint: \`grep -i "/api/endpoint"\`; timeouts: \`grep -iE "timeout|timed out|ETIMEDOUT"\`
- Database: \`grep -iE "database|db|connection|sql|query"\`; \`grep -iE "ECONNREFUSED|ECONNRESET|deadlock"\`
- Memory: \`grep -iE "memory|heap|out of memory|oom"\`; performance: \`grep -iE "slow|timeout|delay|latency"\`
- Auth: \`grep -iE "unauthorized|forbidden|401|403|auth|token"\`; security: \`grep -iE "security|blocked|denied|invalid"\`
- Critical / crashes (lines 1000, must investigate): \`grep -iE "uncaught|unhandled|fatal|segmentation|killed"\`; restarts: \`grep -iE "exit|restart|SIGTERM|SIGKILL"\`
- Stack traces: \`grep -E "^.*at .+\\(.+:[0-9]+:[0-9]+\\)"\`; full error context: \`grep -B2 -A15 "Error:"\`
- Line numbers: \`grep -in "error"\`; count occurrences (lines 1000): \`grep -ic "error"\`

## Investigation Workflows

### Debug recent crash
\`\`\`bash
pm2 show "PROCESS_NAME" | grep -E "status|restart"
pm2 logs "PROCESS_NAME" --nostream --lines 200
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -iE "exit|crash|uncaught|fatal"
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -B5 -A20 "Error:"
\`\`\`

### Investigate slow performance
\`\`\`bash
pm2 jlist 2>/dev/null | jq '.[] | select(.name == "PROCESS_NAME") | {cpu: .monit.cpu, memory: .monit.memory, restarts: .pm2_env.restart_time}'
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -iE "slow|timeout|delay|ms]"
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -iE "memory|heap|gc"
\`\`\`

### Trace a specific request
Grep \`--lines 1000\` for the request/correlation ID, user or session (e.g. \`grep -i "user@example.com"\`), or endpoint (e.g. \`grep "/api/users/123"\`).

### Compare multiple processes
\`\`\`bash
echo "=== Backend API ===" && pm2 logs "tc-backend-api-xxx" --nostream --lines 500 | grep -c -i "error"
\`\`\`
Repeat per building to compare error counts.

## Process Status and Health

\`\`\`bash
pm2 jlist 2>/dev/null | jq '.[] | select(.name | startswith("tc-")) | {
  name: .name,
  status: .pm2_env.status,
  pid: .pid,
  cpu: .monit.cpu,
  memory: (.monit.memory / 1024 / 1024 | floor | tostring + " MB"),
  uptime_hrs: ((now - .pm2_env.pm_uptime / 1000) / 3600 | floor),
  restarts: .pm2_env.restart_time
}'
\`\`\`

| Field | Description | Warning threshold |
|-------|-------------|-------------------|
| \`status\` | online, stopped, errored | not "online" |
| \`cpu\` | CPU percentage | > 80% sustained |
| \`memory\` | memory in bytes | > 512MB typical |
| \`restart_time\` | number of restarts | > 5 indicates instability |
| \`pm_uptime\` | start timestamp | recent = crash/restart |

## Raw Log Files

If \`pm2 logs\` is slow or you need older logs:
\`\`\`bash
ls -la ~/.pm2/logs/
tail -100 ~/.pm2/logs/tc-process-name-out.log     # stdout
tail -100 ~/.pm2/logs/tc-process-name-error.log   # stderr
grep -i "error" ~/.pm2/logs/tc-process-name-*.log
\`\`\`

## ANSI Color Handling

Strip color codes with \`| sed 's/\\x1b\\[[0-9;]*m//g'\`; append \`> clean_logs.txt\` to save clean logs to a file.

## Troubleshooting

- **Process not found**: \`pm2 list\`, \`pm2 list | grep -i "partial-name"\`, or \`pm2 jlist 2>/dev/null | jq -r '.[] | select(.name | startswith("tc-")) | .name'\`. Common causes: building doesn't have PM2 enabled, hasn't been started yet, or process name differs from expected.
- **No logs available**: check \`pm2 show "PROCESS_NAME"\` (was it ever started?); then \`pm2 flush "PROCESS_NAME"\` and \`pm2 restart "PROCESS_NAME"\`.
- **Very large logs**: check sizes with \`ls -lh ~/.pm2/logs/\`; paginate with \`| less\`; or fetch only \`--lines 100\`.

## Best Practices

Check process status before log diving; start with \`--lines 100\` and increase as needed; grep-filter before reading everything; count matches with \`grep -c\` first; use \`-B5 -A5\` for context around errors; redirect to a file for complex investigations; strip ANSI codes for cleaner parsing.`,
};
