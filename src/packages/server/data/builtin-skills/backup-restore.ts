import type { BuiltinSkillDefinition } from './types.js';

export const backupRestore: BuiltinSkillDefinition = {
  slug: 'backup-restore',
  name: 'Backup & Restore',
  description: 'Use this skill to list, inspect, or restore Tide Commander data backups. Covers reviewing available backup snapshots, comparing them, and restoring specific config files or the full data directory from a backup.',
  allowedTools: ['Bash(ls:*)', 'Bash(tar:*)', 'Bash(cp:*)', 'Bash(mv:*)', 'Bash(mkdir:*)', 'Bash(sqlite3:*)', 'Bash(sha256sum:*)', 'Bash(diff:*)', 'Bash(date:*)', 'Bash(stat:*)', 'Bash(bash:*)', 'Bash(curl:*)', 'Read', 'Grep', 'Glob'],
  content: `# Backup & Restore

Tide Commander backs up its data directory hourly via an in-process scheduler (no cron or external deps). It runs \`scripts/backup-data.sh\`, which stages all top-level JSON configs and safely copies the SQLite database using \`sqlite3 .backup\`. A content signature (sha256, 16 chars) is computed from the staged files; if a backup with the same signature already exists the run is skipped (no duplicates for unchanged data). Backups are compressed tarballs named \`backup-<YYYYMMDDThhmmss>-<signature>.tar.gz\`.

**Rotation:** the 8 newest hourly backups are kept, plus the most recent backup from each of the 2 most recent prior days that have backups — up to ~10 total.

## Key Paths

| Item | Path |
|------|------|
| Live data directory | \`~/.local/share/tide-commander/\` |
| Backup directory | \`~/.local/share/tide-commander-backups/\` |
| Backup script | \`scripts/backup-data.sh\` (relative to project root) |
| Backup log | \`~/.local/share/tide-commander-backups/backup.log\` |
| Scheduler settings | \`~/.local/share/tide-commander/backup-settings.json\` |

## What Is Backed Up

All top-level files in the data directory: \`agents.json\` (agent configs, positions, session IDs), \`skills.json\`, \`triggers.json\`, \`workflow-definitions.json\`, \`buildings.json\`, \`secrets.json\` (encrypted API keys, AES-256-GCM), \`custom-agent-classes.json\`, \`delegation-history.json\`, \`areas.json\`, \`slack-config.json\`, \`calendar-config.json\`, \`drive-config.json\`, \`system-prompt.json\`, \`session-history.json\`, \`running-processes.json\`, \`events.db\` (SQLite event store: trigger events, audit log, workflow instances, etc.), and \`*.json.bak\` atomic-write backup copies.

Subdirectories (\`query-history/\`, \`generated/\`, \`snapshots/\`, \`templates/\`) are **not** included (considered derivable).

## Scheduler API

\`\`\`bash
# Status — returns enabled, running, scriptPath, scriptExists, backupDir, lastRunAt, lastRunOk, lastRunError
curl -s http://localhost:5174/api/agents/system-settings/backup | python3 -m json.tool

# Enable / disable
curl -s -X POST -H "Content-Type: application/json" http://localhost:5174/api/agents/system-settings/backup -d '{"enabled":true}'   # or {"enabled":false}
\`\`\`

Manual backup now: \`bash scripts/backup-data.sh\` from the project root (same relative path for compiled installs).

## Inspect Backups

\`\`\`bash
# List — filenames sort chronologically; identical signature suffix = identical content
ls -lhtr ~/.local/share/tide-commander-backups/backup-*.tar.gz

# List contents of one backup
tar -tzf ~/.local/share/tide-commander-backups/backup-<TIMESTAMP>-<SIG>.tar.gz

# Extract to a temp dir for review
REVIEW_DIR=$(mktemp -d)
tar -xzf ~/.local/share/tide-commander-backups/backup-<TIMESTAMP>-<SIG>.tar.gz -C "$REVIEW_DIR"
cat "$REVIEW_DIR/agents.json" | python3 -m json.tool | head -60
diff <(python3 -m json.tool "$REVIEW_DIR/agents.json") <(python3 -m json.tool ~/.local/share/tide-commander/agents.json)

# Compare two backups: extract each to its own mktemp dir, then
diff -rq "$DIR_A" "$DIR_B"

# Query the SQLite database from a backup
sqlite3 "$REVIEW_DIR/events.db" ".tables"
sqlite3 "$REVIEW_DIR/events.db" "SELECT COUNT(*) FROM workflow_instances;"
\`\`\`

## Restore Procedures

Safety rules: (1) always stop Commander before restoring to avoid write conflicts; (2) back up the current live state before overwriting anything; (3) prefer selective single-file restore over full restore; (4) never restore \`running-processes.json\` — it tracks ephemeral PIDs that won't be valid after restart.

### Restore a single JSON config file (safest)

\`\`\`bash
tar -xzf ~/.local/share/tide-commander-backups/backup-<TIMESTAMP>-<SIG>.tar.gz -C /tmp ./agents.json
cp ~/.local/share/tide-commander/agents.json ~/.local/share/tide-commander/agents.json.pre-restore
cp /tmp/agents.json ~/.local/share/tide-commander/agents.json
# Restart Commander to pick up the change. Substitute any config file for agents.json.
\`\`\`

### Restore the full data directory

\`\`\`bash
# Stop Commander first
mv ~/.local/share/tide-commander ~/.local/share/tide-commander-broken-$(date +%Y%m%d)   # keep even broken state
mkdir -p ~/.local/share/tide-commander
tar -xzf ~/.local/share/tide-commander-backups/backup-<TIMESTAMP>-<SIG>.tar.gz -C ~/.local/share/tide-commander
rm -f ~/.local/share/tide-commander/running-processes.json ~/.local/share/tide-commander/running-processes.json.bak   # stale PIDs
rm -f ~/.local/share/tide-commander/*.json.bak   # recreated on first write
# Start Commander
\`\`\`

### Restore only the SQLite event database

\`\`\`bash
tar -xzf ~/.local/share/tide-commander-backups/backup-<TIMESTAMP>-<SIG>.tar.gz -C /tmp ./events.db
cp ~/.local/share/tide-commander/events.db ~/.local/share/tide-commander/events.db.pre-restore
cp /tmp/events.db ~/.local/share/tide-commander/events.db   # Commander stopped, or at minimum idle
rm -f ~/.local/share/tide-commander/events.db-wal ~/.local/share/tide-commander/events.db-shm   # let SQLite start fresh
\`\`\`

## Troubleshooting

- **Backups not being created:** check scheduler status via the API; \`ls -la scripts/backup-data.sh\`; \`tail -20 ~/.local/share/tide-commander-backups/backup.log\`; run \`bash scripts/backup-data.sh\` manually to see errors; ensure \`which sqlite3\` succeeds.
- **All backups have the same signature:** data hasn't changed between runs — dedup working as intended; backups are only created when content changes.
- **Backup directory too large:** check with \`du -sh ~/.local/share/tide-commander-backups/\`. Rotation (8 hourly + 2 prior days) should keep it bounded; if backups are unusually large the SQLite DB likely grew — run \`sqlite3 ~/.local/share/tide-commander/events.db "VACUUM;"\` on the live database and the next backup picks up the smaller file.
`,
};
