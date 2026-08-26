import type { BuiltinSkillDefinition } from './types.js';

export const streamingExec: BuiltinSkillDefinition = {
  slug: 'streaming-exec',
  name: 'Streaming Command Execution',
  description: 'Execute long-running commands with real-time output streaming to the terminal',
  allowedTools: ['Bash(curl:*)'],
  content: `# Streaming Execution (via POST /api/exec)

The user is WATCHING a live terminal. A long command through plain Bash shows them a frozen spinner and nothing else until it ends; the SAME command through \`POST /api/exec\` paints a live card — output streaming in real time, status, duration, a re-run button. You lose nothing (the response carries the full result), the user gains everything. Make it your default reflex.

RULE: anything that RUNS A PROGRAM or can take more than ~2 s goes through /api/exec — builds, tests, installs, dev servers, containers, downloads, \`git clone/pull/push\`, model/media binaries, any \`sleep\`, polling loop or \`timeout\` wrapper. Direct Bash only for instant inspection: \`ls\`, \`cat\`, \`rg\`, \`sed -n\`, \`git status\`/\`diff\`, quick API curls, one-liners.

\`\`\`json
{"agentId":"YOUR_AGENT_ID","command":"npm run build","cwd":"/optional/path","tail":30,"pty":true}
\`\`\`

Required: \`agentId\`, \`command\`. Optional: \`cwd\` (defaults to your agent dir), \`tail\` (trims only the API response — the live card keeps ALL output, so use it freely instead of appending \`| tail\`/\`| head\`, which would hide live progress), \`pty\` (default true). Wrap indefinite commands with \`timeout\` (\`timeout 30 npm run dev\`). Pipes that belong to the command's logic (\`| grep\`, \`| wc -l\`) are fine.

Response: \`taskId\`, \`exitCode\`, \`output\`, \`duration\` — judge by \`exitCode\` (\`success\` only means it started).

## Read/cancel an active stream

At any time, list your running tasks with \`GET /api/exec/tasks/YOUR_AGENT_ID\`. Match by \`command\`/\`startedAt\`—never guess IDs. Read current ANSI-free output through the item's \`outputEndpoint\`: \`GET /api/exec/tasks/YOUR_AGENT_ID/TASK_ID/output?tail=200\` (optional literal \`grep\`). Check \`status\`, \`duration\`, \`output\`, and final \`exitCode\`.

If the user asks to stop it, \`DELETE\` the item's \`cancelEndpoint\` (\`/api/exec/tasks/YOUR_AGENT_ID/TASK_ID\`). Cancel only your confirmed task; \`status: "cancelling"\` means accepted. Never rerun it automatically.

When in doubt, prefer /api/exec: it costs you nothing, and every silent long Bash call is a spinner the user stares at. Caught yourself running something long directly? Route the next one through the API.`,
};
