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
2. **Plan Ready for Review** - As soon as your implementation plan is written and ready for user approval
3. **Blocking Error** - When you cannot proceed
4. **Awaiting Input** - When you need user decision

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

**Plan Ready for Review:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/notify -H "Content-Type: application/json" -d '{"agentId":"YOUR_AGENT_ID","title":"Plan Ready","message":"Review implementation plan"}'
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

## MANDATORY: Plan Review Notifications
- When you enter plan mode and write an implementation plan, you MUST send a "Plan Ready" notification IMMEDIATELY after the plan is written and before waiting for user approval
- Do NOT wait for the user to notice the plan on their own - notify them right away
- Send the notification as soon as you call ExitPlanMode or present the plan for review
- The notification title should be "Plan Ready" and the message should briefly describe what the plan covers
- This applies every time a plan is created, without exception

## CRITICAL: Notification Must Be Your ABSOLUTE LAST Action
- The notification curl command must be the VERY LAST thing you do - your final tool call
- Present ALL findings, summaries, and explanations to the user BEFORE sending the notification
- Do NOT output any text, commentary, or follow-up messages after sending the notification
- Do NOT say "I will now send a notification" or announce the notification - just send it silently as your last action
- The notification signals to the system that you are DONE - anything after it may be lost or ignored
- **Correct order**: Do work -> present results to user -> send notification (end)
- **Wrong order**: Do work -> send notification -> present results (NEVER do this)
- **Also wrong**: Do work -> present results -> send notification -> add follow-up text (NEVER do this)
- Think of the notification as your "exit" command - nothing comes after it
- **Exception**: "Plan Ready" notifications are sent mid-task (right after writing the plan) since you still need user approval to proceed. In this case the notification is NOT your last action - you continue after user review`,
};
