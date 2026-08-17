import type { BuiltinSkillDefinition } from './types.js';

export const taskLabel: BuiltinSkillDefinition = {
  slug: 'task-label',
  name: 'Task Label',
  description: 'Generate a brief task label and mark thinking status at the start of every turn',
  allowedTools: ['Bash(curl:*)'],
  assignedAgentClasses: [],
  content: `# Opening Status (MANDATORY)

The FIRST tool call of every turn, before inspection and never batched, must be:

\`PATCH /api/agents/YOUR_AGENT_ID\`

\`\`\`json
{"taskLabel":"1-5 WORD LABEL","trackingStatus":"thinking","trackingStatusDetail":"<=80 chars: next action"}
\`\`\`

Use an action-first label (for example, "Fix login redirect"). Do this for every new task and follow-up; update both fields when scope changes. If forgotten, patch immediately. Only this opening call sets \`thinking\`; the final tracking call replaces it.`,
};
