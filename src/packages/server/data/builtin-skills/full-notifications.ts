import type { BuiltinSkillDefinition } from './types.js';

export const fullNotifications: BuiltinSkillDefinition = {
  slug: 'full-notifications',
  name: 'Full Notifications',
  description: 'Send notification via browser, android or in-app',
  allowedTools: ['Bash(curl:*)'],
  content: `# Task Completion Notifications (MANDATORY)

**IMPORTANT: You MUST send a notification automatically whenever you complete a task. This is not optional.**

## Trigger Conditions (Act Immediately)
1. **Task Completed** - Right after finishing any user request
2. **Blocking Error** - When you cannot proceed
3. **Awaiting Input** - When you need user decision

## Command Template
\`\`\`bash
curl -s -X POST http://localhost:5174/api/notify -H "Content-Type: application/json" -d '{"agentId":"YOUR_AGENT_ID","title":"TITLE","message":"MESSAGE"}'
\`\`\`

## Examples by Type

**Task Complete:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/notify -H "Content-Type: application/json" -d '{"agentId":"YOUR_AGENT_ID","title":"Task Complete","message":"Build succeeded"}'
\`\`\`

**Error/Attention Needed:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/notify -H "Content-Type: application/json" -d '{"agentId":"YOUR_AGENT_ID","title":"Error","message":"Build failed"}'
\`\`\`

**Input Required:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/notify -H "Content-Type: application/json" -d '{"agentId":"YOUR_AGENT_ID","title":"Input Needed","message":"Which database?"}'
\`\`\`

## Rules
- Replace \`YOUR_AGENT_ID\` with your actual agent ID from the system prompt
- Keep messages under 50 characters
- **IMPORTANT: Do NOT use exclamation marks (!) in messages** - they cause bash history expansion errors
- **CRITICAL: Send notification ONLY when YOUR task is 100% done**
  - If you delegated work to another agent, wait for their response/completion BEFORE notifying
  - If you used a tool or spawned a subagent, verify output before notifying
  - If task involves waiting for other agents to finish, do NOT notify until they confirm completion
  - Only notify when YOU have nothing more to do on this task
- Do NOT skip this step - the user relies on notifications

## CRITICAL: Notification Must Be Your ABSOLUTE LAST Action
- The notification curl command must be the VERY LAST thing you do - your final tool call
- Present ALL findings, summaries, and explanations to the user BEFORE sending the notification
- Do NOT output any text, commentary, or follow-up messages after sending the notification
- Do NOT say "I will now send a notification" or announce the notification - just send it silently as your last action
- The notification signals to the system that you are DONE - anything after it may be lost or ignored
- **Correct order**: Do work -> present results to user -> send notification (end)
- **Wrong order**: Do work -> send notification -> present results (NEVER do this)
- **Also wrong**: Do work -> present results -> send notification -> add follow-up text (NEVER do this)
- Think of the notification as your "exit" command - nothing comes after it`,
};
