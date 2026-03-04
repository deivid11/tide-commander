import type { BuiltinSkillDefinition } from './types.js';

export const reportTaskToBoss: BuiltinSkillDefinition = {
  slug: 'report-task-to-boss',
  name: 'Report Task to Boss',
  description: 'Notify your boss agent that a delegated task is finished so the boss can review and decide next steps.',
  allowedTools: ['Bash(curl:*)'],
  content: `# Report Task Completion to Boss

When you finish a task that was delegated to you by a boss agent, use this endpoint to formally report completion. This updates the boss's progress indicator and sends a report message so the boss can review your work and decide if follow-up is needed.

## When to Use

- After completing a task assigned by a boss agent
- When a delegated task fails and you cannot proceed
- You received a task prefixed with "[TASK REPORT" or delegated via the boss system

## Command

\`\`\`bash
curl -s -X POST http://localhost:5174/api/agents/YOUR_AGENT_ID/report-task \\
  -H "Content-Type: application/json" \\
  -d @- <<'EOF'
{"summary": "Brief summary of what was done and the result", "status": "completed"}
EOF
\`\`\`

## Parameters

- \`YOUR_AGENT_ID\`: Replace with YOUR own agent ID (the reporting agent, not the boss)
- \`summary\`: A concise description of what was accomplished or why it failed
- \`status\`: Either \`"completed"\` (success) or \`"failed"\` (could not finish)

## Examples

**Task completed successfully:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/agents/YOUR_AGENT_ID/report-task \\
  -H "Content-Type: application/json" \\
  -d @- <<'EOF'
{"summary": "Auth module implemented with JWT tokens, all tests passing", "status": "completed"}
EOF
\`\`\`

**Task failed:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/agents/YOUR_AGENT_ID/report-task \\
  -H "Content-Type: application/json" \\
  -d @- <<'EOF'
{"summary": "Database migration failed due to missing permissions on production schema", "status": "failed"}
EOF
\`\`\`

## What Happens

1. The boss's progress indicator for your task updates to completed/failed
2. A task report message is sent to the boss agent automatically
3. The boss reviews the report and may give you follow-up instructions
4. The delegation tracking is cleared

## Rules

- Replace \`YOUR_AGENT_ID\` with your actual agent ID from the system prompt
- Keep the summary concise but informative (what was done, key outcomes)
- Use \`"failed"\` status only when the task truly cannot be completed
- This only works when you have an active delegation from a boss agent
- Call this AFTER you have finished all work (not before)
- You should still send your regular task completion notification separately`,
};
