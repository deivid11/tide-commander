import type { BuiltinSkillDefinition } from './types.js';

export const streamingExec: BuiltinSkillDefinition = {
  slug: 'streaming-exec',
  name: 'Streaming Command Execution',
  description: 'Execute long-running commands with real-time output streaming to the terminal',
  allowedTools: ['Bash(curl:*)'],
  content: `# Streaming Command Execution

Use this endpoint for commands that are long-running, noisy, or operationally important so users can see live progress in the terminal.

## When to Use Streaming Exec

Use \`/api/exec\` for commands like:
- Build commands (\`npm run build\`, \`cargo build\`, \`make\`)
- Test suites (\`npm test\`, \`pytest\`, \`jest\`)
- Development servers (\`npm run dev\`, \`bun run dev\`)
- Package installations (\`npm install\`, \`pip install\`)
- Docker and container commands (\`docker build\`, \`docker compose up\`, \`docker logs\`)
- Long git/network operations (\`git clone\`, \`git fetch\`, \`git push\`)
- Any command expected to run longer than a couple seconds

## When Not to Use Streaming Exec

For near-instant local commands, run them directly with normal shell tools. Examples:
- Fast reads/searches (\`cat\`, \`grep\`, \`rg\`, \`sed\`, \`head\`, \`tail\`)
- Quick filesystem checks (\`ls\`, \`pwd\`, \`stat\`)
- Short git inspection (\`git status\`, \`git diff\`, \`git log -n 5\`)

Rule of thumb: if it is effectively instant and only used for quick inspection, do not route it through \`/api/exec\`.

## Endpoint

\`POST /api/exec\`

**Body shape:**
\`\`\`json
{"agentId":"YOUR_AGENT_ID","command":"YOUR_COMMAND"}
\`\`\`

## Parameters

- \`agentId\`: Your agent ID from the system prompt (required)
- \`command\`: The shell command to execute (required)
- \`cwd\`: Working directory (optional, defaults to your current directory)

## Examples (body only — wrap with the scaffolding from the API Calling Convention above)

- **Build project:** \`{"agentId":"YOUR_AGENT_ID","command":"npm run build"}\`
- **Run tests:** \`{"agentId":"YOUR_AGENT_ID","command":"npm test"}\`
- **Install dependencies:** \`{"agentId":"YOUR_AGENT_ID","command":"npm install"}\`
- **Start dev server (with timeout):** \`{"agentId":"YOUR_AGENT_ID","command":"timeout 30 npm run dev"}\`

## Response Format

The endpoint returns JSON when the command completes:
\`\`\`json
{
  "success": true,
  "taskId": "abc123",
  "exitCode": 0,
  "output": "Full command output...",
  "duration": 12345
}
\`\`\`

\`success\` is always \`true\` if the command executed (even with non-zero exit code).
Check \`exitCode\` to determine if the command itself passed (0) or failed (non-zero).
A non-zero exit code (e.g. test failures) is a normal result you should analyze, not an error.

## Important Notes

1. The user will see streaming output in the terminal "Running Tasks" section
2. You will receive the final output when the command completes
3. Use \`timeout\` command wrapper for commands that run indefinitely (like dev servers)
4. The command runs in your agent's working directory by default
5. Non-zero exit codes mean the command failed (e.g. test failures), not the API. Always check \`output\` to understand what happened`,
};
