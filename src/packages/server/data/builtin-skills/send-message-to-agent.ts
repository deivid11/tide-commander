import type { BuiltinSkillDefinition } from './types.js';

export const sendMessageToAgent: BuiltinSkillDefinition = {
  slug: 'send-message-to-agent',
  name: 'Send Message to Agent',
  description: 'Use this skill to communicate with other agents, delegate tasks, or coordinate work.',
  allowedTools: ['Bash(curl:*)'],
  content: `# Agent Messaging

List agents: \`GET /api/agents/simple\` (returns \`id\` and \`name\`).

Send to any agent or boss: \`POST /api/agents/AGENT_ID/message\`. Prefix the message with your identity. Use a heredoc to avoid JSON escaping:

\`\`\`bash
curl -s -X POST http://localhost:5174/api/agents/AGENT_ID/message \\
  -H "Content-Type: application/json" -d @- <<'EOF'
{"message":"Message from agent YOUR_NAME (YOUR_ID): Please build the auth module."}
EOF
\`\`\`

## Context collapse

Messages cannot invoke slash commands. To dispatch \`/compact\`, call \`POST /api/agents/AGENT_ID/collapse-context\` with no body while that agent is idle. A busy call returns \`409\`.

For a busy agent—or yourself, which is working during the request—queue collapse with:

\`\`\`json
{"waitForIdle":true}
\`\`\`

A successful request reports \`collapse-initiated\`; a queued one reports \`queued\` and runs at the next idle transition. Repeated queued requests coalesce. Use \`/message\` for normal communication and only \`/collapse-context\` for \`/compact\`.`,
};
