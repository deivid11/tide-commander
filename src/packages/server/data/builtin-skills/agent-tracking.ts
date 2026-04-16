import type { BuiltinSkillDefinition } from './types.js';

export const agentTracking: BuiltinSkillDefinition = {
  slug: 'agent-tracking',
  name: 'Agent Tracking',
  description: 'Let agents keep tracking status updated through work completion',
  allowedTools: ['Bash(curl:*)'],
  assignedAgentClasses: ['*'],
  content: `# Agent Tracking Status (MANDATORY)

After completing a task or when your status changes, update your tracking status using this API call:

## Command
\`\`\`bash
curl -s -X PATCH -H "X-Auth-Token: abcd" http://localhost:5174/api/agents/YOUR_AGENT_ID -H "Content-Type: application/json" -d '{"trackingStatus":"STATUS","trackingStatusDetail":"SHORT_DESCRIPTION"}'
\`\`\`

## Available Statuses
- \`working\` — This is set automatically when you start working. Do not set this manually unless explicitly told to do so.
- \`need-review\` — Use when you finished work that needs the user to review (code changes, plans, findings)
- \`blocked\` — Use when you cannot proceed (waiting on another agent, need user input, hit an error you cannot resolve)
- \`can-clear-context\` — Use when your task is fully complete and your context can be safely cleared

## Rules
- Replace YOUR_AGENT_ID with your actual agent ID from the system prompt
- Replace STATUS with one of the status values above
- Keep trackingStatusDetail under 80 characters
- Do NOT use exclamation marks in the detail string
- The system automatically sets \`working\` while you are actively working
- After finishing work, you MUST set a final status such as \`need-review\` or \`can-clear-context\`
- When your situation changes, update the tracking status immediately so the board stays accurate
- When blocked, include WHO or WHAT you are blocked on in the detail
- When setting need-review, briefly describe what needs review in the detail
- When setting can-clear-context, briefly describe what is safe to clear`,
};
