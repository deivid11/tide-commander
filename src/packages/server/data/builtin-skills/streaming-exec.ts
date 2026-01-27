import type { BuiltinSkillDefinition } from './types.js';

export const streamingExec: BuiltinSkillDefinition = {
  slug: 'streaming-exec',
  name: 'Streaming Command Execution',
  description: 'Execute long-running commands with real-time output streaming to the terminal',
  allowedTools: ['Bash(curl:*)'],
  content: `# Streaming Command Execution

For **long-running commands** that produce ongoing output (builds, tests, dev servers, installations), use the streaming exec endpoint instead of running them directly. This streams output to the terminal in real-time so you and the user can monitor progress.

## When to Use Streaming Exec

Use streaming exec for:
- Build commands (\`npm run build\`, \`cargo build\`, \`make\`)
- Test suites (\`npm test\`, \`pytest\`, \`jest\`)
- Development servers (\`npm run dev\`, \`bun run dev\`)
- Package installations (\`npm install\`, \`pip install\`)
- Long compilation tasks
- Any command expected to run more than 5-10 seconds

**Do NOT use** for quick commands like:
- \`ls\`, \`cat\`, \`pwd\`, \`git status\`
- Simple file operations
- Quick checks that return immediately

## Command Format

\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"YOUR_COMMAND"}'
\`\`\`

## Parameters

- \`agentId\`: Your agent ID from the system prompt (required)
- \`command\`: The shell command to execute (required)
- \`cwd\`: Working directory (optional, defaults to your current directory)

## Examples

**Build project:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"npm run build"}'
\`\`\`

**Run tests:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"npm test"}'
\`\`\`

**Install dependencies:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"npm install"}'
\`\`\`

**Start dev server (in background):**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/exec \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"YOUR_AGENT_ID","command":"timeout 30 npm run dev"}'
\`\`\`

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

## Important Notes

1. Replace \`YOUR_AGENT_ID\` with your actual agent ID from the system prompt
2. The user will see streaming output in the terminal "Running Tasks" section
3. You will receive the final output when the command completes
4. Use \`timeout\` command wrapper for commands that run indefinitely (like dev servers)
5. The command runs in your agent's working directory by default`,
};
