#!/bin/bash
# Tide Commander - Hook Installation Script
# Installs Claude Code hooks for event capture

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="${SCRIPT_DIR}/tide-hook.sh"
CLAUDE_SETTINGS_DIR="${HOME}/.claude"
CLAUDE_SETTINGS_FILE="${CLAUDE_SETTINGS_DIR}/settings.json"
TIDE_HOOKS_DIR="${HOME}/.tide-commander/hooks"

echo "🌊 Tide Commander - Hook Installation"
echo "======================================"

# Ensure Claude settings directory exists
mkdir -p "${CLAUDE_SETTINGS_DIR}"
mkdir -p "${TIDE_HOOKS_DIR}"

# Copy hook script to permanent location
cp "${HOOK_SCRIPT}" "${TIDE_HOOKS_DIR}/tide-hook.sh"
chmod +x "${TIDE_HOOKS_DIR}/tide-hook.sh"

echo "✓ Hook script installed to ${TIDE_HOOKS_DIR}/tide-hook.sh"

# Create or update Claude settings
if [ -f "${CLAUDE_SETTINGS_FILE}" ]; then
  # Backup existing settings
  cp "${CLAUDE_SETTINGS_FILE}" "${CLAUDE_SETTINGS_FILE}.backup"
  echo "✓ Backed up existing settings to ${CLAUDE_SETTINGS_FILE}.backup"

  # Update settings with jq (new array-based format required since Claude Code 1.0.51+)
  UPDATED_SETTINGS=$(jq --arg hookPath "${TIDE_HOOKS_DIR}/tide-hook.sh" '
    .hooks = (.hooks // {}) |
    .hooks.PreToolUse = [{"hooks": [{"type": "command", "command": $hookPath}]}] |
    .hooks.PostToolUse = [{"hooks": [{"type": "command", "command": $hookPath}]}] |
    .hooks.Stop = [{"hooks": [{"type": "command", "command": $hookPath}]}] |
    .hooks.UserPromptSubmit = [{"hooks": [{"type": "command", "command": $hookPath}]}]
  ' "${CLAUDE_SETTINGS_FILE}")

  echo "$UPDATED_SETTINGS" > "${CLAUDE_SETTINGS_FILE}"
else
  # Create new settings file (new array-based format required since Claude Code 1.0.51+)
  cat > "${CLAUDE_SETTINGS_FILE}" << EOF
{
  "hooks": {
    "PreToolUse": [{"hooks": [{"type": "command", "command": "${TIDE_HOOKS_DIR}/tide-hook.sh"}]}],
    "PostToolUse": [{"hooks": [{"type": "command", "command": "${TIDE_HOOKS_DIR}/tide-hook.sh"}]}],
    "Stop": [{"hooks": [{"type": "command", "command": "${TIDE_HOOKS_DIR}/tide-hook.sh"}]}],
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "${TIDE_HOOKS_DIR}/tide-hook.sh"}]}]
  }
}
EOF
fi

echo "✓ Claude Code settings updated at ${CLAUDE_SETTINGS_FILE}"

# Create data directory
mkdir -p "${HOME}/.tide-commander"
echo "✓ Data directory created at ${HOME}/.tide-commander"

echo ""
echo "======================================"
echo "🎉 Installation complete!"
echo ""
echo "To start Tide Commander:"
echo "  cd $(dirname "${SCRIPT_DIR}")"
echo "  npm run dev"
echo ""
echo "Then open http://localhost:5173 in your browser (or your configured VITE_PORT)"
