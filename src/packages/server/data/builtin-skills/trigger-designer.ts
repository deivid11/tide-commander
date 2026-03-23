/**
 * Trigger Designer - Built-in Skill Definition
 * Provides agents with curl-based instructions for creating, managing,
 * and testing event-driven triggers that fire agents with templates.
 */

import type { BuiltinSkillDefinition } from './types.js';

export const triggerDesigner: BuiltinSkillDefinition = {
  slug: 'trigger-designer',
  name: 'Trigger Designer',
  description: 'Create and manage event-driven triggers that automatically fire agents with templates',
  allowedTools: ['Bash(curl:*)'],
  content: `# Trigger Designer

You can create and manage triggers that fire agents automatically when events occur.
Triggers are event-driven rules that call agents with predefined templates.

## Understanding Triggers

A trigger has:
- **Name & Description**: What the trigger does
- **Trigger Type**: How the event is detected (webhook, cron, slack, email, jira, manual)
- **Matching Mode**: How to match events (structural, LLM, hybrid)
- **Agent Assignment**: Which agent to fire
- **Template**: Prompt template to send to the agent
- **Rate Limiting**: Max fires per minute (default 10)

## Trigger Types

| Type | When It Fires | Use Cases |
|---|---|---|
| \`webhook\` | When webhook URL receives POST request | External systems trigger workflows |
| \`cron\` | On a schedule (cron expression) | Periodic tasks, reports, maintenance |
| \`slack\` | When Slack message matches pattern | Team notifications, approvals |
| \`email\` | When email arrives matching pattern | Customer requests, alerts |
| \`jira\` | When Jira ticket created/updated | Issue escalation, automation |
| \`manual\` | Triggered manually by user | Testing, ad-hoc execution |

## List All Triggers

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/triggers"
\`\`\`

## Create a Webhook Trigger

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/triggers" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d @- <<'EOF'
{
  "name": "External Event Processor",
  "description": "Fire agent when external system posts event",
  "type": "webhook",
  "agentId": "AGENT_ID",
  "matchingMode": "structural",
  "extractionMode": "none",
  "promptTemplate": "Process external event: {{eventType}} - {{eventData}}",
  "enabled": true,
  "rateLimit": 10
}
EOF
\`\`\`

The webhook endpoint will be: \`http://localhost:{{PORT}}/api/webhook/trigger/TRIGGER_ID\`

Post JSON to this endpoint to fire the trigger.

## Create a Cron Trigger

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/triggers" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d @- <<'EOF'
{
  "name": "Daily Report Generator",
  "description": "Fire at 9 AM every weekday",
  "type": "cron",
  "agentId": "AGENT_ID",
  "cronExpression": "0 9 * * 1-5",
  "matchingMode": "structural",
  "promptTemplate": "Generate daily status report",
  "enabled": true
}
EOF
\`\`\`

### Common Cron Expressions

| Expression | When It Runs |
|---|---|
| \`0 9 * * *\` | Every day at 9 AM |
| \`0 9 * * 1-5\` | Weekdays at 9 AM |
| \`0 */4 * * *\` | Every 4 hours |
| \`0 0 1 * *\` | First day of every month |
| \`*/15 * * * *\` | Every 15 minutes |

## Create a Slack Trigger

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/triggers" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d @- <<'EOF'
{
  "name": "Slack Approval Processor",
  "description": "Fire when approval request posted in #requests",
  "type": "slack",
  "slackChannelId": "C0123456789",
  "agentId": "AGENT_ID",
  "matchingMode": "hybrid",
  "promptTemplate": "Process approval request: {{message_text}}",
  "enabled": true
}
EOF
\`\`\`

## Create an Email Trigger

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/triggers" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d @- <<'EOF'
{
  "name": "Customer Inquiry Handler",
  "description": "Fire for emails with 'urgent' in subject",
  "type": "email",
  "agentId": "AGENT_ID",
  "emailSubjectKeywords": ["urgent", "critical"],
  "matchingMode": "llm",
  "promptTemplate": "Handle customer inquiry from {{sender}}: {{subject}}\\n\\n{{body}}",
  "enabled": true
}
EOF
\`\`\`

## Create a Jira Trigger

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/triggers" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d @- <<'EOF'
{
  "name": "P1 Incident Responder",
  "description": "Fire when P1 ticket created",
  "type": "jira",
  "agentId": "AGENT_ID",
  "jiraProject": "INCIDENT",
  "jiraPriority": "Highest",
  "matchingMode": "structural",
  "promptTemplate": "Respond to P1 incident {{ticket_key}}: {{summary}}",
  "enabled": true
}
EOF
\`\`\`

## Matching Modes

| Mode | How It Works | Best For |
|---|---|---|
| \`structural\` | Pattern matching on defined fields | Predictable, structured events |
| \`llm\` | LLM evaluates if event is relevant | Complex, semantic matching |
| \`hybrid\` | Structural match, then LLM verification | Balance of speed and accuracy |

## Get Trigger Details

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/triggers/TRIGGER_ID"
\`\`\`

## Update a Trigger

\`\`\`bash
curl -s -X PATCH "http://localhost:{{PORT}}/api/triggers/TRIGGER_ID" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "enabled": false, "promptTemplate": "New prompt" }'
\`\`\`

## Delete a Trigger

\`\`\`bash
curl -s -X DELETE "http://localhost:{{PORT}}/api/triggers/TRIGGER_ID" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}"
\`\`\`

## Test a Trigger's Pattern Matching

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/triggers/TRIGGER_ID/test-match" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{
    "eventType": "slack_message",
    "messageText": "urgent: fix the database",
    "sender": "alice@example.com"
  }'
\`\`\`

Response: \`{ "matches": true, "confidence": 0.95 }\`

## Fire a Trigger Manually

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/triggers/TRIGGER_ID/fire" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{
    "eventType": "manual",
    "data": {
      "requester": "alice@example.com",
      "priority": "high"
    }
  }'
\`\`\`

## Check Trigger History

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/triggers/TRIGGER_ID/history?limit=10"
\`\`\`

Returns recent firing events and their results.

## Common Template Variables

Depending on trigger type, these variables are available in prompts:

- \`{{eventType}}\` - Type of event (webhook, cron, slack, etc)
- \`{{eventTime}}\` - When the event occurred
- \`{{eventData}}\` - Full event payload (webhook)
- \`{{message_text}}\` - Message content (slack, email)
- \`{{sender}}\` - Who sent the message
- \`{{subject}}\` - Email subject
- \`{{body}}\` - Email body
- \`{{ticket_key}}\` - Jira ticket ID
- \`{{summary}}\` - Jira issue summary
- \`{{priority}}\` - Priority level

## Design Guidelines

1. **Names**: Use clear, action-oriented names ("Daily Report", "Slack Approval Processor")
2. **Prompts**: Be specific. Tell the agent what to do with the event data
3. **Matching**: Start with \`structural\` for simple patterns, use \`llm\` for complex semantic matching
4. **Rate Limiting**: Set appropriate limits to prevent duplicate processing
5. **Testing**: Always test pattern matching before enabling triggers
6. **Template Variables**: Reference only variables that exist for that trigger type
7. **Error Handling**: Agent responses are logged in trigger history for debugging

## Rate Limiting

Triggers enforce rate limits to prevent accidental loops or spam:
- Default: 10 fires per minute
- Minimum: 1 per minute
- Set when creating or updating trigger

## Webhook Trigger Security

Webhook triggers accept any POST request. To secure them:
1. Only expose to trusted systems
2. Use network-level access controls
3. Monitor trigger history for unusual activity
4. Disable triggers when not in use
`,
};
