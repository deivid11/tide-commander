import type { BuiltinSkillDefinition } from './types.js';

const BT3 = '```';

export const conversationHistory: BuiltinSkillDefinition = {
  slug: 'conversation-history',
  name: 'Conversation History',
  description:
    'Retrieve recent Slack and WhatsApp conversation history from the local event store: list channels/chats, then pull a clean chronological transcript filtered by source, contact/channel/chat, limit, and time range.',
  allowedTools: ['Bash(curl:*)', 'Bash(jq:*)'],
  content: `# Conversation History Skill

Retrieve recent **Slack** and **WhatsApp** conversation history that Tide Commander
persists in its local SQLite event store (\`~/.local/share/tide-commander/events.db\`,
tables \`slack_messages\` and \`whatsapp_messages\`). Access is **read-only** — these
endpoints only run SELECTs.

Use this skill when the user asks things like *"what did X say on WhatsApp?"*,
*"show me the last messages in the soporte Slack channel"*, *"summarize today's
chat with the OPM group"*, or *"pull the recent conversation with <contact>"*.

All endpoints live under \`/api/events/\` and use the same auth header as every
other Tide Commander skill (\`X-Auth-Token\`).

---

## Endpoint Reference

| Endpoint | Method | Purpose |
|---|---|---|
| \`/api/events/conversations/contacts\` | GET | List Slack channels + WhatsApp chats (for id/name discovery) |
| \`/api/events/conversations\` | GET | **Unified chronological transcript** across Slack + WhatsApp |
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

Messages are returned **oldest → newest** (ready to print as a transcript). The
newest \`limit\` messages in range are selected, then ordered chronologically.

---

## Step 1: Discover channels / chats

Find what conversations exist and the ids/names to filter by:

${BT3}bash
# Everything, most-recently-active first
curl -s -H "X-Auth-Token: abcd" "http://localhost:5174/api/events/conversations/contacts?limit=30" | jq

# Just WhatsApp chats, compact
curl -s -H "X-Auth-Token: abcd" "http://localhost:5174/api/events/conversations/contacts?source=whatsapp&limit=30" \\
  | jq '.conversations[] | {conversationId, conversationName, isGroup, messageCount, lastTime}'
${BT3}

Each summary has: \`source\`, \`conversationId\`, \`conversationName\`, \`isGroup\`
(WhatsApp), \`messageCount\`, \`lastTimestamp\` (epoch ms) and \`lastTime\` (ISO).

## Step 2: Pull a transcript

${BT3}bash
# Last 50 messages across BOTH sources
curl -s -H "X-Auth-Token: abcd" "http://localhost:5174/api/events/conversations?limit=50" | jq

# Recent WhatsApp messages for one chat/contact (by partial name)
curl -s -H "X-Auth-Token: abcd" \\
  "http://localhost:5174/api/events/conversations?source=whatsapp&contact=OPM&limit=40" | jq '.messages'

# A specific Slack channel by id
curl -s -H "X-Auth-Token: abcd" \\
  "http://localhost:5174/api/events/conversations?source=slack&contact=D0AU1SH1AV8&limit=40" | jq '.messages'
${BT3}

**Response shape:**
${BT3}json
{
  "source": "both",
  "count": 2,
  "messages": [
    {
      "source": "whatsapp",
      "id": 1234,
      "conversationId": "120363426536125334@g.us",
      "conversationName": "OPM Soporte",
      "isGroup": true,
      "sender": "Juan",
      "direction": "inbound",
      "text": "Buen día, hay un problema con el widget",
      "messageType": "text",
      "timestamp": 1780000000000,
      "time": "2026-05-28T15:00:00.000Z"
    },
    {
      "source": "slack",
      "id": 5678,
      "conversationId": "D0AU1SH1AV8",
      "conversationName": "soporte",
      "sender": "soporte_commander",
      "direction": "outbound",
      "text": "Ya lo estamos revisando",
      "timestamp": 1780000060000,
      "time": "2026-05-28T15:01:00.000Z"
    }
  ]
}
${BT3}

\`direction\` is \`inbound\` (received) or \`outbound\` (sent by us/an agent).
Non-text WhatsApp items get a placeholder body like \`[image: photo.jpg]\`; audio
transcriptions are appended as \`(transcription: ...)\`.

## Step 3: Time-range filtering

\`since\` / \`until\` are **epoch milliseconds**. Compute them in the shell:

${BT3}bash
# Messages from the last 24h, both sources
SINCE=$(( ($(date +%s) - 86400) * 1000 ))
curl -s -H "X-Auth-Token: abcd" \\
  "http://localhost:5174/api/events/conversations?since=$SINCE&limit=200" | jq '.messages'

# A specific window (since .. until)
SINCE=$(( $(date -d '2026-05-27 00:00' +%s) * 1000 ))
UNTIL=$(( $(date -d '2026-05-27 23:59' +%s) * 1000 ))
curl -s -H "X-Auth-Token: abcd" \\
  "http://localhost:5174/api/events/conversations?source=whatsapp&contact=OPM&since=$SINCE&until=$UNTIL" | jq '.messages'
${BT3}

## Step 4: Render a clean transcript

Turn the JSON into a readable, chronological transcript with \`jq\`:

${BT3}bash
curl -s -H "X-Auth-Token: abcd" "http://localhost:5174/api/events/conversations?contact=OPM&limit=40" \\
  | jq -r '.messages[] | "[\\(.time)] (\\(.source)/\\(.direction)) \\(.sender): \\(.text)"'
${BT3}

Produces lines like:
${BT3}
[2026-05-28T15:00:00.000Z] (whatsapp/inbound) Juan: Buen día, hay un problema con el widget
[2026-05-28T15:01:00.000Z] (slack/outbound) soporte_commander: Ya lo estamos revisando
${BT3}

---

## Single-source raw endpoints (optional)

If you need raw rows (all native columns) for one source:

${BT3}bash
# Slack — filter by channelId / threadTs / agentId / since / limit
curl -s -H "X-Auth-Token: abcd" "http://localhost:5174/api/events/slack?channelId=D0AU1SH1AV8&limit=30" | jq '.messages'

# WhatsApp — filter by sessionId / chatId / direction / messageType / since / limit
curl -s -H "X-Auth-Token: abcd" "http://localhost:5174/api/events/whatsapp?chatId=120363426536125334@g.us&limit=30" | jq '.messages'
${BT3}

These return \`{ messages, total }\` with messages **newest-first** and the full
native field set (Slack: \`channelId\`, \`userName\`, \`text\`, \`receivedAt\`, ...;
WhatsApp: \`chatId\`, \`fromName\`, \`body\`, \`timestamp\`, \`messageType\`, ...).

---

## Important Rules

1. **Read-only.** Every endpoint runs SELECTs against the event store — nothing
   is ever written or deleted.
2. **Discover before filtering.** When the user names a person/channel/group, run
   Step 1 first to find the real \`conversationId\` (or pass the name as \`contact\`
   for a partial match).
3. **\`contact\` matches id OR name.** An exact id is precise; a name fragment is a
   case-insensitive \`LIKE\` match and may span several conversations.
4. **Timestamps are epoch milliseconds.** Multiply Unix seconds by 1000 for
   \`since\`/\`until\`. Use the \`time\` (ISO) field for display.
5. **\`limit\` is shared** across both sources for \`/conversations\` (default 50,
   max 500). For large windows, raise \`limit\` and/or narrow with \`since\`/\`until\`.

## Example Workflow

${BT3}bash
# 1) What conversations are active?
curl -s -H "X-Auth-Token: abcd" "http://localhost:5174/api/events/conversations/contacts?limit=20" \\
  | jq '.conversations[] | {source, conversationId, conversationName, messageCount, lastTime}'

# 2) Pull the recent transcript for the one we care about
curl -s -H "X-Auth-Token: abcd" "http://localhost:5174/api/events/conversations?contact=OPM&limit=50" \\
  | jq -r '.messages[] | "[\\(.time)] (\\(.source)/\\(.direction)) \\(.sender): \\(.text)"'

# 3) Summarize / answer the user's question from that transcript
${BT3}
`,
};
