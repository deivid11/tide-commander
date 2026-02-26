import type { BuiltinSkillDefinition } from './types.js';

export const taskLabel: BuiltinSkillDefinition = {
  slug: 'task-label',
  name: 'Task Label',
  description: 'Generate a brief task label for scene display',
  allowedTools: ['Bash(curl:*)'],
  assignedAgentClasses: ['*'],
  content: `# Task Label (MANDATORY - Execute FIRST)

**IMPORTANT: Before doing ANY other work, you MUST generate a brief task label describing your current task.**

## Steps (do this FIRST before anything else):
1. Read the user's request
2. Generate a 1-5 word summary of the task (e.g., "Fix auth bug", "Add dark mode", "Refactor API calls", "Update tests")
3. Call the API to set your task label:

\`\`\`bash
curl -s -X PATCH http://localhost:5174/api/agents/YOUR_AGENT_ID -H "Content-Type: application/json" -d '{"taskLabel":"YOUR 1-5 WORD LABEL"}'
\`\`\`

4. Then proceed with the actual task

## Rules
- Keep labels between 1-5 words maximum
- Use action verbs: Fix, Add, Update, Refactor, Debug, Implement, Remove, etc.
- Be specific but concise (e.g., "Fix login redirect" not "Work on stuff")
- Do this BEFORE any other work - it should be your very first action
- Do NOT use exclamation marks (!) in the label - they cause bash errors
- Replace YOUR_AGENT_ID with your actual agent ID from the system prompt`,
};
