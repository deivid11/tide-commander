import type { BuiltinSkillDefinition } from './types.js';

export const streamingExec: BuiltinSkillDefinition = {
  slug: 'streaming-exec',
  name: 'Streaming Command Execution',
  description: 'Execute long-running commands with real-time output streaming to the terminal',
  allowedTools: ['Bash(curl:*)'],
  content: `# Streaming Command Execution

Route long-running, noisy, or operationally important commands through \`POST /api/exec\` so the user sees live progress in the terminal "Running Tasks" section; you receive the full output when the command completes.

**Use for:** builds (\`npm run build\`, \`cargo build\`, \`make\`), test suites (\`npm test\`, \`pytest\`, \`jest\`), dev servers (\`npm run dev\`, \`bun run dev\`), package installs (\`npm install\`, \`pip install\`), docker/container commands (\`docker build\`, \`docker compose up\`, \`docker logs\`), long git/network ops (\`git clone\`, \`git fetch\`, \`git push\`) — anything expected to run longer than a couple seconds.

**Don't use for:** near-instant inspection commands (\`cat\`, \`grep\`, \`rg\`, \`sed\`, \`head\`, \`tail\`, \`ls\`, \`pwd\`, \`stat\`, \`git status\`, \`git diff\`, \`git log -n 5\`) — run those directly with normal shell tools.

## Request

Body only — wrap with the scaffolding from the API Calling Convention above:

\`\`\`json
{"agentId":"YOUR_AGENT_ID","command":"npm run build"}
\`\`\`

- \`agentId\` (required): your agent ID from the system prompt
- \`command\` (required): the shell command to execute
- \`cwd\` (optional): working directory; defaults to your agent's current directory

Wrap indefinitely-running commands (like dev servers) with \`timeout\`: \`{"agentId":"YOUR_AGENT_ID","command":"timeout 30 npm run dev"}\`

## Response (JSON, returned when the command completes)

\`\`\`json
{"success": true, "taskId": "abc123", "exitCode": 0, "output": "Full command output...", "duration": 12345}
\`\`\`

\`success\` is \`true\` whenever the command executed, even with a non-zero exit code. A non-zero \`exitCode\` means the command itself failed (e.g. test failures) — a normal result to analyze via \`output\`, not an API error.`,
};
