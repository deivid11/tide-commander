import type { BuiltinSkillDefinition } from './types.js';

export const agentMemory: BuiltinSkillDefinition = {
  slug: 'agent-memory',
  name: 'Agent Memory',
  description: 'Save important notes, lessons, preferences, and context to your persistent agent memory. Use proactively whenever you learn something worth remembering across conversations.',
  allowedTools: ['Bash(curl:*)'],
  assignedAgentClasses: [],
  content: `# Persistent Memory

Memory survives conversations and is injected under \`## Agent Memory (Your Notes To Yourself)\`.

- Read: \`GET /api/agents/YOUR_AGENT_ID/memory\`
- Replace: \`PATCH /api/agents/YOUR_AGENT_ID/memory\`
- Clear: \`DELETE /api/agents/YOUR_AGENT_ID/memory\`

PATCH fully replaces memory. Always read, merge, then write the complete value (unless initially empty):

\`\`\`json
{"memory":"## User preferences\\n- concise replies"}
\`\`\`

Save proactively only non-obvious facts useful in a future conversation: user preferences, corrections and lessons, project conventions, architectural decisions, or external references. Do not save temporary task state, debug output, git history, facts already in project instructions, or code structure/file paths that can be rediscovered.

Use short Markdown sections, prune stale notes, and stay under ~10 KB because memory is prompt overhead. Read it when relevant; current code always overrides stale memory.`,
};
