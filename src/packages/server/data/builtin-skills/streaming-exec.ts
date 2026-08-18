import type { BuiltinSkillDefinition } from './types.js';

export const streamingExec: BuiltinSkillDefinition = {
  slug: 'streaming-exec',
  name: 'Streaming Command Execution',
  description: 'Execute long-running commands with real-time output streaming to the terminal',
  allowedTools: ['Bash(curl:*)'],
  content: `# Streaming Execution (MANDATORY)

Anything that RUNS A PROGRAM or can take more than ~2 s goes through \`POST /api/exec\` — never directly through Bash. That includes builds, tests, installs, dev servers, containers, downloads, \`git clone/pull/push\`, model/media binaries, and any \`sleep\`, polling loop, or \`timeout\` wrapper. Direct Bash is only for instant inspection: \`ls\`, \`cat\`, \`rg\`/\`grep\`, \`sed -n\`, \`git status\`/\`diff\`/short \`log\`, quick Commander API curls, one-liners (\`node -e\`, \`python3 -c\`).

\`\`\`json
{"agentId":"YOUR_AGENT_ID","command":"npm run build","cwd":"/optional/path","tail":30,"pty":true}
\`\`\`

Required: \`agentId\`, \`command\`. Optional: \`cwd\` (defaults to the agent's directory), \`tail\` (limits only the API response; the user's live card keeps ALL output), \`pty\` (default true; false only for commands that misbehave under a TTY). Wrap indefinite commands with \`timeout\` (\`timeout 30 npm run dev\`).

Pipes that are part of the command's logic (\`| grep\`, \`| sort | uniq -c | head -8\`) are fine. What is forbidden is appending \`| tail\`/\`| head\`/redirection merely to shrink what comes back — buffering hides live progress; use the \`tail\` field instead.

The response contains \`taskId\`, \`exitCode\`, \`output\`, \`duration\`. \`success\` means execution started, not that the command passed — judge by \`exitCode\`. With \`tail\`, \`tailApplied\`/\`fullOutputBytes\` describe truncation.

Claude agents: a guard DENIES direct long-running Bash calls and returns the exact \`/api/exec\` curl for that command — re-issue it through the API, don't retry directly.`,
};
