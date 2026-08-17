import type { BuiltinSkillDefinition } from './types.js';

export const streamingExec: BuiltinSkillDefinition = {
  slug: 'streaming-exec',
  name: 'Streaming Command Execution',
  description: 'Execute long-running commands with real-time output streaming to the terminal',
  allowedTools: ['Bash(curl:*)'],
  content: `# Streaming Execution (MANDATORY)

Run builds, test suites, installs, dev servers, containers, long git/network operations, and any noisy or multi-second command through \`POST /api/exec\`. Never run them directly with Bash or another shell tool. Direct shell is only for near-instant inspection such as \`rg\`, \`ls\`, \`git status\`, \`git diff\`, or a short \`git log\`.

\`\`\`json
{"agentId":"YOUR_AGENT_ID","command":"npm run build","cwd":"/optional/path","tail":30,"pty":true}
\`\`\`

Required: \`agentId\`, \`command\`. Optional:
- \`cwd\` defaults to the agent's directory
- \`tail\` limits only the API response; the user's live card still gets all output
- \`pty\` defaults to \`true\`; use \`false\` only for commands that misbehave under a TTY

Never add \`| tail\`, \`| head\`, or output redirection merely to reduce returned output; buffering hides live progress. Use the \`tail\` field. Wrap indefinite commands with \`timeout\` (for example, \`timeout 30 npm run dev\`).

The response contains \`taskId\`, \`exitCode\`, \`output\`, and \`duration\`. \`success\` means execution started, not that the command passed; judge the command by \`exitCode\`. With \`tail\`, \`tailApplied\` and \`fullOutputBytes\` describe truncation.`,
};
