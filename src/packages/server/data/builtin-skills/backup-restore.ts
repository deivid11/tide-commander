import type { BuiltinSkillDefinition } from './types.js';

export const backupRestore: BuiltinSkillDefinition = {
  slug: 'backup-restore',
  name: 'Backup & Restore',
  description: 'Use this skill to list, inspect, or restore Tide Commander data backups. Covers reviewing available backup snapshots, comparing them, and restoring specific config files or the full data directory from a backup.',
  allowedTools: ['Bash(ls:*)', 'Bash(tar:*)', 'Bash(cp:*)', 'Bash(mv:*)', 'Bash(mkdir:*)', 'Bash(sqlite3:*)', 'Bash(sha256sum:*)', 'Bash(diff:*)', 'Bash(date:*)', 'Bash(stat:*)', 'Bash(bash:*)', 'Bash(curl:*)', 'Read', 'Grep', 'Glob'],
  content: `# Backup & Restore

Tide Commander automatically backs up its data directory every hour using an in-process scheduler. This skill documents how backups work, where they live, and how to review or restore them.

## How Backups Work

- The scheduler runs inside the Commander node process (no cron or external deps).
- It calls \`scripts/backup-data.sh\` which stages all top-level JSON configs and safely copies the SQLite database using \`sqlite3 .backup\`.
- A **content signature** (sha256, 16 chars) is computed from the staged files. If a backup with the same signature already exists, the run is skipped (no duplicate backups for unchanged data).
- Backups are compressed tarballs named \`backup-<YYYYMMDDThhmmss>-<signature>.tar.gz\`.

## Rotation Policy

- The **8 newest** hourly backups are always kept.
- Plus the **most recent backup from each of the 2 most recent prior days** that have backups.
- Up to ~10 backups total.

## Key Paths

| Item | Path |
|------|------|
| Live data directory | \`~/.local/share/tide-commander/\` |
| Backup directory | \`~/.local/share/tide-commander-backups/\` |
| Backup script | \`scripts/backup-data.sh\` (relative to project root) |
| Backup log | \`~/.local/share/tide-commander-backups/backup.log\` |
| Scheduler settings | \`~/.local/share/tide-commander/backup-settings.json\` |

## What Is Backed Up

All top-level files in the data directory:

| File | Contents |
|------|----------|
| \`agents.json\` | Agent configurations, positions, session IDs |
| \`skills.json\` | Skill registry and assignments |
| \`triggers.json\` | Workflow trigger definitions |
| \`workflow-definitions.json\` | Workflow state machines |
| \`buildings.json\` | Database building configs |
| \`secrets.json\` | Encrypted API keys (AES-256-GCM) |
| \`custom-agent-classes.json\` | Custom agent class definitions |
| \`delegation-history.json\` | Boss agent delegation history |
| \`areas.json\` | Area/zone layouts |
| \`slack-config.json\` | Slack integration config |
| \`calendar-config.json\` | Google Calendar config |
| \`drive-config.json\` | Google Drive config |
| \`system-prompt.json\` | Global system prompt |
| \`session-history.json\` | Session history metadata |
| \`running-processes.json\` | Active process records |
| \`events.db\` | SQLite event store (trigger events, audit log, workflow instances, etc.) |
| \`*.json.bak\` | Atomic-write backup copies of each JSON file |

Subdirectories like \`query-history/\`, \`generated/\`, \`snapshots/\`, and \`templates/\` are **not** included (considered derivable).

## Common Tasks

### Check Backup Scheduler Status

\`\`\`bash
curl -s -H "X-Auth-Token: YOUR_TOKEN" http://localhost:5174/api/agents/system-settings/backup | python3 -m json.tool
\`\`\`

Returns: \`enabled\`, \`running\`, \`scriptPath\`, \`scriptExists\`, \`backupDir\`, \`lastRunAt\`, \`lastRunOk\`, \`lastRunError\`.

### Enable / Disable Backups

\`\`\`bash
# Enable
curl -s -X POST -H "Content-Type: application/json" -H "X-Auth-Token: YOUR_TOKEN" http://localhost:5174/api/agents/system-settings/backup -d '{"enabled":true}'

# Disable
curl -s -X POST -H "Content-Type: application/json" -H "X-Auth-Token: YOUR_TOKEN" http://localhost:5174/api/agents/system-settings/backup -d '{"enabled":false}'
\`\`\`

### Run a Manual Backup Now

\`\`\`bash
bash scripts/backup-data.sh
\`\`\`

Or from the project root if running a compiled install, the script is at the same relative path.

### List Available Backups

\`\`\`bash
ls -lhtr ~/.local/share/tide-commander-backups/backup-*.tar.gz
\`\`\`

Filenames sort chronologically. The signature suffix lets you see which backups have identical content.

### Inspect a Backup (List Contents)

\`\`\`bash
tar -tzf ~/.local/share/tide-commander-backups/backup-<TIMESTAMP>-<SIG>.tar.gz
\`\`\`

### Extract a Backup to a Temp Directory for Review

\`\`\`bash
REVIEW_DIR=$(mktemp -d)
tar -xzf ~/.local/share/tide-commander-backups/backup-<TIMESTAMP>-<SIG>.tar.gz -C "$REVIEW_DIR"
ls -la "$REVIEW_DIR"
\`\`\`

Then inspect individual files:
\`\`\`bash
# View agents config from the backup
cat "$REVIEW_DIR/agents.json" | python3 -m json.tool | head -60

# Compare a file between backup and live
diff <(python3 -m json.tool "$REVIEW_DIR/agents.json") <(python3 -m json.tool ~/.local/share/tide-commander/agents.json)
\`\`\`

### Compare Two Backups

\`\`\`bash
DIR_A=$(mktemp -d)
DIR_B=$(mktemp -d)
tar -xzf ~/.local/share/tide-commander-backups/backup-OLDER.tar.gz -C "$DIR_A"
tar -xzf ~/.local/share/tide-commander-backups/backup-NEWER.tar.gz -C "$DIR_B"
diff -rq "$DIR_A" "$DIR_B"
\`\`\`

### Query the SQLite Database from a Backup

\`\`\`bash
REVIEW_DIR=$(mktemp -d)
tar -xzf ~/.local/share/tide-commander-backups/backup-<TIMESTAMP>-<SIG>.tar.gz -C "$REVIEW_DIR"
sqlite3 "$REVIEW_DIR/events.db" ".tables"
sqlite3 "$REVIEW_DIR/events.db" "SELECT COUNT(*) FROM workflow_instances;"
\`\`\`

## Restore Procedures

### IMPORTANT: Safety Rules

1. **Always stop Commander before restoring** to avoid write conflicts.
2. **Back up the current live state first** before overwriting anything.
3. **Prefer selective restore** (single files) over full restore when possible.
4. **Never restore running-processes.json** — it tracks ephemeral PIDs that won't be valid after restart.

### Restore a Single JSON Config File

This is the safest approach. Use when one specific config got corrupted or lost.

\`\`\`bash
# 1. Pick the backup to restore from
ls -lhtr ~/.local/share/tide-commander-backups/backup-*.tar.gz

# 2. Extract just the file you need
tar -xzf ~/.local/share/tide-commander-backups/backup-<TIMESTAMP>-<SIG>.tar.gz -C /tmp ./agents.json

# 3. Back up the current live file
cp ~/.local/share/tide-commander/agents.json ~/.local/share/tide-commander/agents.json.pre-restore

# 4. Copy the restored file into place
cp /tmp/agents.json ~/.local/share/tide-commander/agents.json

# 5. Restart Commander to pick up the change
\`\`\`

Replace \`agents.json\` with whichever file you need to restore.

### Restore the Full Data Directory

Use when the entire data directory is corrupted or missing.

\`\`\`bash
# 1. Stop Commander first

# 2. Back up whatever is currently there (even if broken)
mv ~/.local/share/tide-commander ~/.local/share/tide-commander-broken-$(date +%Y%m%d)

# 3. Create fresh data directory
mkdir -p ~/.local/share/tide-commander

# 4. Pick the backup to restore from
ls -lhtr ~/.local/share/tide-commander-backups/backup-*.tar.gz

# 5. Extract the chosen backup into the data directory
tar -xzf ~/.local/share/tide-commander-backups/backup-<TIMESTAMP>-<SIG>.tar.gz -C ~/.local/share/tide-commander

# 6. Remove running-processes.json (stale PIDs)
rm -f ~/.local/share/tide-commander/running-processes.json
rm -f ~/.local/share/tide-commander/running-processes.json.bak

# 7. Remove .bak files (they'll be recreated on first write)
rm -f ~/.local/share/tide-commander/*.json.bak

# 8. Start Commander
\`\`\`

### Restore Only the SQLite Event Database

\`\`\`bash
# 1. Extract the database from the backup
tar -xzf ~/.local/share/tide-commander-backups/backup-<TIMESTAMP>-<SIG>.tar.gz -C /tmp ./events.db

# 2. Back up the current one
cp ~/.local/share/tide-commander/events.db ~/.local/share/tide-commander/events.db.pre-restore

# 3. Replace it (Commander should be stopped or at minimum idle)
cp /tmp/events.db ~/.local/share/tide-commander/events.db

# 4. Remove WAL files so SQLite starts fresh
rm -f ~/.local/share/tide-commander/events.db-wal
rm -f ~/.local/share/tide-commander/events.db-shm
\`\`\`

## Troubleshooting

### Backups Not Being Created

1. Check scheduler status via the API (see above).
2. Check if the script exists: \`ls -la scripts/backup-data.sh\`
3. Check the backup log: \`tail -20 ~/.local/share/tide-commander-backups/backup.log\`
4. Run the script manually to see errors: \`bash scripts/backup-data.sh\`
5. Ensure \`sqlite3\` is installed: \`which sqlite3\`

### All Backups Have the Same Signature

This means data hasn't changed between runs. This is expected behavior — the dedup is working correctly. Backups are only created when content actually changes.

### Backup Directory Growing Too Large

Check total size:
\`\`\`bash
du -sh ~/.local/share/tide-commander-backups/
\`\`\`

The rotation policy (8 hourly + 2 prior days) should keep it bounded. If backups are unusually large, the SQLite database may have grown. Consider running \`VACUUM\` on the live database:
\`\`\`bash
sqlite3 ~/.local/share/tide-commander/events.db "VACUUM;"
\`\`\`

Then the next backup will pick up the smaller database.
`,
};
