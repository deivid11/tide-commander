#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

RUNNER_SRC="${REPO_ROOT}/scripts/krunner/tide-krunner-runner.js"
SERVICE_SRC="${REPO_ROOT}/scripts/krunner/org.riven.tide.krunner.service"
DESKTOP_SRC="${REPO_ROOT}/scripts/krunner/plasma-runner-tide-commander.desktop"

BIN_DIR="${HOME}/.local/bin"
DBUS_DIR="${HOME}/.local/share/dbus-1/services"
KRUNNER_DIR="${HOME}/.local/share/krunner/dbusplugins"

RUNNER_DST="${BIN_DIR}/tide-krunner-runner"
SERVICE_DST="${DBUS_DIR}/org.riven.tide.krunner.service"
DESKTOP_DST="${KRUNNER_DIR}/plasma-runner-tide-commander.desktop"

mkdir -p "${BIN_DIR}" "${DBUS_DIR}" "${KRUNNER_DIR}"

install -m 0755 "${RUNNER_SRC}" "${RUNNER_DST}"
install -m 0644 "${SERVICE_SRC}" "${SERVICE_DST}"
install -m 0644 "${DESKTOP_SRC}" "${DESKTOP_DST}"

# Ensure ${HOME} in Exec is expanded when installed.
sed -i "s#\\\${HOME}#${HOME}#g" "${SERVICE_DST}"

echo "Installed:"
echo "  ${RUNNER_DST}"
echo "  ${SERVICE_DST}"
echo "  ${DESKTOP_DST}"

echo "Reloading DBus user config..."
dbus-send --session --dest=org.freedesktop.DBus --type=method_call --print-reply \
  /org/freedesktop/DBus org.freedesktop.DBus.ReloadConfig >/dev/null 2>&1 || true

echo "Stopping existing Tide runner process..."
if pgrep -f "${RUNNER_DST}" >/dev/null 2>&1; then
  pgrep -f "${RUNNER_DST}" | xargs -r kill
  sleep 0.2
fi

echo "Restarting KRunner..."
kquitapp6 krunner >/dev/null 2>&1 || true
nohup krunner >/dev/null 2>&1 &
sleep 1

echo
echo "Done. Test with:"
echo "  1) Open KRunner (Alt+Space)"
echo "  2) Type: tc <agent or area name>"
echo
echo "Direct API check:"
echo "  curl -s -X POST http://localhost:5174/api/focus-agent -H 'Content-Type: application/json' -d '{\"agentId\":\"g3d1jvlr\",\"openTerminal\":true}'"
