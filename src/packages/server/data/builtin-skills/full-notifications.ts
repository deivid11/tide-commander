import type { BuiltinSkillDefinition } from './types.js';

export const fullNotifications: BuiltinSkillDefinition = {
  slug: 'full-notifications',
  name: 'Full Notifications',
  description: 'Send notification via browser, android or in-app',
  allowedTools: ['Bash(curl:*)', 'Bash(gdbus:*)'],
  content: `# Task Completion Notifications (MANDATORY)

**IMPORTANT: You MUST send a notification automatically whenever you complete a task. This is not optional.**

## Trigger Conditions (Act Immediately)
1. **Task Completed** - Right after finishing any user request
2. **Blocking Error** - When you cannot proceed
3. **Awaiting Input** - When you need user decision

## Command Template
\`\`\`bash
curl -s -X POST http://localhost:5174/api/notify -H "Content-Type: application/json" -d '{"agentId":"YOUR_AGENT_ID","title":"TITLE","message":"MESSAGE"}' & gdbus call --session --dest=org.freedesktop.Notifications --object-path=/org/freedesktop/Notifications --method=org.freedesktop.Notifications.Notify 'Tide Commander' 0 'ICON' 'TITLE' 'MESSAGE' '[]' '{}' 5000
\`\`\`

## Examples by Type

**Task Complete:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/notify -H "Content-Type: application/json" -d '{"agentId":"YOUR_AGENT_ID","title":"Task Complete","message":"Build succeeded"}' & gdbus call --session --dest=org.freedesktop.Notifications --object-path=/org/freedesktop/Notifications --method=org.freedesktop.Notifications.Notify 'Tide Commander' 0 'dialog-information' 'Task Complete' 'Build succeeded' '[]' '{}' 5000
\`\`\`

**Error/Attention Needed:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/notify -H "Content-Type: application/json" -d '{"agentId":"YOUR_AGENT_ID","title":"Error","message":"Build failed"}' & gdbus call --session --dest=org.freedesktop.Notifications --object-path=/org/freedesktop/Notifications --method=org.freedesktop.Notifications.Notify 'Tide Commander' 0 'dialog-warning' 'Error' 'Build failed' '[]' '{}' 5000
\`\`\`

**Input Required:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/notify -H "Content-Type: application/json" -d '{"agentId":"YOUR_AGENT_ID","title":"Input Needed","message":"Which database?"}' & gdbus call --session --dest=org.freedesktop.Notifications --object-path=/org/freedesktop/Notifications --method=org.freedesktop.Notifications.Notify 'Tide Commander' 0 'dialog-question' 'Input Needed' 'Which database?' '[]' '{}' 5000
\`\`\`

## Icons (gdbus)
- \`dialog-information\` - Task complete
- \`dialog-warning\` - Error/attention needed
- \`dialog-question\` - Input required

## Rules
- Replace \`YOUR_AGENT_ID\` with your actual agent ID from the system prompt
- Keep messages under 50 characters
- **IMPORTANT: Do NOT use exclamation marks (!) in messages** - they cause bash history expansion errors
- **CRITICAL: Send notification ONLY when YOUR task is 100% done**
  - If you delegated work to another agent, wait for their response/completion BEFORE notifying
  - If you used a tool or spawned a subagent, verify output before notifying
  - If task involves waiting for other agents to finish, do NOT notify until they confirm completion
  - Only notify when YOU have nothing more to do on this task
- Send notification as your FINAL action after completing work
- Do NOT skip this step - the user relies on notifications
- The \`&\` runs both commands in parallel (curl for mobile/browser, gdbus for Linux desktop)`,
};
