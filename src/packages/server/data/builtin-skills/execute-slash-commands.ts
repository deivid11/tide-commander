import type { BuiltinSkillDefinition } from './types.js';

export const executeSlashCommands: BuiltinSkillDefinition = {
  slug: 'execute-slash-commands',
  name: 'Execute Slash Commands',
  description: 'Discover and invoke Commander plugin and user-script slash commands without an LLM hop',
  allowedTools: ['Bash(curl:*)'],
  content: `# Execute Tide Commander Slash Commands

Slash commands are local Commander capabilities. Discover the current enabled catalog before invoking one:

\`GET /api/plugins/slash-commands\`

Use the normal Tide API convention: authenticated requests to the Commander base URL with your own agent ID.

For an entry with \`kind: "plugin"\`, POST its published \`endpoint\`. Include the invocation and arguments so the plugin receives the same context as a user-entered slash command:

\`\`\`json
{"agentId":"YOUR_AGENT_ID","rawCommand":"/tasks project-a","argsText":"project-a","args":["project-a"]}
\`\`\`

For an entry with \`kind: "shell"\`, execute it through the streamed exec API. Arguments are a JSON array and become Bash \`$1\`, \`$2\`, etc. Never concatenate or reinterpret them yourself:

\`\`\`json
{"agentId":"YOUR_AGENT_ID","shellCommandId":"COMMAND_ID","shellArgs":["staging"]}
\`\`\`

POST that body to \`/api/exec\`. The command streams in the terminal like any other exec task. Check the final \`exitCode\`.

If \`requiresSudo\` is true, do not ask for, accept, read, or transmit the user's password. Sudo slash commands require the Commander's interactive password modal and must be launched by the user. Explain that limitation and identify the slash command they should run.

Do not invent slash commands or call disabled commands. Prefer the canonical \`name\` from the discovery response.`,
};
