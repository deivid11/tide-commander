import type { BuiltinSkillDefinition } from './types.js';

export const streamingExec: BuiltinSkillDefinition = {
  slug: 'streaming-exec',
  name: 'Streaming Command Execution',
  description: 'Execute long-running commands with real-time output streaming to the terminal',
  allowedTools: ['Bash(curl:*)'],
  content: `# Streaming Command Execution

**MANDATORY: ALL shell commands MUST be executed through this streaming exec endpoint.** Do NOT use the Bash tool directly for any command execution. Every command, regardless of how quick or simple, must go through the exec API so the user can see all command output in the terminal.

## When to Use Streaming Exec

**ALWAYS.** Every shell command must use this endpoint, including but not limited to:
- Build commands (\`npm run build\`, \`cargo build\`, \`make\`)
- Test suites (\`npm test\`, \`pytest\`, \`jest\`)
- Development servers (\`npm run dev\`, \`bun run dev\`)
- Package installations (\`npm install\`, \`pip install\`)
- Git commands (\`git status\`, \`git diff\`, \`git log\`, \`git commit\`)
- File operations (\`ls\`, \`cat\`, \`pwd\`, \`mkdir\`, \`cp\`, \`mv\`)
- Quick checks and diagnostics
- Any and all shell commands without exception

**There are NO exceptions.** Never run commands directly through the Bash tool. Always route through the exec endpoint.

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
