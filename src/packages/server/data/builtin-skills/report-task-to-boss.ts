import type { BuiltinSkillDefinition } from './types.js';

export const reportTaskToBoss: BuiltinSkillDefinition = {
  slug: 'report-task-to-boss',
  name: 'Report Task to Boss',
  description: 'Notify your boss agent that a delegated task is finished so the boss can review and decide next steps.',
  allowedTools: ['Bash(curl:*)'],
  content: `# Report Task to Boss (MANDATORY for delegated tasks)

If a boss delegated this work, you MUST call report-task before ending the turn. Chat messages and notifications do NOT substitute — only this call closes the delegation; skipping it hangs the boss's progress indicator forever.

## You Owe a Report When
- The task starts with \`[DELEGATED TASK from boss\`
- Your agent has a \`bossId\` set, or the assignment names a boss

## Endpoint

\`POST /api/agents/YOUR_AGENT_ID/report-task\` — YOUR own ID (the reporting agent), not the boss's

\`\`\`json
{"summary":"What was done and the result (for failures, explain why)","status":"completed"}
\`\`\`

\`status\` is \`"completed"\` or \`"failed"\`.

## Rules
- Call AFTER all work is done, never before; trivial tasks still require it
- It is the FIRST of the end-of-turn curls: report-task → notification → tracking PATCH → final response text
- Forgot it? Send it as soon as you notice, even late`,
};
