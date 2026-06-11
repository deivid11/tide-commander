import type { BuiltinSkillDefinition } from './types.js';

export const agentTracking: BuiltinSkillDefinition = {
  slug: 'agent-tracking',
  name: 'Agent Tracking',
  description: 'Let agents keep tracking status updated through work completion',
  allowedTools: ['Bash(curl:*)'],
  assignedAgentClasses: [],
  content: `# Agent Tracking Status (MANDATORY)

Every turn ends with a tracking-status PATCH followed by your final response text. Skipping the PATCH leaves the user's board stuck on \`thinking\`/\`working\`; skipping the response text leaves the user staring at an empty reply.

## Endpoint

\`PATCH /api/agents/YOUR_AGENT_ID\`

\`\`\`json
{"trackingStatus":"STATUS","trackingStatusDetail":"<=80 chars"}
\`\`\`

## Statuses
- \`thinking\` — set automatically by the opening Task Label PATCH; never set it manually elsewhere
- \`working\` — optional mid-turn switch during long work (clears the typing dots)
- \`need-review\` — finished, awaiting user review (say what)
- \`blocked\` — cannot proceed (say who/what blocks you)
- \`can-clear-context\` — fully done, nothing pending user confirmation (if anything is pending, use \`need-review\`)
- \`waiting-subordinates\` — boss waiting on delegated work

## End-of-Turn Order (canonical — every turn, no exceptions)
1. Finish all work and verification
2. End-of-turn curls, in this order: report-task (delegated tasks only) → notification (if applicable) → this tracking PATCH (always the LAST tool call)
3. Your final response text to the user — ALWAYS the last thing in the turn, AFTER all tool calls

**Never end a turn on a curl.** The curls update the board and ping the user; your written response is the answer they actually read. A turn that ends with tool calls and no response text shows the user an empty reply — that is a hard violation, even for one-word answers, questions, or refusals.`,
};
