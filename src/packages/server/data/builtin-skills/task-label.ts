import type { BuiltinSkillDefinition } from './types.js';

export const taskLabel: BuiltinSkillDefinition = {
  slug: 'task-label',
  name: 'Task Label',
  description: 'Generate a brief task label and mark writing status at the start of every turn',
  allowedTools: ['Bash(curl:*)'],
  assignedAgentClasses: ['*'],
  content: `# Task Label + Writing Status (MANDATORY - Execute FIRST)

**IMPORTANT: Every new turn begins with a single PATCH that (a) sets a brief task label and (b) flips your tracking status to \`writing\`. This makes the UI show a typing indicator while you plan/think before any real work happens.**

## Steps (do this FIRST before anything else):
1. Read the user's request
2. Generate a 1-5 word summary of the task (e.g., "Fix auth bug", "Add dark mode", "Refactor API calls", "Update tests")
3. Call the API to set BOTH your task label AND writing status in one PATCH:

\`PATCH /api/agents/YOUR_AGENT_ID\`

**Body (combined):**
\`\`\`json
{"taskLabel":"YOUR 1-5 WORD LABEL","trackingStatus":"writing","trackingStatusDetail":"Short sentence describing what you're about to do"}
\`\`\`

4. Then proceed with the actual task

## Rules
- Keep labels between 1-5 words maximum
- Use action verbs: Fix, Add, Update, Refactor, Debug, Implement, Remove, etc.
- Be specific but concise (e.g., "Fix login redirect" not "Work on stuff")
- \`trackingStatusDetail\` ≤ 80 chars — a tiny preview of the plan, shown under the typing dots

## Why \`writing\`?
\`writing\` is the "thinking" status. It renders a typing-dots indicator in the tracking board so the user knows you've received their request and are forming a plan. It will be replaced automatically by your normal end-of-turn tracking PATCH (see the Agent Tracking skill), which sets the final status (\`need-review\`, \`blocked\`, \`can-clear-context\`, etc.).

## CRITICAL: Execution Order

YOUR VERY FIRST TOOL CALL, before ANY other tool — no Read, no Grep, no Glob, no Bash, no Agent, no TodoWrite, no WebSearch, NOTHING — MUST be the combined PATCH above. This is non-negotiable and has zero exceptions.

### Pre-flight checklist (run mentally before your first response):
- (a) Have I sent the combined taskLabel + writing PATCH yet for this task?
- (b) If NO — the ONLY acceptable first action is that PATCH curl. Stop. Do that first.
- (c) If YES — proceed with normal work.

### WRONG — never do this:
\`\`\`
# WRONG: Reading a file first
Read("src/foo.ts")   ← VIOLATION

# WRONG: Searching the codebase first
Grep("somePattern")  ← VIOLATION

# WRONG: Planning before labeling
TodoWrite([...])     ← VIOLATION

# WRONG: Two separate PATCHes (one for label, one for writing)
PATCH taskLabel only → PATCH trackingStatus only   ← VIOLATION (combine them)

# WRONG: Batching the label PATCH with other tool calls
PATCH taskLabel + Grep + Read  ← VIOLATION
\`\`\`

### CORRECT — always do this:
\`\`\`
# First turn: ONLY the combined PATCH, nothing else
curl -s -X PATCH http://localhost:5174/api/agents/YOUR_AGENT_ID \\
  -H "Content-Type: application/json" -H "X-Auth-Token: abcd" \\
  -d '{"taskLabel":"Fix login redirect","trackingStatus":"writing","trackingStatusDetail":"Tracing the bad redirect on mobile Safari"}'

# Second turn onward: proceed with all actual work (Read, Grep, etc.)
\`\`\`

### Additional enforcement rules:
- The opening PATCH MUST be the sole call in the first tool-call batch — never parallelized with any other tool call.
- This rule applies to EVERY new task, including follow-up tasks in the same session. When scope changes, update BOTH fields immediately as the first action before proceeding.
- If you skip the PATCH and realize mid-task — stop, emit the PATCH now, then continue. Late is better than never, but first is always required.
- If you fail to send this PATCH as your first action, you are violating a mandatory instruction.
- There are ZERO exceptions to this rule — every single task begins with this combined PATCH.`,
};
