import type { BuiltinSkillDefinition } from './types.js';

export const sendMessageToAgent: BuiltinSkillDefinition = {
  slug: 'send-message-to-agent',
  name: 'Send Message to Agent',
  description: 'Use this skill to communicate with other agents, delegate tasks, or coordinate work.',
  allowedTools: ['Bash(curl:*)'],
  content: `# Send Message to Agent

## 1. List agents

\`\`\`bash
curl -s http://localhost:5174/api/agents/simple
\`\`\`

Returns agents with \`id\` and \`name\` only.

## 2. Send message

Use heredoc syntax (\`-d @- <<'EOF'\`) to avoid JSON escaping issues; keep messages simple (no backslashes or nested quotes). Always prefix with your identity so the receiver knows the sender. Works with all agent types including boss agents.

\`\`\`bash
curl -s -X POST http://localhost:5174/api/agents/AGENT_ID/message \\
  -H "Content-Type: application/json" \\
  -d @- <<'EOF'
{"message": "Message from agent YOUR_NAME (YOUR_ID): Please build the auth module."}
EOF
\`\`\`

## Collapsing an agent's context (\`/compact\`)

\`/message\` cannot deliver Claude Code slash commands — the slash is passed through as message body. To send \`/compact\` (compresses the agent's conversation history), use the dedicated endpoint. Works for ANY agent, including yourself:

\`\`\`bash
curl -s -X POST http://localhost:5174/api/agents/AGENT_ID/collapse-context
\`\`\`

Response: \`{ "success": true, "agentId": "AGENT_ID", "status": "collapse-initiated" }\`

Status codes:
- \`200\` + \`status: "collapse-initiated"\` — \`/compact\` dispatched
- \`200\` + \`status: "queued"\` — agent was busy; \`/compact\` queued and fires when the agent next goes idle (only when body has \`waitForIdle: true\`)
- \`404\` + \`status: "not-found"\` — agent id doesn't exist
- \`409\` + \`status: "busy"\` + \`currentStatus\` — agent isn't idle and \`waitForIdle\` not set; retry once it goes idle
- \`500\` + \`status: "error"\` — runtime error sending the command

### Self-collapse (\`waitForIdle\`)

When collapsing YOURSELF (e.g. a cron-driven end-of-flow step), you are still \`working\` at request time, so the default returns \`409 busy\`. Pass \`waitForIdle: true\` to queue instead:

\`\`\`bash
curl -s -X POST http://localhost:5174/api/agents/YOUR_AGENT_ID/collapse-context \\
  -H "Content-Type: application/json" \\
  -d '{"waitForIdle": true}'
\`\`\`

Returns \`200 + {"status": "queued"}\`; the \`/compact\` is dispatched the first time your status transitions to \`idle\`. Stacked \`waitForIdle\` calls for the same agent coalesce into a single \`/compact\`. Use this when you want an agent's next turn to start with a compressed context.

**Which endpoint:**
- \`/message\` — deliver content/instructions to an agent (the usual case)
- \`/collapse-context\` — the only path that delivers the \`/compact\` slash command; \`/message\` will not`,
};
