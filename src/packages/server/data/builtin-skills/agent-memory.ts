import type { BuiltinSkillDefinition } from './types.js';

export const agentMemory: BuiltinSkillDefinition = {
  slug: 'agent-memory',
  name: 'Agent Memory',
  description: 'Save important notes, lessons, preferences, and context to your persistent agent memory. Use proactively whenever you learn something worth remembering across conversations.',
  allowedTools: ['Bash(curl:*)'],
  assignedAgentClasses: [],
  content: `# Agent Memory (Your Own Persistent Notes)

A per-agent persistent memory string is injected into your system prompt every turn under \`## Agent Memory (Your Notes To Yourself)\`. It survives conversations, restarts, and context resets; only you (and the user via UI) edit it.

## Endpoints

All authenticated with the shared \`X-Auth-Token: abcd\` header (same as every other Tide Commander API). Substitute \`YOUR_AGENT_ID\` with the real agent ID from your identity block.

\`\`\`bash
# Read
curl -s -H "X-Auth-Token: abcd" http://localhost:5174/api/agents/YOUR_AGENT_ID/memory

# Replace (FULL REPLACE — see below)
curl -s -X PATCH -H "X-Auth-Token: abcd" \\
  http://localhost:5174/api/agents/YOUR_AGENT_ID/memory \\
  -H "Content-Type: application/json" \\
  -d @- <<'EOF'
{"memory": "## Project context\\n- foo\\n- bar\\n"}
EOF

# Clear
curl -s -X DELETE -H "X-Auth-Token: abcd" http://localhost:5174/api/agents/YOUR_AGENT_ID/memory
\`\`\`

## PATCH is a full replace — use read-modify-write

1. GET current memory (\`... /memory | jq -r '.memory'\`)
2. Merge your new note into the existing content — don't blow it away
3. PATCH the merged result back

If memory is empty (first time), skip the GET and just PATCH.

## What to save

Things still useful **next conversation** that aren't obvious from reading the code:
- User preferences ("terse responses, no trailing summaries")
- Project facts ("backend uses Bun — use \`bun run build\`, not npm")
- Lessons from corrections; useful debugging recipes
- External references (issue trackers, dashboards, log locations)
- Architectural decisions ("auth middleware rewritten in v1.85 — don't re-introduce the old session-token pattern")

Do NOT save: code patterns/structure/file paths (re-derive with Grep), git history (\`git log\` is authoritative), things already in CLAUDE.md, temporary in-conversation state (current task/todos), debug output or scratch logs. If removing an entry wouldn't confuse future-you, don't write it.

## Format and size

Organize as a few markdown sections, e.g. \`## Project context\`, \`## User preferences\`, \`## Lessons learned\`, \`## External references\` — add, rewrite, or prune sections as understanding evolves. Outdated entries are worse than none; delete them. Keep total under **~10KB**: memory is injected into every system prompt, so bloat wastes context each turn — prune the least useful entries before adding new ones.

## Proactive use

Don't wait for the user to ask. Save when: the user corrects you ("no, use X instead"); the user confirms a non-obvious approach; you discover a project-specific fact the codebase doesn't make obvious; you learn an external resource location.

Read your memory at the start of any task where remembered context would change your approach, but trust current code over memory if they conflict — update or remove stale entries when you spot them.
`,
};
