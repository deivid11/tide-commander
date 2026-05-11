import type { BuiltinSkillDefinition } from './types.js';

export const agentMemory: BuiltinSkillDefinition = {
  slug: 'agent-memory',
  name: 'Agent Memory',
  description: 'Save important notes, lessons, preferences, and context to your persistent agent memory. Use proactively whenever you learn something worth remembering across conversations.',
  allowedTools: ['Bash(curl:*)'],
  assignedAgentClasses: ['*'],
  content: `# Agent Memory (Your Own Persistent Notes)

You have a **per-agent persistent memory string** that is automatically injected into your system prompt on every turn under the section \`## Agent Memory (Your Notes To Yourself)\`. It survives across conversations, restarts, and context resets. It is yours — only you (and the user via UI) edit it.

Use it to remember things that would otherwise be lost the next time your context is cleared.

## Endpoints

All endpoints are authenticated with the shared \`X-Auth-Token: abcd\` header (same as every other Tide Commander API).

\`\`\`bash
# Read your current memory
curl -s -H "X-Auth-Token: abcd" \\
  http://localhost:5174/api/agents/YOUR_AGENT_ID/memory

# Replace your memory (FULL REPLACE — see read-modify-write below)
curl -s -X PATCH -H "X-Auth-Token: abcd" \\
  http://localhost:5174/api/agents/YOUR_AGENT_ID/memory \\
  -H "Content-Type: application/json" \\
  -d @- <<'EOF'
{"memory": "## Project context\\n- foo\\n- bar\\n"}
EOF

# Clear your memory completely
curl -s -X DELETE -H "X-Auth-Token: abcd" \\
  http://localhost:5174/api/agents/YOUR_AGENT_ID/memory
\`\`\`

Substitute \`YOUR_AGENT_ID\` with the real agent ID from your identity block.

## When to write to memory

Save things that will still be useful **next conversation**, especially when they're not obvious from reading the code:

- **User preferences:** "User prefers terse responses with no trailing summaries"
- **Project facts:** "Backend uses Bun, not Node — \`npm run build\` is wrong, use \`bun run build\`"
- **Lessons from corrections:** "User got annoyed when I created new files for one-off scripts — prefer inline edits"
- **Useful debugging recipes:** "When tsc fails with TS2307 on .js extension, the file is in /src not /dist; build first"
- **External system references:** "Bugs tracked in Linear project 'INGEST'; deploy logs at grafana.internal/d/deploys"
- **Architectural decisions:** "Auth middleware was rewritten in v1.85 for compliance — do NOT re-introduce the old session-token pattern"

## When NOT to write to memory

- Code patterns / structure / file paths — re-derive with Grep
- Git history or recent diffs — \`git log\` is authoritative
- Things already in CLAUDE.md
- Temporary in-conversation state (current task, current todo list)
- Debug output, build errors, scratch logs

If removing a memory entry wouldn't confuse future-you, don't write it.

## CRITICAL: PATCH is a full replace — use read-modify-write

The PATCH endpoint overwrites your entire memory. You must:

1. **GET** the current memory first
2. **Merge** your new note into the existing content (don't blow it away)
3. **PATCH** the merged result back

Example flow:

\`\`\`bash
# 1. Read current memory
current=$(curl -s -H "X-Auth-Token: abcd" \\
  http://localhost:5174/api/agents/YOUR_AGENT_ID/memory | \\
  jq -r '.memory')

# 2. (You merge \$current with your new note in your head, then write it.)

# 3. Write merged result back
curl -s -X PATCH -H "X-Auth-Token: abcd" \\
  http://localhost:5174/api/agents/YOUR_AGENT_ID/memory \\
  -H "Content-Type: application/json" \\
  -d @- <<'EOF'
{"memory": "<the merged content here>"}
EOF
\`\`\`

If your memory is empty (first time), skip step 1 and just PATCH the new content.

## Suggested format — keep memory organized

Use a small set of markdown sections so the file stays scannable as it grows. A good starting structure:

\`\`\`markdown
## Project context
- The backend uses Bun, not Node.
- Frontend lives in src/packages/client.

## User preferences
- Terse responses, no trailing summaries.
- Always full project-relative paths.

## Lessons learned
- Don't run npm install — use bun install.
- The pre-commit hook will reject Co-Authored-By trailers.

## External references
- Linear project "INGEST" for pipeline bugs.
- Grafana board grafana.internal/d/api-latency for oncall.
\`\`\`

Add, rewrite, or prune sections as your understanding evolves. Outdated entries are worse than no entries — delete them when they no longer apply.

## Size limit

Keep total memory under **~10KB**. Memory is injected into every system prompt for this agent, so bloat = wasted context window on every turn. If you're approaching that, prune the least useful entries before adding new ones.

## When to use this skill proactively

You do **not** need the user to ask. If you observe:

- The user **corrects** you ("no, use X instead") — save the correction.
- The user **confirms** a non-obvious approach ("yes that was right") — save the validated approach.
- You discover a **project-specific fact** the codebase doesn't make obvious — save it.
- You learn an **external resource** location — save the pointer.

Read your memory at the start of any task where remembered context would change your approach — but trust **current code** over memory if the two conflict (memory can go stale; update or remove stale entries when you spot them).
`,
};
