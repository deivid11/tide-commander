import type { BuiltinSkillDefinition } from './types.js';

const BT3 = '```';

export const conversationHistory: BuiltinSkillDefinition = {
  slug: 'conversation-history',
  name: 'Conversation History',
  description:
    'Retrieve recent Slack and WhatsApp conversation history from the local event store: list channels/chats, then pull a clean chronological transcript filtered by source, contact/channel/chat, limit, and time range.',
  allowedTools: ['Bash(curl:*)', 'Bash(jq:*)'],
  content: `# Conversation History Skill

Read-only access (SELECTs only — nothing is ever written or deleted) to recent **Slack** and **WhatsApp** history persisted in Tide Commander's local SQLite event store (\`~/.local/share/tide-commander/events.db\`, tables \`slack_messages\` and \`whatsapp_messages\`). Use for requests like *"what did X say on WhatsApp?"*, *"show the last messages in the soporte Slack channel"*, *"summarize today's chat with the OPM group"*.

All endpoints live under \`/api/events/\` and use the standard \`X-Auth-Token\` header.

## Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| \`/api/events/conversations/contacts\` | GET | List Slack channels + WhatsApp chats (id/name discovery) |
| \`/api/events/conversations\` | GET | Unified chronological transcript across Slack + WhatsApp |
| \`/api/events/slack\` | GET | Raw Slack messages (single source) |
| \`/api/events/whatsapp\` | GET | Raw WhatsApp messages (single source) |

### Query parameters for \`/api/events/conversations\`

| Param | Meaning |
|---|---|
| \`source\` | \`slack\` \\| \`whatsapp\` \\| \`both\` (default \`both\`) |
| \`contact\` | Filter by channel/chat/contact — exact id **or** partial name match (Slack channel_id/channel_name/user_name, WhatsApp chat_id/group_name/from_name) |
| \`limit\` | Max messages across both sources (default 50, capped 500) |
| \`since\` | Lower time bound — **epoch milliseconds**, inclusive |
| \`until\` | Upper time bound — **epoch milliseconds**, inclusive |
| \`agentId\` | Only messages handled by a specific agent |

The newest \`limit\` messages in range are selected, then returned **oldest → newest** (transcript-ready).

## Usage

${BT3}bash
# 1) Discover conversations (most-recently-active first; add ?source=whatsapp|slack to narrow).
#    Each summary: source, conversationId, conversationName, isGroup (WhatsApp), messageCount,
#    lastTimestamp (epoch ms), lastTime (ISO)
curl -s -H "X-Auth-Token: abcd" "http://localhost:5174/api/events/conversations/contacts?limit=30" | jq

# 2) Pull a transcript — both sources, or filter by source/contact (id or partial name)
curl -s -H "X-Auth-Token: abcd" "http://localhost:5174/api/events/conversations?limit=50" | jq
curl -s -H "X-Auth-Token: abcd" "http://localhost:5174/api/events/conversations?source=whatsapp&contact=OPM&limit=40" | jq '.messages'

# 3) Time-range filtering — since/until are epoch milliseconds (Unix seconds * 1000)
SINCE=$(( ($(date +%s) - 86400) * 1000 ))               # last 24h
UNTIL=$(( $(date -d '2026-05-27 23:59' +%s) * 1000 ))   # absolute bound via date -d
curl -s -H "X-Auth-Token: abcd" "http://localhost:5174/api/events/conversations?since=$SINCE&until=$UNTIL&limit=200" | jq '.messages'

# 4) Render a clean chronological transcript
curl -s -H "X-Auth-Token: abcd" "http://localhost:5174/api/events/conversations?contact=OPM&limit=40" \\
  | jq -r '.messages[] | "[\\(.time)] (\\(.source)/\\(.direction)) \\(.sender): \\(.text)"'
${BT3}

**Response shape:**
${BT3}json
{
  "source": "both",
  "count": 2,
  "messages": [
    {"source": "whatsapp", "id": 1234, "conversationId": "120363426536125334@g.us", "conversationName": "OPM Soporte", "isGroup": true, "sender": "Juan", "direction": "inbound", "text": "Buen día, hay un problema con el widget", "messageType": "text", "timestamp": 1780000000000, "time": "2026-05-28T15:00:00.000Z"},
    {"source": "slack", "id": 5678, "conversationId": "D0AU1SH1AV8", "conversationName": "soporte", "sender": "soporte_commander", "direction": "outbound", "text": "Ya lo estamos revisando", "timestamp": 1780000060000, "time": "2026-05-28T15:01:00.000Z"}
  ]
}
${BT3}

\`direction\` is \`inbound\` (received) or \`outbound\` (sent by us/an agent). Non-text WhatsApp items get a placeholder body like \`[image: photo.jpg]\`; audio transcriptions are appended as \`(transcription: ...)\`.

## Single-source raw endpoints

Raw rows with the full native field set, **newest-first**, returning \`{ messages, total }\`:

${BT3}bash
# Slack — filter by channelId / threadTs / agentId / since / limit (fields: channelId, userName, text, receivedAt, ...)
curl -s -H "X-Auth-Token: abcd" "http://localhost:5174/api/events/slack?channelId=D0AU1SH1AV8&limit=30" | jq '.messages'

# WhatsApp — filter by sessionId / chatId / direction / messageType / since / limit (fields: chatId, fromName, body, timestamp, messageType, ...)
curl -s -H "X-Auth-Token: abcd" "http://localhost:5174/api/events/whatsapp?chatId=120363426536125334@g.us&limit=30" | jq '.messages'
${BT3}

## Rules

1. **Read-only.** Every endpoint only runs SELECTs against the event store.
2. **Discover before filtering.** When the user names a person/channel/group, hit \`/contacts\` first to find the real \`conversationId\` (or pass the name as \`contact\` for a partial match).
3. **\`contact\` matches id OR name.** An exact id is precise; a name fragment is a case-insensitive \`LIKE\` match and may span several conversations.
4. **Timestamps are epoch milliseconds.** Multiply Unix seconds by 1000 for \`since\`/\`until\`; use the \`time\` (ISO) field for display.
5. **\`limit\` is shared** across both sources for \`/conversations\` (default 50, max 500). For large windows, raise \`limit\` and/or narrow with \`since\`/\`until\`.
`,
};
