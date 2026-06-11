import type { BuiltinSkillDefinition } from './types.js';

export const taskLabel: BuiltinSkillDefinition = {
  slug: 'task-label',
  name: 'Task Label',
  description: 'Generate a brief task label and mark thinking status at the start of every turn',
  allowedTools: ['Bash(curl:*)'],
  assignedAgentClasses: [],
  content: `# Task Label + Thinking Status (MANDATORY — first tool call of every turn)

Your FIRST tool call in every turn — before any Read/Grep/Bash/other tool, and never batched with other calls — is one combined PATCH that sets a short task label and flips your tracking status to \`thinking\` (shows typing dots on the user's board while you plan):

\`PATCH /api/agents/YOUR_AGENT_ID\`

\`\`\`json
{"taskLabel":"1-5 WORD LABEL","trackingStatus":"thinking","trackingStatusDetail":"<=80 chars: what you are about to do"}
\`\`\`

## Rules
- Label: 1-5 words, action verb first ("Fix login redirect", not "Work on stuff")
- Applies to EVERY new task, including follow-ups in the same session; when scope changes, update both fields the same way before continuing
- One combined PATCH — never split label and status into two calls
- Forgot it? Send it as soon as you notice, then continue
- \`thinking\` is set ONLY by this opening PATCH; your end-of-turn tracking PATCH (see Agent Tracking skill) replaces it with the outcome status`,
};
