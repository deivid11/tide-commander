#!/usr/bin/env bash
# Tide Commander data backup script.
#
# - Backs up ~/.local/share/tide-commander (SQLite + JSON configs).
# - Uses sqlite3 .backup to avoid corruption from concurrent writes.
# - Names backups with a content signature so unchanged state does not
#   create a new copy.
# - Rotation: keeps the 8 newest hourly backups, plus the most recent
#   backup from each of the 2 most recent prior days.

set -euo pipefail

DATA_DIR="${TIDE_COMMANDER_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/tide-commander}"
BACKUP_DIR="${TIDE_COMMANDER_BACKUP_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/tide-commander-backups}"
HOURLY_KEEP=8
PRIOR_DAYS_KEEP=2

log() { printf '[tide-backup %s] %s\n' "$(date -Iseconds)" "$*"; }

if [[ ! -d "$DATA_DIR" ]]; then
  log "data dir not found: $DATA_DIR (nothing to back up)"
  exit 0
fi

mkdir -p "$BACKUP_DIR"

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

# Stage JSON / text config files (top-level only; subdirs like query-history
# and generated are considered derivable and skipped to keep backups small).
shopt -s nullglob
for f in "$DATA_DIR"/*.json "$DATA_DIR"/*.json.bak; do
  [[ -f "$f" ]] && cp -p "$f" "$STAGE_DIR/"
done
shopt -u nullglob

# Safe SQLite backup. Requires sqlite3 on PATH; if missing, fall back to a
# plain copy of the main db file.
if [[ -f "$DATA_DIR/events.db" ]]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DATA_DIR/events.db" ".backup '$STAGE_DIR/events.db'"
  else
    log "sqlite3 not found, using plain copy (may be inconsistent if written during copy)"
    cp -p "$DATA_DIR/events.db" "$STAGE_DIR/events.db"
  fi
fi

# Compute signature: deterministic hash of staged file contents + names.
# (Mtimes intentionally excluded so identical content skips new backup.)
SIGNATURE=$(
  cd "$STAGE_DIR" && \
  find . -type f -print0 | LC_ALL=C sort -z | \
  xargs -0 sha256sum | sha256sum | cut -c1-16
)

# Skip if a backup with this signature already exists.
if compgen -G "$BACKUP_DIR/backup-*-$SIGNATURE.tar.gz" >/dev/null; then
  log "no changes since last backup (sig=$SIGNATURE), skipping"
  exit 0
fi

TS="$(date +%Y%m%dT%H%M%S)"
OUT="$BACKUP_DIR/backup-${TS}-${SIGNATURE}.tar.gz"
tar -C "$STAGE_DIR" -czf "$OUT" .
log "created $OUT"

# Rotation: files are named backup-YYYYMMDDThhmmss-<sig>.tar.gz, which sorts
# correctly lexicographically (newest last when sorted ascending).
rotate() {
  local today
  today="$(date +%Y%m%d)"

  mapfile -t files < <(ls -1 "$BACKUP_DIR"/backup-*.tar.gz 2>/dev/null | sort -r) || return 0
  [[ ${#files[@]} -eq 0 ]] && return 0

  declare -A keep=()

  # Keep newest $HOURLY_KEEP regardless of day.
  local i=0
  for f in "${files[@]}"; do
    if (( i < HOURLY_KEEP )); then
      keep["$f"]=1
      i=$((i + 1))
    else
      break
    fi
  done

  # Keep the newest backup from each of the most recent prior days.
  declare -A seen_days=()
  local prior=0
  for f in "${files[@]}"; do
    local name day
    name="$(basename "$f")"
    # Strip "backup-" (7 chars), take the next 8 (YYYYMMDD).
    day="${name:7:8}"
    [[ "$day" == "$today" ]] && continue
    [[ -n "${seen_days[$day]:-}" ]] && continue
    seen_days["$day"]=1
    keep["$f"]=1
    prior=$((prior + 1))
    (( prior >= PRIOR_DAYS_KEEP )) && break
  done

  for f in "${files[@]}"; do
    if [[ -z "${keep[$f]:-}" ]]; then
      rm -f "$f"
      log "rotated out $(basename "$f")"
    fi
  done
}

rotate

log "done (kept $(ls -1 "$BACKUP_DIR"/backup-*.tar.gz 2>/dev/null | wc -l) backup(s))"
