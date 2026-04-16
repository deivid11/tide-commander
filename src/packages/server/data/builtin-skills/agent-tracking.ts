import type { BuiltinSkillDefinition } from './types.js';

export const agentTracking: BuiltinSkillDefinition = {
  slug: 'agent-tracking',
  name: 'Agent Tracking',
  description: 'Let agents keep tracking status updated through work completion',
  allowedTools: ['Bash(curl:*)'],
  assignedAgentClasses: ['*'],
  content: `# Agent Tracking Status (MANDATORY)

**IMPORTANT: You MUST update your tracking status after EVERY single task completion. This is not optional.**

## Trigger Conditions (Act Immediately)
1. **After ANY user request is finished** - No matter how small (even a simple greeting, a one-line answer, or a trivial task), you MUST set a final tracking status
2. **When you get blocked** - Cannot proceed for any reason
3. **When your situation changes** - Update immediately so the board stays accurate

## Command
\`\`\`bash
curl -s -X PATCH -H "X-Auth-Token: abcd" http://localhost:5174/api/agents/YOUR_AGENT_ID -H "Content-Type: application/json" -d '{"trackingStatus":"STATUS","trackingStatusDetail":"SHORT_DESCRIPTION"}'
\`\`\`

## Available Statuses
- \`working\` — This is set automatically when you start working. Do not set this manually unless explicitly told to do so.
- \`need-review\` — Use when you finished work that needs the user to review (code changes, plans, findings)
- \`blocked\` — Use when you cannot proceed (waiting on another agent, need user input, hit an error you cannot resolve)
- \`can-clear-context\` — Use when your task is fully complete and your context can be safely cleared
- \`waiting-subordinates\` — Use when you (as a boss agent) have delegated tasks and are waiting for subordinates to complete their work

## Rules
- Replace YOUR_AGENT_ID with your actual agent ID from the system prompt
- Replace STATUS with one of the status values above
- Keep trackingStatusDetail under 80 characters
- Do NOT use exclamation marks in the detail string
- The system automatically sets \`working\` while you are actively working
- After finishing work, you MUST set a final status such as \`need-review\` or \`can-clear-context\`
- When your situation changes, update the tracking status immediately so the board stays accurate
- When blocked, include WHO or WHAT you are blocked on in the detail
- When setting need-review, briefly describe what needs review in the detail
- When setting can-clear-context, briefly describe what is safe to clear
- Boss agents: after delegating tasks to subordinates, set \`waiting-subordinates\` with a detail describing what you are waiting for

## CRITICAL: Notification Must Be Your ABSOLUTE LAST Action
- The tracking status curl command must be the VERY LAST thing you do - your final tool call
- Present ALL findings, summaries, and explanations to the user BEFORE sending the tracking status update
- Do NOT output any text, commentary, or follow-up messages after updating the tracking status
- Think of the tracking status update as your "exit" command - nothing comes after it
- **Correct order**: Do work -> present results to user -> update tracking status (end)
- **Wrong order**: Do work -> update tracking status -> present results (NEVER do this)`,
};
