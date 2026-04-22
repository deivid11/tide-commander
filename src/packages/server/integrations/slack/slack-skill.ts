/**
 * Slack Messaging Skill
 * BuiltinSkillDefinition that provides curl-based Slack instructions to agents.
 */

import type { BuiltinSkillDefinition } from '../../data/builtin-skills/types.js';

export const slackSkill: BuiltinSkillDefinition = {
  slug: 'slack-messaging',
  name: 'Slack Messaging',
  description: 'Send and receive messages via Slack',
  allowedTools: ['Bash(curl:*)'],
  content: `# Slack Messaging

Use these endpoints to communicate via Slack.

## Send a Message

\`\`\`bash
curl -s -X POST http://localhost:5174/api/slack/send \\
  -H "Content-Type: application/json" \\
  -d '{"channel":"CHANNEL_ID","text":"Your message here"}'
\`\`\`

To reply in a thread, add \`"threadTs":"THREAD_TIMESTAMP"\`.

To track which agent sent the message, add \`"agentId":"YOUR_AGENT_ID"\`.

## Send a Direct Message

\`\`\`bash
curl -s -X POST http://localhost:5174/api/slack/dm \\
  -H "Content-Type: application/json" \\
  -d '{"userId":"U0123456789","text":"Your message here"}'
\`\`\`

Required: \`userId\` (Slack user ID), \`text\`.
Optional: \`agentId\`, \`workflowInstanceId\`.

Use the search endpoint below to find a user's ID by name or email.

## Search Users

\`\`\`bash
curl -s "http://localhost:5174/api/slack/users/search?q=john"
\`\`\`

Searches by name, display name, real name, or email. Returns matching users with their IDs.

## Read Channel Messages

\`\`\`bash
curl -s http://localhost:5174/api/slack/messages?channel=CHANNEL_ID&limit=10
\`\`\`

Query params: \`channel\` (required), \`limit\` (default 20), \`oldest\`, \`latest\` (Slack timestamps)

## Read Thread Replies

\`\`\`bash
curl -s "http://localhost:5174/api/slack/thread?channel=CHANNEL_ID&threadTs=THREAD_TS"
\`\`\`

## Wait for a Reply (Long-Poll)

\`\`\`bash
curl -s -X POST http://localhost:5174/api/slack/wait-for-reply \\
  -H "Content-Type: application/json" \\
  -d '{"channel":"CHANNEL_ID","threadTs":"THREAD_TS","timeoutMs":300000}'
\`\`\`

Returns the first matching reply or \`{"message":null,"timedOut":true}\` after timeout.

Optional body fields:
- \`fromUsers\`: Array of Slack user IDs to filter replies
- \`messagePattern\`: Regex to match reply text
- \`timeoutMs\`: Timeout in ms (default 300000 = 5 min)

## Join a Channel

\`\`\`bash
curl -s -X POST http://localhost:5174/api/slack/channels/join \\
  -H "Content-Type: application/json" \\
  -d '{"channel":"CHANNEL_ID"}'
\`\`\`

The bot must join a channel before it can read messages or post in it. Use the list endpoint to find channel IDs.

## List Channels

\`\`\`bash
curl -s http://localhost:5174/api/slack/channels
\`\`\`

## Resolve a User

\`\`\`bash
curl -s http://localhost:5174/api/slack/users/U0123456789
\`\`\`

## Upload / Images

Upload a file or image to Slack. Uses Slack's new two-step files API (files.upload is deprecated since Nov 2025).
The bot token must have the **\`files:write\`** scope.

**Multipart (upload a file from disk):**
\`\`\`bash
curl -s -F "file=@image.png" \\
     -F "channelId=C0123456789" \\
     -F "initialComment=Here's the chart" \\
     http://localhost:5174/api/slack/upload
\`\`\`

**JSON / base64 (useful for in-memory images like generated charts):**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/slack/upload-base64 \\
  -H "Content-Type: application/json" \\
  -d '{
    "filename":"chart.png",
    "contentBase64":"iVBORw0KGgoAAAANSUhEUg...",
    "channelId":"C0123456789",
    "initialComment":"Here is today\\'s report",
    "threadTs":"1234567890.123456"
  }'
\`\`\`

Fields (both variants):
- \`file\` or \`contentBase64\` — the bytes (required)
- \`filename\` — required for base64; multipart uses the uploaded file's original name if omitted
- \`channelId\` — optional; if omitted the file is uploaded but not shared to a channel
- \`title\` — optional display title (defaults to filename)
- \`initialComment\` — optional message posted with the file
- \`threadTs\` — optional thread timestamp to post the file as a reply

Response: \`{"success":true,"fileId":"F0123...","file":{"id","name","title","mimetype","size","permalink","url_private",...}}\`.

## Read / Download Files

Inspect and download files shared in Slack. Requires the bot token to have **\`files:read\`**.

**List files (optional filters):**
\`\`\`bash
# All recent files
curl -s http://localhost:5174/api/slack/files

# Images shared in a specific channel
curl -s "http://localhost:5174/api/slack/files?channelId=C0123456789&types=images&count=20"
\`\`\`
Filters: \`channelId\`, \`userId\`, \`tsFrom\`, \`tsTo\`, \`types\` (Slack type string like \`images\`, \`pdfs\`, \`spaces\`), \`count\`, \`page\`.

**Get a single file's metadata:**
\`\`\`bash
curl -s http://localhost:5174/api/slack/files/F0123ABCD
\`\`\`
Returns \`{ "file": { "id","name","title","mimetype","size","permalink","url_private","url_private_download" } }\`.

**Download a file (binary proxy, auth added server-side):**
\`\`\`bash
curl -s http://localhost:5174/api/slack/files/F0123ABCD/content -o /tmp/attachment.bin
\`\`\`
Preserves upstream \`Content-Type\` and \`Content-Disposition\` from Slack's CDN.

**Server-side save to a filesystem path:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/slack/files/F0123ABCD/download \\
  -H "Content-Type: application/json" \\
  -d '{"outputPath":"/tmp/slack/F0123ABCD.png"}'
\`\`\`
Returns \`{ "success":true, "path":"/tmp/slack/F0123ABCD.png", "bytes": 12345, "filename":"chart.png", "mimeType":"image/png" }\`.

Messages returned by \`/messages\` and \`/thread\` now include an optional \`files: [...]\` array on each message when attachments exist — use the file ids there as input to the endpoints above.

**Pitfall — do NOT \`curl\` \`url_private\` directly.** Slack's \`url_private\` (and \`url_private_download\`) only return the actual file bytes when the request sends \`Authorization: Bearer <bot-token>\`; without it Slack serves an HTML sign-in page. Use the proxy endpoints above — they attach the bot token server-side so agents never need to handle the token.

## Reactions

Add an emoji reaction to a Slack message. Requires the bot token to have **\`reactions:write\`**.

\`\`\`bash
curl -s -X POST http://localhost:5174/api/slack/reactions/add \\
  -H "Content-Type: application/json" \\
  -d '{"channel":"C0123456789","ts":"1234567890.123456","name":"eyes"}'
\`\`\`

Fields:
- \`channel\` — Slack channel id (required)
- \`ts\` — message timestamp (required; looks like \`1234567890.123456\`)
- \`name\` — emoji slug without colons (e.g. \`eyes\`, \`+1\`, \`white_check_mark\`). Raw eye emoji chars (\`👁\`, \`👀\`) are auto-normalized to \`eyes\`.

\`already_reacted\` responses are silently ignored.

### Auto-react on triggers

When a Slack trigger fires on an incoming message, the bot automatically reacts with :eyes: (👀) as a visual acknowledgement that it saw the message. This happens fire-and-forget — a failed reaction never blocks the trigger.

Disable the auto-ack by setting \`SLACK_REACT_ON_TRIGGER=false\` (accepts \`false\`/\`0\`/\`no\`/\`off\`) in the server environment.

## Check Connection Status

\`\`\`bash
curl -s http://localhost:5174/api/slack/status
\`\`\`

## Notes
- Channel IDs look like \`C0123456789\`. Use the list channels endpoint to find them.
- Thread timestamps look like \`1234567890.123456\`.
- The wait-for-reply endpoint blocks until a reply arrives or timeout. Use it when you need to wait for a human response.
- Auth headers are added automatically by the system.
`,
};
