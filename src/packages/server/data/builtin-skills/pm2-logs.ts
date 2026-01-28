import type { BuiltinSkillDefinition } from './types.js';

export const pm2Logs: BuiltinSkillDefinition = {
  slug: 'pm2-logs',
  name: 'PM2 Logs Fetcher',
  description: 'Use this skill to fetch PM2 logs for buildings, search logs for errors and patterns, analyze process output, and debug issues. You can search by building name or PM2 process name.',
  allowedTools: ['Bash(pm2:*)', 'Read', 'Grep'],
  content: `# PM2 Logs Fetcher

A skill for fetching and analyzing PM2 process logs from Tide Commander buildings by building name or PM2 process name.

---

## Understanding the PM2 Integration

Tide Commander manages building processes via PM2 with these characteristics:

### PM2 Naming Convention

- **Pattern:** \`tc-{sanitized-building-name}-{last-8-chars-of-id}\`
- **Example:** Building "Backend API" with ID "building-abc123def456" → \`tc-backend-api-def456\`
- **Prefix:** \`tc-\` identifies all Tide Commander managed processes

### Sanitization Rules
- Building names are lowercased
- Spaces become hyphens
- Special characters removed (only alphanumeric, dash, underscore kept)
- Name truncated to 50 chars max

---

## Quick Start: Find Building Logs

### Step 1: Find the Process by Building Name

\`\`\`bash
# Search for a building by partial name (case-insensitive)
pm2 list | grep -i "backend"

# List ALL Tide Commander processes
pm2 list | grep "tc-"

# Get JSON list with details
pm2 jlist 2>/dev/null | jq '.[] | select(.name | startswith("tc-")) | {name: .name, status: .pm2_env.status, pid: .pid}'
\`\`\`

### Step 2: Fetch Logs

\`\`\`bash
# Get last 100 lines (default)
pm2 logs "tc-backend-api-def456" --nostream --lines 100

# Get more lines for investigation
pm2 logs "tc-backend-api-def456" --nostream --lines 500
\`\`\`

---

## Core Commands Reference

| Task | Command |
|------|---------|
| List all TC processes | \`pm2 list | grep "tc-"\` |
| Find process by name | \`pm2 list | grep -i "search-term"\` |
| Fetch logs | \`pm2 logs "PROCESS_NAME" --nostream --lines 100\` |
| Process status | \`pm2 show "PROCESS_NAME"\` |
| JSON status | \`pm2 jlist | jq '.[] | select(.name|startswith("tc-"))'\` |
| Real-time stream | \`pm2 logs "PROCESS_NAME"\` (Ctrl+C to stop) |
| Flush old logs | \`pm2 flush "PROCESS_NAME"\` |

---

## Log Filtering and Search

### Finding Errors

\`\`\`bash
# Get all error lines
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -i "error"

# Multiple error patterns
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -iE "error|failed|exception|crash"

# With context (5 lines before and after)
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -B5 -A5 -i "error"
\`\`\`

### Finding Warnings

\`\`\`bash
# Warning patterns
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -iE "warn|warning|deprecated"

# Errors AND warnings together
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -iE "error|warn|fail"
\`\`\`

### HTTP/API Issues

\`\`\`bash
# HTTP status codes (4xx/5xx errors)
pm2 logs "PROCESS_NAME" --nostream --lines 1000 | grep -E " [45][0-9]{2} "

# Specific endpoints
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -i "/api/endpoint"

# Request timeouts
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -iE "timeout|timed out|ETIMEDOUT"
\`\`\`

### Database Issues

\`\`\`bash
# Database connection problems
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -iE "database|db|connection|sql|query"

# Specific errors
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -iE "ECONNREFUSED|ECONNRESET|deadlock"
\`\`\`

### Memory and Performance

\`\`\`bash
# Memory issues
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -iE "memory|heap|out of memory|oom"

# Performance warnings
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -iE "slow|timeout|delay|latency"
\`\`\`

### Authentication/Security

\`\`\`bash
# Auth failures
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -iE "unauthorized|forbidden|401|403|auth|token"

# Security events
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -iE "security|blocked|denied|invalid"
\`\`\`

---

## Important Search Patterns

### Critical Errors (Must Investigate)

\`\`\`bash
# Unhandled exceptions and crashes
pm2 logs "PROCESS_NAME" --nostream --lines 1000 | grep -iE "uncaught|unhandled|fatal|segmentation|killed"

# Process restarts
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -iE "exit|restart|SIGTERM|SIGKILL"
\`\`\`

### Stack Traces

\`\`\`bash
# Find stack traces (lines starting with "at ")
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -E "^.*at .+\\(.+:[0-9]+:[0-9]+\\)"

# Get full context around errors
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -B2 -A15 "Error:"
\`\`\`

### Line Numbers and Count

\`\`\`bash
# Show line numbers for matching lines
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -in "error"

# Count occurrences
pm2 logs "PROCESS_NAME" --nostream --lines 1000 | grep -ic "error"
\`\`\`

---

## Investigation Workflows

### Workflow 1: Debug Recent Crash

\`\`\`bash
# 1. Check if process is running
pm2 show "PROCESS_NAME" | grep -E "status|restart"

# 2. Get recent logs
pm2 logs "PROCESS_NAME" --nostream --lines 200

# 3. Find crash-related entries
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -iE "exit|crash|uncaught|fatal"

# 4. Get stack trace context
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -B5 -A20 "Error:"
\`\`\`

### Workflow 2: Investigate Slow Performance

\`\`\`bash
# 1. Check current resource usage
pm2 jlist 2>/dev/null | jq '.[] | select(.name == "PROCESS_NAME") | {cpu: .monit.cpu, memory: .monit.memory, restarts: .pm2_env.restart_time}'

# 2. Find timeout/slow logs
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -iE "slow|timeout|delay|ms]"

# 3. Check for memory issues
pm2 logs "PROCESS_NAME" --nostream --lines 500 | grep -iE "memory|heap|gc"
\`\`\`

### Workflow 3: Trace a Specific Request

\`\`\`bash
# 1. Search by request ID or correlation ID
pm2 logs "PROCESS_NAME" --nostream --lines 1000 | grep "REQUEST_ID"

# 2. Search by user or session
pm2 logs "PROCESS_NAME" --nostream --lines 1000 | grep -i "user@example.com"

# 3. Search by endpoint
pm2 logs "PROCESS_NAME" --nostream --lines 1000 | grep "/api/users/123"
\`\`\`

### Workflow 4: Compare Multiple Processes

\`\`\`bash
# Get error counts from multiple buildings
echo "=== Backend API ===" && pm2 logs "tc-backend-api-xxx" --nostream --lines 500 | grep -c -i "error"
echo "=== Frontend ===" && pm2 logs "tc-frontend-xxx" --nostream --lines 500 | grep -c -i "error"
echo "=== Worker ===" && pm2 logs "tc-worker-xxx" --nostream --lines 500 | grep -c -i "error"
\`\`\`

---

## Process Status and Health

### Get Process Information

\`\`\`bash
# Full status table
pm2 status

# Detailed info for one process
pm2 show "PROCESS_NAME"

# JSON format (easier to parse)
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

### Health Check Fields

| Field | Description | Warning Threshold |
|-------|-------------|-------------------|
| \`status\` | online, stopped, errored | Not "online" |
| \`cpu\` | CPU percentage | > 80% sustained |
| \`memory\` | Memory in bytes | > 512MB typical |
| \`restart_time\` | Number of restarts | > 5 indicates instability |
| \`pm_uptime\` | Start timestamp | Recent = crash/restart |

---

## Raw Log Files

If PM2 logs command is slow or you need older logs:

\`\`\`bash
# Log files location
ls -la ~/.pm2/logs/

# Read stdout log directly
tail -100 ~/.pm2/logs/tc-process-name-out.log

# Read stderr log directly
tail -100 ~/.pm2/logs/tc-process-name-error.log

# Search in log files
grep -i "error" ~/.pm2/logs/tc-process-name-*.log
\`\`\`

---

## ANSI Color Handling

PM2 logs contain ANSI color codes. To strip them:

\`\`\`bash
# Remove ANSI codes for clean text
pm2 logs "PROCESS_NAME" --nostream --lines 100 | sed 's/\\x1b\\[[0-9;]*m//g'

# Save clean logs to file
pm2 logs "PROCESS_NAME" --nostream --lines 500 | sed 's/\\x1b\\[[0-9;]*m//g' > clean_logs.txt
\`\`\`

---

## Troubleshooting

### Process Not Found

\`\`\`bash
# List all processes
pm2 list

# Search with pattern
pm2 list | grep -i "partial-name"

# Check if TC processes exist
pm2 jlist 2>/dev/null | jq -r '.[] | select(.name | startswith("tc-")) | .name'
\`\`\`

**Common causes:**
- Building doesn't have PM2 enabled
- Building hasn't been started yet
- Process name is different than expected

### No Logs Available

\`\`\`bash
# Check process was ever started
pm2 show "PROCESS_NAME"

# Flush and restart
pm2 flush "PROCESS_NAME"
pm2 restart "PROCESS_NAME"
\`\`\`

### Very Large Logs

\`\`\`bash
# Check log file sizes
ls -lh ~/.pm2/logs/

# Paginate through logs
pm2 logs "PROCESS_NAME" --nostream --lines 500 | less

# Get only tail end
pm2 logs "PROCESS_NAME" --nostream --lines 100
\`\`\`

---

## Best Practices

1. **Start small** - Begin with \`--lines 100\`, increase if needed
2. **Filter first** - Use grep to find relevant entries before reading everything
3. **Check status first** - Know if process is running/errored before log diving
4. **Use context** - \`-B5 -A5\` flags show surrounding lines for errors
5. **Count first** - Use \`grep -c\` to count matches before viewing all
6. **Save for analysis** - Redirect to file for complex investigations
7. **Strip colors** - Use sed to remove ANSI codes for cleaner parsing`,
};
