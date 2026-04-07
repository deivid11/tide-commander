/**
 * Workflow Designer - Built-in Skill Definition
 * Provides agents with curl-based instructions for creating, editing,
 * and managing workflow definitions and their instances.
 */

import type { BuiltinSkillDefinition } from './types.js';

export const workflowDesigner: BuiltinSkillDefinition = {
  slug: 'workflow-designer',
  name: 'Workflow Designer',
  description: 'Create, edit, and manage workflow definitions and their 3D models in the work area',
  allowedTools: ['Bash(curl:*)'],
  content: `# Workflow Designer

You can create and manage workflow definitions. Workflows are state machines that automate
multi-step processes by coordinating agents, triggers, and integrations.

## Understanding Workflows

A workflow definition has:
- **States**: Named steps in the process (e.g. "Intake", "Generate Document", "Awaiting Approval")
- **Transitions**: Connections between states with conditions (e.g. "agent_complete" -> next state)
- **Variables**: Data that persists across states (e.g. release_name, requester_email)
- **Actions**: What happens in each state (agent_task, wait_for_trigger, set_variables, trigger_setup)

## Explore Existing Workflows

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/workflows/definitions"
\`\`\`

## Create a Workflow Definition

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/workflows/definitions" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d @- <<'EOF'
{
  "name": "Workflow Name",
  "description": "What this workflow automates",
  "initialStateId": "start",
  "position": { "x": 5, "z": -3 },
  "style": "flowchart",
  "color": "#4a9eff",
  "scale": 1.0,
  "variables": [
    { "name": "requester_name", "type": "string", "description": "Person who initiated the process" },
    { "name": "status", "type": "string", "description": "Current process status" }
  ],
  "states": [
    {
      "id": "start",
      "name": "Start",
      "type": "action",
      "action": {
        "type": "agent_task",
        "agentId": "AGENT_ID_HERE",
        "promptTemplate": "Begin the workflow. Collect required info from {{requester_name}}.",
        "skills": ["slack-messaging"]
      },
      "transitions": [
        { "id": "t1", "name": "Task Done", "targetStateId": "end", "condition": { "type": "agent_complete" } }
      ]
    },
    {
      "id": "end",
      "name": "End",
      "type": "end",
      "transitions": []
    }
  ]
}
EOF
\`\`\`

## State Types

| Type | Purpose | Key Fields |
|---|---|---|
| \`action\` | Agent executes a task with a prompt | agentId, skills, promptTemplate |
| \`decision\` | Agent makes a routing decision | agentId, promptTemplate, multiple transitions |
| \`wait\` | Pause until a trigger fires or timeout | wait_for_trigger config |
| \`end\` | Terminal state, workflow completes | (none) |

## Action Types

| Action | Purpose |
|---|---|
| \`agent_task\` | Send a prompt to an agent. Transitions on \`agent_complete\` |
| \`wait_for_trigger\` | Wait for a trigger to fire. Has optional \`timeoutMs\` |
| \`trigger_setup\` | Dynamically create a trigger at runtime |
| \`set_variables\` | Set workflow variables directly |

## Transition Conditions

| Condition | When It Fires |
|---|---|
| \`agent_complete\` | Agent finishes its task |
| \`trigger_fired\` | A trigger associated with this state fires |
| \`timeout\` | Wait state exceeds its timeout duration (\`afterMs\` in ms) |
| \`variable_check\` | A variable condition evaluates to true |
| \`manual\` | User clicks a transition button in the UI |

## Update a Workflow

\`\`\`bash
curl -s -X PATCH "http://localhost:{{PORT}}/api/workflows/definitions/WORKFLOW_ID" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "name": "Updated Name", "description": "Updated description" }'
\`\`\`

## Delete a Workflow

\`\`\`bash
curl -s -X DELETE "http://localhost:{{PORT}}/api/workflows/definitions/WORKFLOW_ID" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}"
\`\`\`

## Move a Workflow Model

\`\`\`bash
curl -s -X PATCH "http://localhost:{{PORT}}/api/workflows/definitions/WORKFLOW_ID" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "position": { "x": 10, "z": -5 } }'
\`\`\`

## Start a Workflow Manually

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/workflows/instances" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "workflowDefId": "WORKFLOW_ID", "initialVariables": { "requester_name": "John" } }'
\`\`\`

## Check Workflow Instances

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/workflows/instances?workflowDefId=WORKFLOW_ID"
\`\`\`

## Update Workflow Variables (from agent context)

\`\`\`bash
curl -s -X PATCH "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/variables" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "variables": { "release_name": "v2.1.0", "status": "approved" }, "changedBy": "agent:AGENT_ID" }'
\`\`\`

## Notify Workflow Event (agent completion)

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/event" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "eventType": "agent_complete", "data": { "agentResponse": "Task completed successfully" } }'
\`\`\`

## Available Styles for 3D Models

| Style | Appearance |
|---|---|
| \`flowchart\` | Connected nodes floating in a ring |
| \`circuit-board\` | PCB-style traces with glowing paths |
| \`constellation\` | Star map with connected points |
| \`helix\` | DNA-like double spiral |
| \`clockwork\` | Mechanical gears and cogs |

## Get Instance Details

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID"
\`\`\`

Response includes current state, variables, status, and execution progress.

## List All Instances (with filtering)

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/workflows/instances?workflowDefId=WORKFLOW_ID&status=running&limit=50"
\`\`\`

Filters available: \`workflowDefId\`, \`status\` (running, paused, completed, failed, cancelled), \`limit\`, \`offset\`

## Pause a Running Instance

Stop a workflow instance temporarily. All timers are suspended, state is preserved.

\`\`\`bash
curl -s -X PATCH "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/pause" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}"
\`\`\`

## Resume a Paused Instance

Continue a paused workflow from where it left off.

\`\`\`bash
curl -s -X PATCH "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/resume" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}"
\`\`\`

## Cancel a Running Instance

Terminate a workflow instance and mark it as cancelled.

\`\`\`bash
curl -s -X PATCH "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/cancel" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}"
\`\`\`

## Get Instance Execution Timeline

View a chronological trace of state transitions, including timestamps and conditions that triggered each transition.

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/timeline"
\`\`\`

## Get Instance Steps

View detailed information about each state execution: agent assignments, outcomes, variable changes.

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/steps"
\`\`\`

## Get Variable Change History

Track all changes to a specific workflow variable (or all variables).

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/variables?variableName=release_name"
\`\`\`

Omit \`variableName\` to see history of all variables.

## Get Instance Reasoning Trace

View the decision-making logic and Claude reasoning for each workflow step (if available).

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/reasoning"
\`\`\`

## Trigger Manual Transition

Force a workflow to transition via a specific transition ID. Useful for manual approvals or overrides.

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/workflows/instances/INSTANCE_ID/transition" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "transitionId": "t1" }'
\`\`\`

## Get Conversational Explanation of Workflow

Ask Claude AI questions about a workflow definition, execution trace, or design.

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/workflows/WORKFLOW_ID/chat" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{
    "message": "Why did the workflow transition to the error state?",
    "scope": {
      "type": "instance",
      "instanceId": "INSTANCE_ID"
    },
    "conversationHistory": []
  }'
\`\`\`

Scope types: \`definition\`, \`instance\`

## Troubleshooting Common Issues

### Workflow Stuck in a State

1. Get timeline to see last state: \`GET /instances/INSTANCE_ID/timeline\`
2. Check variable history: \`GET /instances/INSTANCE_ID/variables\`
3. Pause the instance: \`PATCH /instances/INSTANCE_ID/pause\`
4. Fix any issues manually or via variable update
5. Resume: \`PATCH /instances/INSTANCE_ID/resume\`
6. Or manually transition: \`POST /instances/INSTANCE_ID/transition\` with correct transitionId

### Agent Task Not Completing

1. Get steps to see agent's task: \`GET /instances/INSTANCE_ID/steps\`
2. Check reasoning trace: \`GET /instances/INSTANCE_ID/reasoning\`
3. Pause the instance while debugging
4. Contact the assigned agent or check agent logs
5. Manually transition once resolved

### Variable Not Updating

1. Check variable history: \`GET /instances/INSTANCE_ID/variables?variableName=YOUR_VAR\`
2. Use PATCH /variables endpoint to set correct value if needed
3. Verify agents in action states are using correct variable names in prompts
4. Use {{variable_name}} syntax (double braces) in promptTemplate

### Timeout Issues

- If a wait state is timing out incorrectly, check the \`afterMs\` value in the wait action config
- Get timeline to confirm timeout fired: \`GET /instances/INSTANCE_ID/timeline\`
- Pause and manually transition if needed

## Instance Lifecycle State Diagram

A workflow instance flows through these states:

\`\`\`
idle → running ──→ completed
       ↓    ↑
     paused─┘
       ↓
    cancelled

       ↓
     failed ← (if agent/trigger error)
\`\`\`

## Design Guidelines

1. **State naming**: Use descriptive, action-oriented names ("Collect Requirements", "Generate Report")
2. **Prompts**: Be specific in promptTemplates. Tell the agent exactly what to collect, call, and set
3. **Variables**: Define ALL variables upfront. Agents reference them via {{variable_name}} in prompts
4. **Skills**: Assign only the skills each state needs (slack-messaging, email-gmail, jira-service-desk, document-generator, google-calendar)
5. **Error handling**: Add timeout transitions on wait states. Consider error/escalation states
6. **Position**: Place workflow models near related buildings/agents in the work area
7. **Monitoring**: Use the chat API and timeline queries during development to understand execution flow
8. **Debugging**: When instances get stuck, use pause/resume and manual transitions as escape hatches
`,
};
