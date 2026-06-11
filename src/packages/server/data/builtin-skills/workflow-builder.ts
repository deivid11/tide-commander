/**
 * Workflow Builder - Built-in Skill Definition
 * Provides agents with runtime context when executing workflow states.
 */

import type { BuiltinSkillDefinition } from './types.js';

export const workflowBuilder: BuiltinSkillDefinition = {
  slug: 'workflow-builder',
  name: 'Workflow Builder',
  description: 'Runtime context and API reference for agents executing workflow states',
  allowedTools: ['Bash(curl:*)'],
  content: `# Workflow Builder — Agent Execution Guide

When assigned a workflow state task, you receive context about the workflow instance, your current state, and available variables. Lifecycle: the engine enters your state and sends you a prompt → you execute the task with your assigned skills → you update workflow variables with results → you transition so the workflow moves to the next state.

All endpoints are on \`http://localhost:{{PORT}}\` and require \`-H "Content-Type: application/json" -H "X-Auth-Token: {{AUTH_TOKEN}}"\`. Example:

\`\`\`bash
curl -s -X PATCH "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/variables" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "variables": { "result_key": "result_value" }, "changedBy": "agent:YOUR_AGENT_ID" }'
\`\`\`

## Endpoints

- Update variables (store results for downstream states): \`PATCH /api/workflows/instances/INSTANCE_ID/variables\` — \`{ "variables": { "result_key": "result_value" }, "changedBy": "agent:YOUR_AGENT_ID" }\`
- Available transitions (valid next states; returns id, name, targetStateId, targetStateName, conditionType): \`GET /api/workflows/instances/INSTANCE_ID/available-transitions\`
- Transition to next state: \`PUT /api/workflows/instances/INSTANCE_ID/transition\` — \`{ "targetStateId": "TARGET_STATE_ID", "reason": "Why this transition was chosen" }\`
- Signal completion via event (legacy alternative): \`POST /api/workflows/instances/INSTANCE_ID/event\` — \`{ "eventType": "agent_complete", "data": { "agentResponse": "Summary of what was done" } }\`
- Read current variables and state: \`GET /api/workflows/instances/INSTANCE_ID\`
- Timeline (execution history, previous transitions): \`GET /api/workflows/instances/INSTANCE_ID/timeline\`
- Step logs (what previous agents did in earlier states): \`GET /api/workflows/instances/INSTANCE_ID/steps\`

## Variable Interpolation

Prompt templates reference variables with double braces: \`{{variable_name}}\`. The engine substitutes them before sending you the prompt.

## Common Patterns

- **Collect and Store / Generate and Forward / Notify and Complete**: use an assigned skill (e.g. slack-messaging, document-generator, email-gmail) → store results or output references (filename, URL, confirmation details) in variables → check available transitions → transition.
- **Decision Point**: evaluate current variables/task results → check available transitions for the different paths → choose the appropriate transition.

## Execution Rules

1. Update variables BEFORE transitioning — downstream states depend on your output
2. Transition explicitly: check available transitions, then PUT the target state
3. Use only the skills the workflow definition assigns
4. Execute the full task described in your prompt; do not skip steps
5. Handle errors gracefully — if a skill fails, transition to an error state or include error details
6. The transition \`reason\` should concisely summarize what you did and why

## Error Handling

If your task fails, check available transitions for an error/failure path and transition there: \`PUT /api/workflows/instances/INSTANCE_ID/transition\` — \`{ "targetStateId": "ERROR_STATE_ID", "reason": "FAILED: reason for failure" }\`. If no error transition exists, fall back to the event endpoint: \`POST /api/workflows/instances/INSTANCE_ID/event\` — \`{ "eventType": "agent_complete", "data": { "agentResponse": "FAILED: reason for failure", "error": true } }\`.
`,
};
