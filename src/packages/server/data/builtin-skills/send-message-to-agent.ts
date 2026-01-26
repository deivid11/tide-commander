import type { BuiltinSkillDefinition } from './types.js';

export const sendMessageToAgent: BuiltinSkillDefinition = {
  slug: 'send-message-to-agent',
  name: 'Send Message to Agent',
  description: 'Use this skill to communicate with other agents, delegate tasks, or coordinate work.',
  allowedTools: ['Bash(curl:*)'],
  content: `# Send Message to Agent

Send messages to other agents in Tide Commander.

## Step 1: Get Agents List

\`\`\`bash
curl -s http://localhost:5174/api/agents/simple
\`\`\`

Returns agents with \`id\` and \`name\` only.

## Step 2: Send Message

Use a heredoc to avoid JSON escaping issues:

\`\`\`bash
curl -s -X POST http://localhost:5174/api/agents/AGENT_ID/message \\
  -H "Content-Type: application/json" \\
  -d @- <<'EOF'
{"message": "Message from agent YOUR_NAME (YOUR_ID): Your message here"}
EOF
\`\`\`

Replace:
- \`AGENT_ID\` with the target agent's ID
- \`YOUR_NAME\` with your agent name
- \`YOUR_ID\` with your agent ID

## Example

\`\`\`bash
curl -s -X POST http://localhost:5174/api/agents/def456/message \\
  -H "Content-Type: application/json" \\
  -d @- <<'EOF'
{"message": "Message from agent Scout Alpha (abc123): Please build the auth module."}
EOF
\`\`\`

## Notes

- Always prefix messages with your identity so the receiver knows who sent it
- Use heredoc syntax (\`-d @- <<'EOF'\`) to avoid JSON escaping problems
- Keep messages simple - avoid special characters like backslashes or nested quotes
- Works with all agent types including boss agents`,
};
