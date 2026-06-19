#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PM2="$HOME/.nvm/versions/node/v24.16.0/bin/pm2"

usage() {
  echo "Tide Commander - PM2 management"
  echo ""
  echo "Usage: ./pm2.sh <command>"
  echo ""
  echo "Commands:"
  echo "  setup     Build + start + save + configure system startup"
  echo "  start     Start tide-commander with pm2"
  echo "  stop      Stop tide-commander"
  echo "  restart   Restart tide-commander"
  echo "  status    Show pm2 process status"
  echo "  logs      Tail logs in real time"
  echo "  delete    Remove tide-commander from pm2"
}

cmd="${1:-}"

case "$cmd" in
  setup)
    echo "[1/4] Building..."
    npm run build
    echo "[2/4] Starting with pm2..."
    "$PM2" start ecosystem.config.cjs
    echo "[3/4] Saving pm2 state..."
    "$PM2" save
    echo "[4/4] Configuring system startup..."
    "$PM2" startup
    echo ""
    echo "Done. Copy and run the 'sudo env ...' command printed above to enable auto-start on reboot."
    ;;
  start)
    "$PM2" start ecosystem.config.cjs
    ;;
  stop)
    "$PM2" stop tide-commander
    ;;
  restart)
    "$PM2" restart tide-commander
    ;;
  status)
    "$PM2" status
    ;;
  logs)
    "$PM2" logs tide-commander
    ;;
  delete)
    "$PM2" delete tide-commander
    ;;
  *)
    usage
    exit 1
    ;;
esac
