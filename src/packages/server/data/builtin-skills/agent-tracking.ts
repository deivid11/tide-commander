import type { BuiltinSkillDefinition } from './types.js';

export const agentTracking: BuiltinSkillDefinition = {
  slug: 'agent-tracking',
  name: 'Agent Tracking',
  description: 'Let agents keep tracking status updated through work completion',
  allowedTools: ['Bash(curl:*)'],
  assignedAgentClasses: ['*'],
  content: `# Agent Tracking Status (MANDATORY)

**Every turn MUST end with a tracking-status PATCH curl as your final tool call. No exceptions — not for tiny replies, not for questions, not for refusals. Skipping it leaves the user's board stuck on stale \`writing\` or \`working\`.**

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
- \`writing\` — the "thinking" state, set AUTOMATICALLY at the start of each turn by the Task Label skill. You normally do NOT set this yourself; the combined opening PATCH (taskLabel + trackingStatus:'writing') covers it. The UI shows an animated typing-dots indicator while in this state.
- \`working\` — longer-running work in progress; set this mid-turn if you want to clear the typing-dots indicator before you're fully done (e.g. a long build, a tight loop of edits). Optional.
- \`need-review\` — finished work awaiting user review (describe what)
- \`blocked\` — cannot proceed (say WHO/WHAT blocks you)
- \`can-clear-context\` — fully done, context safe to clear
- \`waiting-subordinates\` — boss agent waiting on delegated work

## Status Lifecycle Within a Turn
1. **Start of turn:** the Task Label skill sets \`writing\` (typing dots visible).
2. **During the turn:** the \`writing\` state persists until you replace it. You MAY optionally PATCH to \`working\` once you start doing real work (reads/edits/bash) if the turn is long — this swaps typing dots for the cyan working indicator.
3. **End of turn:** send the final tracking PATCH with the outcome status (\`need-review\`, \`blocked\`, \`can-clear-context\`, or \`waiting-subordinates\`). This replaces \`writing\`/\`working\` with the final state.

## Rules
- Detail ≤ 80 chars
- Tracking curl is the VERY LAST tool call — all user-facing text comes BEFORE it, nothing after
- Don't pick \`can-clear-context\` if anything still needs user confirmation — use \`need-review\`
- Do NOT manually set \`writing\` outside the opening PATCH from the Task Label skill — it's only for turn-start.

## Final Check Before Ending a Turn
1. Have I sent the PATCH this turn? If not — send now.
2. Is it my last tool call with no output after? If not — fix order.
3. Have I replaced the opening \`writing\` status with a meaningful final status? If not — do it now.`,
};
