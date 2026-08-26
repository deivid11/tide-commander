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

The built-in plugin command \`/execute-sudo-command\` accepts an executable and literal argv values:

\`\`\`json
{"agentId":"YOUR_AGENT_ID","args":["touch","/opt/test"]}
\`\`\`

POST it to the plugin endpoint published by the catalog. Do not prepend \`sudo\`; Commander adds elevation only after private user authorization. The HTTP response is a safe acknowledgement and never includes a password or authorization id. Tell the user Commander is waiting for authorization. After authorization, output streams normally and Commander sends a \`COMMANDER_SLASH_COMMAND_RESULT\` callback. Shell operators are not interpreted; if a pipeline is truly required, request explicit argv such as \`["sh","-c","command | other"]\` so the exact shell invocation is visible before authorization.

For an entry with \`kind: "shell"\`, execute it through the streamed exec API. Arguments are a JSON array and become Bash \`$1\`, \`$2\`, etc. Never concatenate or reinterpret them yourself:

\`\`\`json
{"agentId":"YOUR_AGENT_ID","shellCommandId":"COMMAND_ID","shellArgs":["staging"]}
\`\`\`

POST that body to \`/api/exec\`. Non-sudo commands stream in the terminal like any other exec task; check the final \`exitCode\`.

To read a running slash stream, \`GET /api/exec/tasks/YOUR_AGENT_ID\`, match \`command\`/\`startedAt\`, then GET its \`outputEndpoint\` (\`.../TASK_ID/output?tail=200\`; optional literal \`grep\`). To stop it when asked, HTTP \`DELETE\` its \`cancelEndpoint\`. Never guess IDs, cancel another agent's task, or rerun after \`status: "cancelling"\`.

For bounded result context, add structured top-level output filters to the JSON body: \`"grep":"literal text"\` filters matching lines, then \`"tail":10\` keeps the final matching lines. These filters affect only the HTTP result or completion callback; the user still sees the complete live stream. Never place \`| grep\`, \`| tail\`, or other shell syntax in \`shellArgs\`: arguments remain literal positional values and are never evaluated.

If \`requiresSudo\` is true, submit the same \`/api/exec\` body without a sudo authorization. A successful \`202\` response with \`awaitingUserAuthorization: true\` means Commander rendered a secure password component directly in the agent conversation. Tell the user that authorization is waiting in Commander; after they submit it, Commander launches the command and streams its output automatically. When execution finishes, Commander invokes you again with a bounded \`COMMANDER_SLASH_COMMAND_RESULT\` message containing the exit code and the requested filtered output. Review that result, report it to the user, and never rerun the command automatically.

Never ask for, accept, read, or transmit the user's sudo password. Never add a password, authorization ID, or guessed credential to the request. The browser component and Commander server own the entire authorization handoff.

Do not invent slash commands or call disabled commands. Prefer the canonical \`name\` from the discovery response.`,
};
