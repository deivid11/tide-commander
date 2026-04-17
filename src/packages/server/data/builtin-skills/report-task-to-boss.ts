import type { BuiltinSkillDefinition } from './types.js';

export const reportTaskToBoss: BuiltinSkillDefinition = {
  slug: 'report-task-to-boss',
  name: 'Report Task to Boss',
  description: 'Notify your boss agent that a delegated task is finished so the boss can review and decide next steps.',
  allowedTools: ['Bash(curl:*)'],
  content: `# Report Task to Boss (MANDATORY for delegated tasks)

**If a boss delegated work to you, you MUST call this endpoint before you stop. Notifications do NOT substitute — only report-task closes the delegation. Skipping it hangs the boss's progress indicator forever.**

## You Owe a Report When
- The task starts with \`[DELEGATED TASK from boss\`
- Your agent has a \`bossId\` set
- The assignment mentions a boss by name or ID

Treat this as a hard gate before your final tool call.

## Endpoint

\`POST /api/agents/YOUR_AGENT_ID/report-task\`

**Body:**
\`\`\`json
{"summary": "What was done and the result", "status": "completed"}
\`\`\`

## Parameters
- \`YOUR_AGENT_ID\` — YOUR own ID (the reporting agent, not the boss)
- \`summary\` — concise outcome; for failures explain why
- \`status\` — \`"completed"\` or \`"failed"\`

## Rules
- Call AFTER all work is done, never before
- Trivial tasks still require a report
- Do not replace it with a chat message or notification — the boss routing system needs the report-task call
- Send BEFORE the tracking-status update (tracking is always the final curl)
- Safe to call late if you forgot — send it anyway before ending the turn`,
};
