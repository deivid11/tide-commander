#!/bin/bash
# Tide Commander Alfred Script Filter
# Searches agents and returns Alfred JSON format

QUERY="${1:-}"
API_BASE="${TIDE_API_BASE:-http://localhost:5174/api}"
AUTH_ARGS=()
if [ -n "$TIDE_AUTH_TOKEN" ]; then
  AUTH_ARGS=(-H "X-Auth-Token: $TIDE_AUTH_TOKEN")
fi

# Fetch agents and areas from the API, capturing HTTP status code
AGENTS_RESPONSE=$(curl -sS --max-time 0.8 -w "\n%{http_code}" -H "Accept: application/json" "${AUTH_ARGS[@]}" "$API_BASE/agents" 2>&1)
AGENTS_HTTP_CODE=$(echo "$AGENTS_RESPONSE" | tail -1)
AGENTS=$(echo "$AGENTS_RESPONSE" | sed '$d')

AREAS_RESPONSE=$(curl -sS --max-time 0.8 -w "\n%{http_code}" -H "Accept: application/json" "${AUTH_ARGS[@]}" "$API_BASE/areas" 2>&1)
AREAS=$(echo "$AREAS_RESPONSE" | sed '$d')

# Handle HTTP errors
if [ "$AGENTS_HTTP_CODE" = "000" ] || [ -z "$AGENTS_HTTP_CODE" ]; then
  cat <<'EMPTY'
{"items":[{"title":"Tide Commander not reachable","subtitle":"Check that the server is running on the configured port","valid":false,"icon":{"path":"icon.png"}}]}
EMPTY
  exit 0
fi

if [ "$AGENTS_HTTP_CODE" != "200" ]; then
  # Try to extract error message from response body
  ERROR_MSG=$(echo "$AGENTS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error','') or d.get('message',''))" 2>/dev/null)
  if [ -z "$ERROR_MSG" ]; then
    ERROR_MSG="$AGENTS"
  fi
  cat <<EOF
{"items":[{"title":"HTTP $AGENTS_HTTP_CODE error","subtitle":"$ERROR_MSG","valid":false,"icon":{"path":"icon.png"}}]}
EOF
  exit 0
fi

if [ -z "$AGENTS" ] || [ "$AGENTS" = "null" ]; then
  cat <<'EMPTY'
{"items":[{"title":"No agents found","subtitle":"Server returned empty response","valid":false,"icon":{"path":"icon.png"}}]}
EMPTY
  exit 0
fi

# Use python3 (available on macOS) to process JSON and produce Alfred results
python3 - "$QUERY" "$AGENTS" "$AREAS" <<'PYEOF'
import sys
import json

query = sys.argv[1].lower().strip()
try:
    agents = json.loads(sys.argv[2])
except (json.JSONDecodeError, IndexError):
    agents = []
try:
    areas = json.loads(sys.argv[3])
except (json.JSONDecodeError, IndexError):
    areas = []

if not isinstance(agents, list):
    agents = []
if not isinstance(areas, list):
    areas = []

# Build agent-to-area mapping
agent_area_map = {}
for area in areas:
    area_name = area.get("name", "Unknown area")
    for aid in area.get("assignedAgentIds", []):
        agent_area_map[aid] = area_name

items = []
for agent in agents:
    agent_id = agent.get("id", "")
    name = agent.get("name", agent_id)
    agent_class = agent.get("class", "agent")
    status = agent.get("status", "unknown")
    area = agent_area_map.get(agent_id, "No area")
    last_activity = agent.get("lastActivity", 0) or 0
    task_label = agent.get("taskLabel", "")

    # Search filtering
    if query:
        haystack = f"{name} {agent_id} {agent_class} {area} {status} {task_label}".lower()
        if query not in haystack:
            continue

    subtitle_parts = [agent_class, status, area]
    if task_label:
        subtitle_parts.append(task_label)
    subtitle = " \u2022 ".join(subtitle_parts)

    is_active = 1 if status in ("working", "waiting", "waiting_permission", "orphaned") else 0

    items.append({
        "uid": agent_id,
        "title": name,
        "subtitle": subtitle,
        "arg": agent_id,
        "autocomplete": name,
        "icon": {"path": "icon.png"},
        "text": {
            "copy": agent_id,
            "largetype": f"{name}\n{subtitle}"
        },
        "mods": {
            "cmd": {
                "subtitle": f"Copy agent ID: {agent_id}",
                "arg": agent_id
            }
        },
        "_sort_active": is_active,
        "_sort_activity": last_activity,
        "_sort_name": name.lower()
    })

# Sort: active first, then by last activity (most recent first), then by name
items.sort(key=lambda x: (-x["_sort_active"], -x["_sort_activity"], x["_sort_name"]))

# Remove internal sort keys and limit results
for item in items:
    del item["_sort_active"]
    del item["_sort_activity"]
    del item["_sort_name"]

result = {"items": items[:12]}
print(json.dumps(result))
PYEOF
