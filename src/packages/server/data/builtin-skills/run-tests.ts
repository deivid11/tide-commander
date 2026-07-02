import type { BuiltinSkillDefinition } from './types.js';

export const runTests: BuiltinSkillDefinition = {
  slug: 'run-tests',
  name: 'Run Tests',
  description:
    'Detect, run, and read test suites (Java/Maven) via the Tide Commander tests API so results appear in the Test Results panel with parsed pass/fail/skip.',
  allowedTools: ['Bash(curl:*)'],
  // Not assigned to anyone by default — enable it per agent/class in the Skills panel.
  assignedAgentClasses: [],
  content: `# Run Tests

Run a project's test suite through \`/api/tests/*\` (not raw \`mvn\`) so the run streams live into the user's **Test Results** panel and comes back as a parsed suite/test tree (pass/fail/error/skip, per-test durations, stacktraces). Currently supports **Java / Maven** (JUnit surefire).

Use this when asked to run tests, check if tests pass, or re-run failures. For non-test long commands use the Streaming Command Execution skill instead.

All calls use the API Calling Convention scaffolding (host, \`-H "X-Auth-Token: ..."\`). No exclamation marks in commands.

## 1. Detect (optional)

Check whether a folder or a single test file is runnable:

\`POST /api/tests/detect\`
\`\`\`json
{"path":"/abs/path/to/folder-or-TestFile.java"}
\`\`\`
Returns \`{"testable":true,"runnerType":"maven","moduleRoot":"...","command":"mvn test"}\` (or \`{"testable":false}\`).

## 2. Run (returns immediately)

\`POST /api/tests/run\`
\`\`\`json
{"agentId":"YOUR_AGENT_ID","path":"/abs/path"}
\`\`\`
- \`agentId\` (recommended) — your agent ID from the system prompt. Pass it so the live mvn output streams inline in your terminal (like an exec task), not only in the panel.
- \`path\` — a project/module folder (runs the whole module) OR a single test file (runs just that class, \`mvn test -Dtest=<Class>\`).
- \`testFilter\` (optional) — Maven \`-Dtest=\` syntax to scope a subset, e.g. \`"ClassA#method1+method2,ClassB"\`. Use it to re-run only failed/errored tests.

Responds right away with \`{"success":true,"runId":"...","command":"..."}\`. The run continues in the background, streams live to your terminal, and streams to the Test Results panel.

## 3. Read results

Poll until the run finishes:

\`GET /api/tests/runs/RUN_ID\`
- \`404\` while still running (or unknown id) — wait ~3-6s and retry.
- \`200\` when done, with:
\`\`\`json
{"status":"passed|failed|error","exitCode":0,
 "result":{"totals":{"tests":868,"passed":844,"failures":10,"errors":4,"skipped":10},
           "suites":[{"name":"...","testcases":[{"name":"...","status":"failed","failureMessage":"...","failureDetail":"...stacktrace..."}]}]}}
\`\`\`
\`status\` is \`passed\` only when there are no failures/errors. Inspect \`result.suites[].testcases[]\` with \`status: failed|error\` for the message + stacktrace.

## 4. History

\`GET /api/tests/history?limit=50\` lists recent runs (newest first: runId, target, status, totals, timestamp) — use it to report on past runs.

## Rules
- Prefer a scoped run (single file or \`testFilter\`) when iterating on specific failures — it is much faster than the whole module.
- Report the totals and name the failing tests; for failures include the assertion message.
- A non-zero \`exitCode\` / \`failed\` status is a normal result to analyze, not an API error.`,
};
