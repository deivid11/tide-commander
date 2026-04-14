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
