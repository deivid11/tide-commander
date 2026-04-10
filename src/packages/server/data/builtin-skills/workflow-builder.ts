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

When you are assigned a workflow state task, you receive context about the workflow instance,
your current state, available variables, and the API endpoints to interact with the workflow engine.

## Workflow Execution Lifecycle

1. The workflow engine enters your state and sends you a prompt
2. You execute your task using the assigned skills
3. You update workflow variables with your results
4. You signal completion so the workflow transitions to the next state

## Update Variables

Store your results in workflow variables so downstream states can use them:

\`\`\`bash
curl -s -X PATCH "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/variables" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "variables": { "result_key": "result_value" }, "changedBy": "agent:YOUR_AGENT_ID" }'
\`\`\`

## Check Available Transitions

Before transitioning, see which next states are valid:

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/available-transitions"
\`\`\`

Returns a list of transitions with id, name, targetStateId, targetStateName, and conditionType.

## Transition to Next State

After finishing your task, explicitly move the workflow to the next state:

\`\`\`bash
curl -s -X PUT "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/transition" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "targetStateId": "TARGET_STATE_ID", "reason": "Why this transition was chosen" }'
\`\`\`

## Signal Completion (Legacy)

Alternatively, signal the workflow engine with an event:

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/event" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "eventType": "agent_complete", "data": { "agentResponse": "Summary of what was done" } }'
\`\`\`

## Read Current Variables

Check the current state of all workflow variables:

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID"
\`\`\`

## Read Instance Timeline

See execution history and previous state transitions:

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/timeline"
\`\`\`

## Read Step Logs

See what previous agents did in earlier states:

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/steps"
\`\`\`

## Variable Interpolation

In prompt templates, variables are referenced with double braces: \`{{variable_name}}\`.
The workflow engine substitutes these before sending you the prompt.

## Common Patterns

### Pattern: Collect and Store
1. Use a skill (e.g. slack-messaging) to gather information
2. Update variables with the collected data
3. Check available transitions, then transition to the next state

### Pattern: Generate and Forward
1. Use a skill (e.g. document-generator) to create output
2. Store the output reference (filename, URL) in variables
3. Transition to the next state so it can use the output

### Pattern: Notify and Complete
1. Use a skill (e.g. email-gmail, slack-messaging) to send a notification
2. Store confirmation details in variables
3. Transition to the next state

### Pattern: Decision Point
1. Evaluate current variables or task results
2. Check available transitions for the different paths
3. Choose the appropriate transition based on your decision

## Execution Rules

1. **Always update variables BEFORE transitioning** — downstream states depend on your output
2. **Always transition explicitly** — check available transitions, then PUT the target state
3. **Use only assigned skills** — the workflow definition specifies which skills you should use
4. **Do not skip steps** — execute the full task described in your prompt
5. **Handle errors gracefully** — if a skill fails, transition to an error state or include error details
6. **Be concise** — the reason in your transition should summarize what you did and why

## Error Handling

If your task fails, check available transitions for an error/failure path and transition there:

\`\`\`bash
# Check for error transitions
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/available-transitions"

# Transition to the error state
curl -s -X PUT "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/transition" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "targetStateId": "ERROR_STATE_ID", "reason": "FAILED: reason for failure" }'
\`\`\`

If no error transition exists, use the event-based completion as fallback:

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/event" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "eventType": "agent_complete", "data": { "agentResponse": "FAILED: reason for failure", "error": true } }'
\`\`\`
`,
};
