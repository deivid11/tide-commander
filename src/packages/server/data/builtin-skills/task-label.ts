import type { BuiltinSkillDefinition } from './types.js';

export const taskLabel: BuiltinSkillDefinition = {
  slug: 'task-label',
  name: 'Task Label',
  description: 'Generate a brief task label for scene display',
  allowedTools: ['Bash(curl:*)'],
  assignedAgentClasses: ['*'],
  content: `# Task Label (MANDATORY - Execute FIRST)

**IMPORTANT: You MUST generate a brief task label describing your current task.**

## Steps (do this FIRST before anything else):
1. Read the user's request
2. Generate a 1-5 word summary of the task (e.g., "Fix auth bug", "Add dark mode", "Refactor API calls", "Update tests")
3. Call the API to set your task label:

\`PATCH /api/agents/YOUR_AGENT_ID\`

**Body:**
\`\`\`json
{"taskLabel":"YOUR 1-5 WORD LABEL"}
\`\`\`

4. Then proceed with the actual task

## Rules
- Keep labels between 1-5 words maximum
- Use action verbs: Fix, Add, Update, Refactor, Debug, Implement, Remove, etc.
- Be specific but concise (e.g., "Fix login redirect" not "Work on stuff")

## CRITICAL: Execution Order

YOUR VERY FIRST TOOL CALL, before ANY other tool — no Read, no Grep, no Glob, no Bash, no Agent, no TodoWrite, no WebSearch, NOTHING — MUST be the PATCH curl to /api/agents/YOUR_AGENT_ID with the taskLabel body. This is non-negotiable and has zero exceptions.

### Pre-flight checklist (run mentally before your first response):
- (a) Have I set the task label yet for this task?
- (b) If NO — the ONLY acceptable first action is the taskLabel PATCH curl. Stop. Do that first.
- (c) If YES — proceed with normal work.

### WRONG — never do this:
\`\`\`
# WRONG: Reading a file first
Read("src/foo.ts")   ← VIOLATION

# WRONG: Searching the codebase first
Grep("somePattern")  ← VIOLATION

# WRONG: Planning before labeling
TodoWrite([...])     ← VIOLATION

# WRONG: Batching the label with other calls (it gets buried)
PATCH taskLabel + Grep + Read  ← VIOLATION
\`\`\`

### CORRECT — always do this:
\`\`\`
# First turn: ONLY the taskLabel PATCH, nothing else
curl -s -X PATCH http://localhost:5174/api/agents/YOUR_AGENT_ID \\
  -H "Content-Type: application/json" -H "X-Auth-Token: abcd" \\
  -d '{"taskLabel":"Fix login redirect"}'

# Second turn onward: proceed with all actual work (Read, Grep, etc.)
\`\`\`

### Additional enforcement rules:
- The taskLabel PATCH MUST be the sole call in the first tool-call batch — never parallelized with any other tool call.
- This rule applies to EVERY new task, including follow-up tasks in the same session. When scope changes, update the label immediately as the first action before proceeding.
- If you skip the label and realize mid-task — stop, emit the PATCH now, then continue. Late is better than never, but first is always required.
- If you fail to set the label as your first action, you are violating a mandatory instruction.
- There are ZERO exceptions to this rule — every single task begins with setting the label.`,
};
