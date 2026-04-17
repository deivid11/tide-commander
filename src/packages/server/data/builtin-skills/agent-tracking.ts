import type { BuiltinSkillDefinition } from './types.js';

export const agentTracking: BuiltinSkillDefinition = {
  slug: 'agent-tracking',
  name: 'Agent Tracking',
  description: 'Let agents keep tracking status updated through work completion',
  allowedTools: ['Bash(curl:*)'],
  assignedAgentClasses: ['*'],
  content: `# Agent Tracking Status (MANDATORY)

**Every turn MUST end with a tracking-status PATCH curl as your final tool call. No exceptions — not for tiny replies, not for questions, not for refusals. Skipping it leaves the user's board stuck on stale \`working\`.**

## When to Call
- After finishing ANY reply (one-word answers included)
- The moment you get blocked
- Immediately when your situation changes (e.g. after delegating → \`waiting-subordinates\`)

## Endpoint

\`PATCH /api/agents/YOUR_AGENT_ID\`

**Body:**
\`\`\`json
{"trackingStatus":"STATUS","trackingStatusDetail":"SHORT_DESCRIPTION"}
\`\`\`

## Statuses
- \`need-review\` — finished work awaiting user review (describe what)
- \`blocked\` — cannot proceed (say WHO/WHAT blocks you)
- \`can-clear-context\` — fully done, context safe to clear
- \`waiting-subordinates\` — boss agent waiting on delegated work
- \`working\` — set automatically; do not set manually

## Rules
- Detail ≤ 80 chars
- Tracking curl is the VERY LAST tool call — all user-facing text comes BEFORE it, nothing after
- Don't pick \`can-clear-context\` if anything still needs user confirmation — use \`need-review\`

## Final Check Before Ending a Turn
1. Have I sent the PATCH this turn? If not — send now.
2. Is it my last tool call with no output after? If not — fix order.`,
};
