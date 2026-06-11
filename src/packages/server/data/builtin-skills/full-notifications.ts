import type { BuiltinSkillDefinition } from './types.js';

export const fullNotifications: BuiltinSkillDefinition = {
  slug: 'full-notifications',
  name: 'Full Notifications',
  description: 'Send notification via browser, android or in-app',
  allowedTools: ['Bash(curl:*)'],
  content: `# Task Completion Notifications (MANDATORY)

Send a notification whenever a trigger below applies. The notification pings the user's devices to come look — it supplements your written response, it NEVER replaces it.

## Triggers
1. **Task Complete** — right after finishing any user request
2. **Plan Ready** — the moment you present an implementation plan for approval (e.g. ExitPlanMode) — don't wait for the user to notice the plan
3. **Error** — a blocking failure you cannot resolve
4. **Input Needed** — you need a user decision to proceed

## Endpoint

\`POST /api/notify\`

\`\`\`json
{"agentId":"YOUR_AGENT_ID","title":"TITLE","message":"MESSAGE (keep under 50 chars)"}
\`\`\`

Example titles/messages: \`Task Complete / Build succeeded\` · \`Error / Build failed\` · \`Plan Ready / Review implementation plan\` · \`Input Needed / Which database?\`

## Rules
- Notify "Task Complete" only when YOUR part is 100% done — if you delegated or are waiting on other agents/subagents, wait for their confirmation first
- Send it with the end-of-turn curls (after report-task if delegated, before the tracking PATCH), then write your final response text — the turn always ends with your written answer, never with this curl
- "Plan Ready" is the mid-task exception: send it right after presenting the plan, then wait for approval as normal
- Don't announce or narrate the notification — just send it`,
};
