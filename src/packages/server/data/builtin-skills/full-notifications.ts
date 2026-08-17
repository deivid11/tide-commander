import type { BuiltinSkillDefinition } from './types.js';

export const fullNotifications: BuiltinSkillDefinition = {
  slug: 'full-notifications',
  name: 'Full Notifications',
  description: 'Send notification via browser, android or in-app',
  allowedTools: ['Bash(curl:*)'],
  content: `# Notifications (MANDATORY)

\`POST /api/notify\`

\`\`\`json
{"agentId":"YOUR_AGENT_ID","title":"TITLE","message":"MESSAGE (under 50 chars)"}
\`\`\`

Send for:
- **Task Complete** — after every request, but only when your work and delegated work are fully done
- **Plan Ready** — immediately when presenting a plan for approval
- **Error** — an unresolved blocking failure
- **Input Needed** — a user decision is required

Except for Plan Ready, send with end-of-turn calls: after report-task (when delegated), before the tracking PATCH, then write the final response. Notifications supplement rather than replace the response. Do not narrate them.`,
};
