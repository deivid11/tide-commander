import type { BuiltinSkillDefinition } from './types.js';

export const agentTracking: BuiltinSkillDefinition = {
  slug: 'agent-tracking',
  name: 'Agent Tracking',
  description: 'Let agents keep tracking status updated through work completion',
  allowedTools: ['Bash(curl:*)'],
  assignedAgentClasses: [],
  content: `# Final Status (MANDATORY)

Every turn must end with this PATCH as the LAST tool call, followed by a written response:

\`PATCH /api/agents/YOUR_AGENT_ID\`

\`\`\`json
{"trackingStatus":"STATUS","trackingStatusDetail":"<=80 chars"}
\`\`\`

Statuses:
- \`working\`: optional during long work
- \`need-review\`: done but awaiting user review or confirmation
- \`blocked\`: cannot proceed; name the blocker
- \`can-clear-context\`: fully done with nothing pending
- \`waiting-subordinates\`: boss awaiting delegated work
- \`thinking\`: reserved for the opening Task Label call

End-of-turn order: finish and verify → report-task if delegated → notification if required → tracking PATCH → final response. Never end on a tool call; even brief answers and questions require both the PATCH and response.`,
};
