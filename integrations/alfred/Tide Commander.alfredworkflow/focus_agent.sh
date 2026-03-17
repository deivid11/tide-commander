#!/bin/bash
# Tide Commander Alfred Action
# Focuses the Tide Commander window and selects the given agent

AGENT_ID="${1:-}"
API_BASE="${TIDE_API_BASE:-http://localhost:5174/api}"
LOG="/tmp/tide-alfred-focus.log"
AUTH_ARGS=()
if [ -n "$TIDE_AUTH_TOKEN" ]; then
  AUTH_ARGS=(-H "X-Auth-Token: $TIDE_AUTH_TOKEN")
fi

echo "$(date): focus_agent called with arg='$AGENT_ID' API_BASE='$API_BASE'" >> "$LOG"

if [ -z "$AGENT_ID" ]; then
  echo "$(date): No agent ID, exiting" >> "$LOG"
  exit 0
fi

# Bring Tide Commander browser tab to front.
# Try Brave first (most common), then Chrome, then Firefox, Safari.
# Chromium-based browsers expose per-tab titles via AppleScript, so we can
# activate the exact tab instead of just the window.
BROWSER="${TIDE_BROWSER:-Brave Browser}"
osascript - "$BROWSER" 2>>"$LOG" <<'APPLESCRIPT'
on run argv
  set browserName to item 1 of argv
  set found to false
  try
    if application browserName is running then
      tell application browserName
        repeat with w in every window
          set tabIndex to 0
          repeat with t in every tab of w
            set tabIndex to tabIndex + 1
            if title of t contains "Tide Commander" or URL of t contains "tide-commander" or URL of t contains "localhost:5173" or URL of t contains "localhost:5174" then
              set active tab index of w to tabIndex
              set index of w to 1
              activate
              set found to true
              exit repeat
            end if
          end repeat
          if found then exit repeat
        end repeat
      end tell
    end if
  end try
  if not found then
    try
      tell application browserName to activate
    end try
  end if
end run
APPLESCRIPT

echo "$(date): AppleScript focus done, found=$?" >> "$LOG"

# Tell the API to focus the agent
RESPONSE=$(curl -sS --max-time 2 -w "\n%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  "${AUTH_ARGS[@]}" \
  -d "{\"agentId\":\"$AGENT_ID\",\"openTerminal\":true}" \
  "$API_BASE/focus-agent" 2>&1)

echo "$(date): API response: $RESPONSE" >> "$LOG"
