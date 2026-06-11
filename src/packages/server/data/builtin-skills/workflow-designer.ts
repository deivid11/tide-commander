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

Workflows are state machines that automate multi-step processes by coordinating agents, triggers, and integrations. A definition has:
- **States**: named steps; **Transitions**: connections between states with conditions; **Variables**: data persisting across states; **Actions**: what happens in each state (agent_task, wait_for_trigger, set_variables, trigger_setup).

All endpoints are on \`http://localhost:{{PORT}}\` and require \`-H "Content-Type: application/json" -H "X-Auth-Token: {{AUTH_TOKEN}}"\`. Example:

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/workflows/definitions"
\`\`\`

Below, endpoints are written as METHOD path — JSON body.

## Definitions

- List: \`GET /api/workflows/definitions\`
- Create: \`POST /api/workflows/definitions\` — body below
- Update / move 3D model: \`PATCH /api/workflows/definitions/WORKFLOW_ID\` — \`{ "name": "Updated Name", "description": "Updated description", "position": { "x": 10, "z": -5 } }\`
- Delete: \`DELETE /api/workflows/definitions/WORKFLOW_ID\`

Create body:

\`\`\`json
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
    { "id": "end", "name": "End", "type": "end", "transitions": [] }
  ]
}
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
| \`wait_for_trigger\` | Wait for a trigger to fire. Optional \`timeoutMs\` |
| \`trigger_setup\` | Dynamically create a trigger at runtime |
| \`set_variables\` | Set workflow variables directly |

## Transition Conditions

| Condition | Fires When |
|---|---|
| \`agent_complete\` | Agent finishes its task |
| \`trigger_fired\` | A trigger associated with this state fires |
| \`timeout\` | Wait state exceeds its timeout duration (\`afterMs\` in ms) |
| \`variable_check\` | A variable condition evaluates to true |
| \`manual\` | User clicks a transition button in the UI |

## 3D Model Styles

\`flowchart\` (connected nodes in a ring), \`circuit-board\` (PCB traces, glowing paths), \`constellation\` (star map), \`helix\` (DNA-like double spiral), \`clockwork\` (gears and cogs).

## Instances

- Start manually: \`POST /api/workflows/instances\` — \`{ "workflowDefId": "WORKFLOW_ID", "initialVariables": { "requester_name": "John" } }\`
- List/filter: \`GET /api/workflows/instances?workflowDefId=WORKFLOW_ID&status=running&limit=50\` — filters: \`workflowDefId\`, \`status\` (running, paused, completed, failed, cancelled), \`limit\`, \`offset\`
- Details (current state, variables, status, execution progress): \`GET /api/workflows/instances/INSTANCE_ID\`
- Update variables (from agent context): \`PATCH /api/workflows/instances/INSTANCE_ID/variables\` — \`{ "variables": { "release_name": "v2.1.0", "status": "approved" }, "changedBy": "agent:AGENT_ID" }\`
- Notify event (agent completion): \`POST /api/workflows/instances/INSTANCE_ID/event\` — \`{ "eventType": "agent_complete", "data": { "agentResponse": "Task completed successfully" } }\`
- Pause (timers suspended, state preserved): \`PATCH /api/workflows/instances/INSTANCE_ID/pause\`
- Resume from where it left off: \`PATCH /api/workflows/instances/INSTANCE_ID/resume\`
- Cancel (terminate, mark cancelled): \`PATCH /api/workflows/instances/INSTANCE_ID/cancel\`
- Timeline (chronological state transitions with timestamps and triggering conditions): \`GET /api/workflows/instances/INSTANCE_ID/timeline\`
- Steps (per-state execution detail: agent assignments, outcomes, variable changes): \`GET /api/workflows/instances/INSTANCE_ID/steps\`
- Variable change history: \`GET /api/workflows/instances/INSTANCE_ID/variables?variableName=release_name\` (omit \`variableName\` for all variables)
- Reasoning trace (decision logic per step, if available): \`GET /api/workflows/instances/INSTANCE_ID/reasoning\`
- Manual transition (approvals/overrides): \`POST /api/workflows/instances/INSTANCE_ID/transition\` — \`{ "transitionId": "t1" }\`

## Workflow Chat

Ask Claude about a workflow definition, execution trace, or design: \`POST /api/workflows/WORKFLOW_ID/chat\` — \`{ "message": "Why did the workflow transition to the error state?", "scope": { "type": "instance", "instanceId": "INSTANCE_ID" }, "conversationHistory": [] }\`. Scope types: \`definition\`, \`instance\`.

## Instance Lifecycle

idle → running → completed; running ↔ paused; running/paused → cancelled; → failed (on agent/trigger error).

## Troubleshooting

- **Stuck in a state**: get timeline, check variable history, pause, fix via variable PATCH, resume — or \`POST /transition\` with the correct transitionId.
- **Agent task not completing**: check steps and reasoning trace; pause while debugging; contact the assigned agent or check agent logs; manually transition once resolved.
- **Variable not updating**: check variable history; PATCH /variables to set the correct value; verify promptTemplates use {{variable_name}} (double braces).
- **Timeout issues**: check \`afterMs\` in the wait action config; confirm the timeout fired via timeline; pause and manually transition if needed.

## Design Guidelines

1. Descriptive, action-oriented state names ("Collect Requirements", "Generate Report")
2. Specific promptTemplates: tell the agent exactly what to collect, call, and set
3. Define ALL variables upfront; agents reference them via {{variable_name}} in prompts
4. Assign only the skills each state needs (slack-messaging, email-gmail, jira-service-desk, document-generator, google-calendar)
5. Add timeout transitions on wait states; consider error/escalation states
6. Place workflow models near related buildings/agents in the work area
7. Use the chat API and timeline queries during development to understand execution flow
8. When instances get stuck, pause/resume and manual transitions are escape hatches
`,
};
