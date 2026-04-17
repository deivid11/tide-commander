import type { BuiltinSkillDefinition } from './types.js';

export const taskLabel: BuiltinSkillDefinition = {
  slug: 'task-label',
  name: 'Task Label',
  description: 'Generate a brief task label for scene display',
  allowedTools: ['Bash(curl:*)'],
  assignedAgentClasses: ['*'],
  content: `# Task Label (MANDATORY - Execute FIRST)

**IMPORTANT: You MUST generate a brief task label describing your current task.**

## Steps (do this FIRST before anything else):
1. Read the user's request
2. Generate a 1-5 word summary of the task (e.g., "Fix auth bug", "Add dark mode", "Refactor API calls", "Update tests")
3. Call the API to set your task label:

\`PATCH /api/agents/YOUR_AGENT_ID\`

**Body:**
\`\`\`json
{"taskLabel":"YOUR 1-5 WORD LABEL"}
\`\`\`

4. Then proceed with the actual task

## Rules
- Keep labels between 1-5 words maximum
- Use action verbs: Fix, Add, Update, Refactor, Debug, Implement, Remove, etc.
- Be specific but concise (e.g., "Fix login redirect" not "Work on stuff")

## CRITICAL: Execution Order
- This MUST be your absolute first action - before reading files, before searching code, before ANY tool call
- The very first tool call in your response MUST be the curl command to set the task label
- Do NOT plan, research, or explore anything before setting the label
- Do NOT batch the label call with other tool calls - it must be the sole action in your first response
- If you fail to set the label as your first action, you are violating a mandatory instruction
- There are ZERO exceptions to this rule - every single task begins with setting the label`,
};
