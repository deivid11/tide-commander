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
- **Trigger Type**: How the event is detected (webhook, cron, slack, email, jira, whatsapp, bitbucket)
- **Match Mode**: How to evaluate if an event matches (\`structural\`, \`llm\`, \`hybrid\`)
- **Extraction Mode** (optional): How to pull template variables out of the event (\`structural\` or \`llm\`)
- **Agent Assignment**: Which agent to fire
- **Template**: Prompt template sent to the agent, supports \`{{variable}}\` interpolation

## Trigger Types

| Type | When It Fires | Use Cases |
|---|---|---|
| \`webhook\` | When \`POST /api/triggers/webhook/:triggerId\` receives a request | External systems push events; HMAC-validated; recommended path for GitHub/Bitbucket Cloud webhooks (see Bitbucket section below) |
| \`cron\` | On a schedule (recurring expression or one-shot \`runAt\`) | Periodic tasks, reports, maintenance, scheduled reminders |
| \`slack\` | When a Slack message matches the configured filters | Team notifications, approvals, command parsing |
| \`email\` | When a Gmail message matches the configured filters | Customer requests, alerts, approval workflows |
| \`jira\` | When a Jira webhook delivery matches | Issue escalation, automation, comment routing |
| \`whatsapp\` | When a WhatsApp message arrives matching the configured filters | Inbound customer messages, group monitoring |
| \`bitbucket\` | (Type exists in the type system but the webhook receiver currently only accepts \`type: 'webhook'\` — for Bitbucket Cloud, use a webhook trigger as shown below) | n/a — see Bitbucket section |

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
  "matchMode": "structural",
  "config": {
    "method": "POST",
    "secret": "OPTIONAL_HMAC_SECRET",
    "extractFields": ["eventType", "data.user.id"]
  },
  "promptTemplate": "Process external event: {{eventType}} for user {{data.user.id}}\\n\\nFull payload: {{payload}}",
  "enabled": true
}
EOF
\`\`\`

The webhook endpoint will be: \`http://localhost:{{PORT}}/api/triggers/webhook/TRIGGER_ID\`

POST JSON to this endpoint to fire the trigger. If \`config.secret\` is set, the receiver requires either:
- \`X-Hub-Signature-256\` (GitHub-style HMAC-SHA256) or \`X-Hub-Signature\` (Bitbucket-style), with the signature computed over the raw request body, OR
- \`X-Webhook-Secret\` header set to the literal secret value (plain comparison).

Each path listed in \`config.extractFields\` becomes a template variable named after the dotted path (e.g. \`{{data.user.id}}\`). The full payload is also available as \`{{payload}}\` (JSON-stringified).

## Create a Cron Trigger (recurring)

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
  "matchMode": "structural",
  "config": {
    "expression": "0 9 * * 1-5",
    "timezone": "America/Mexico_City",
    "payload": { "report": "daily-status" }
  },
  "promptTemplate": "Generate {{report}} report for {{cron.scheduledAt}}",
  "enabled": true
}
EOF
\`\`\`

Keys in \`config.payload\` are merged into the template variables on every fire, in addition to the built-in \`{{cron.expression}}\` and \`{{cron.scheduledAt}}\`.

### Common Cron Expressions

| Expression | When It Runs |
|---|---|
| \`0 9 * * *\` | Every day at 9 AM |
| \`0 9 * * 1-5\` | Weekdays at 9 AM |
| \`0 */4 * * *\` | Every 4 hours |
| \`0 0 1 * *\` | First day of every month |
| \`*/15 * * * *\` | Every 15 minutes |

## Create a One-Shot Cron Trigger

For a single fire at a specific moment, omit \`expression\` and set \`runOnce: true\` + \`runAt\` (ISO 8601, treat as UTC):

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/triggers" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d @- <<'EOF'
{
  "name": "One-Shot Reminder",
  "type": "cron",
  "agentId": "AGENT_ID",
  "matchMode": "structural",
  "config": {
    "expression": "",
    "timezone": "UTC",
    "runOnce": true,
    "runAt": "2026-05-15T17:00:00Z",
    "payload": { "topic": "Q2 review prep" }
  },
  "promptTemplate": "Remind me about {{topic}} (scheduled at {{cron.runAt}})",
  "enabled": true
}
EOF
\`\`\`

After firing, the trigger is auto-disabled and \`config.completedAt\` is set. If the server was down at \`runAt\` past the grace window, the trigger is marked errored with \`config.missedAt\`.

## Validate a Cron Expression

Before saving, sanity-check the expression and preview the next fire times:

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/triggers/validate-cron" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "expression": "0 9 * * 1-5", "timezone": "America/Mexico_City" }'
\`\`\`

Response: \`{ "valid": true, "nextFires": ["2026-05-11T15:00:00.000Z", ...] }\` or \`{ "valid": false, "error": "..." }\`.

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
  "agentId": "AGENT_ID",
  "matchMode": "structural",
  "config": { "channelId": "C0123456789", "messagePattern": "approve|deny" },
  "promptTemplate": "Process approval request from @{{slack.user}}: {{slack.message}}",
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
  "matchMode": "llm",
  "config": { "subjectPattern": "urgent|critical" },
  "llmMatch": { "prompt": "Is this a real customer escalation requiring same-day reply?" },
  "promptTemplate": "Handle customer inquiry from {{email.from}}: {{email.subject}}\\n\\n{{email.body}}",
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
  "matchMode": "structural",
  "config": { "projectKey": "INCIDENT", "events": ["jira:issue_created"], "jqlFilter": "priority = P1" },
  "promptTemplate": "Respond to P1 incident {{jira.issueKey}}: {{jira.summary}}",
  "enabled": true
}
EOF
\`\`\`

## Create a WhatsApp Trigger

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/triggers" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d @- <<'EOF'
{
  "name": "Inbound DM Handler",
  "description": "Fire on inbound 1:1 DMs that mention 'order'",
  "type": "whatsapp",
  "agentId": "AGENT_ID",
  "matchMode": "structural",
  "config": { "direction": "inbound", "dmOnly": true, "bodyPattern": "order" },
  "promptTemplate": "Reply to {{whatsapp.fromName}} ({{whatsapp.from}}): {{whatsapp.body}}",
  "enabled": true
}
EOF
\`\`\`

## Bitbucket Cloud Webhooks

Use \`type: 'bitbucket'\` so the trigger gets the typed UX in the UI (workspace / repo-slug / event-key fields). The central webhook receiver at \`POST /api/triggers/webhook/:triggerId\` accepts both \`webhook\` and \`bitbucket\` types — its signature, dedupe, and author-loop helpers auto-detect the Bitbucket vs GitHub flavor from request headers, so the trigger type is purely a UI / metadata concern. The \`bitbucket-reviewer\` skill walks through the agent-side prompt; this skill just creates the trigger:

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/triggers" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d @- <<'EOF'
{
  "name": "Bitbucket PR Reviewer (wind)",
  "description": "Review every PR opened or updated on tide/wind",
  "type": "bitbucket",
  "agentId": "AGENT_ID",
  "matchMode": "structural",
  "config": {
    "method": "POST",
    "secret": "GENERATE_A_RANDOM_HIGH_ENTROPY_STRING",
    "extractFields": [
      "pullrequest.id",
      "pullrequest.title",
      "repository.full_name",
      "actor.nickname"
    ]
  },
  "promptTemplate": "Review pull request #{{pullrequest.id}} on {{repository.full_name}}: {{pullrequest.title}}",
  "enabled": true
}
EOF
\`\`\`

After creation, paste the per-trigger URL \`http://<public-host>/api/triggers/webhook/TRIGGER_ID\` and the same \`secret\` into Bitbucket → Repository settings → Webhooks. The receiver verifies the \`X-Hub-Signature\` (Bitbucket's HMAC-SHA256 header), dedupes retries via \`X-Request-UUID\`, and respects an author-loop guard via the \`BITBUCKET_BOT_USERNAME\` env var. See \`docs/bitbucket-pr-review.md\` and the \`bitbucket-reviewer\` skill for the full setup.

## Matching Modes

| Mode | How It Works | Best For |
|---|---|---|
| \`structural\` | Per-handler field matching (regex/equality on the typed payload) | Predictable, structured events |
| \`llm\` | Haiku-by-default LLM evaluates if the event is relevant given \`llmMatch.prompt\` | Complex, semantic matching |
| \`hybrid\` | Structural pre-filter; if it passes, LLM verifies | Balance of speed and cost |

For \`llm\` and \`hybrid\`, also set:

\`\`\`json
"llmMatch": {
  "prompt": "Natural-language condition the event must satisfy",
  "model": "haiku",
  "temperature": 0,
  "maxTokens": 150,
  "minConfidence": 0.6
}
\`\`\`

## Variable Extraction (LLM)

To pull free-form variables out of unstructured event payloads, set \`extractionMode: "llm"\` and \`llmExtract\`:

\`\`\`json
"extractionMode": "llm",
"llmExtract": {
  "prompt": "Extract the customer's account ID and request type",
  "variables": ["accountId", "requestType"]
}
\`\`\`

Variables returned by the extractor are merged on top of the structural variables before the prompt is interpolated.

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

## Test a Trigger's Match Pipeline (dry run)

Send a sample payload through the trigger's full match + extract pipeline without firing the agent:

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/triggers/TRIGGER_ID/test-match" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{
    "payload": {
      "messageText": "urgent: fix the database",
      "sender": "alice@example.com"
    }
  }'
\`\`\`

You may also send a fully-formed event under the \`event\` key: \`{ "event": { "source": "slack", "type": "message", "data": { ... }, "timestamp": 1700000000000 } }\`.

Response shape (\`TestMatchResult\` from \`src/packages/shared/trigger-types.ts\`):

\`\`\`json
{
  "structuralMatch": true,
  "llmMatch": { "match": true, "confidence": 0.92, "reason": "...", "durationMs": 412, "model": "haiku", "tokensUsed": 84 },
  "extractedVariables": { "slack.user": "alice", "slack.message": "..." },
  "wouldFire": true,
  "matcherExecutions": [ ... ]
}
\`\`\`

## Fire a Trigger Manually

Bypasses match logic; jumps straight to firing the agent with the supplied template variables:

\`\`\`bash
curl -s -X POST "http://localhost:{{PORT}}/api/triggers/TRIGGER_ID/fire" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{
    "variables": { "requester": "alice@example.com", "priority": "high" },
    "payload": { "raw": "optional raw payload, recorded with the fire" }
  }'
\`\`\`

## Trigger Fire History

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/triggers/TRIGGER_ID/events?limit=10"
\`\`\`

Returns recent fire records (\`TriggerFireRow\` from \`src/packages/shared/trigger-types.ts\`) with status, variables, payload, LLM results, and duration.

## Matcher Diagnostics

When debugging why a trigger did or didn't fire:

\`\`\`bash
# All matchers that ran for one trigger event
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/triggers/events/EVENT_ID/matchers"

# Matcher-execution history for a trigger across all events
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/triggers/TRIGGER_ID/matcher-history?limit=100"

# Every matcher that evaluated against a specific source message (e.g. one Slack ts)
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/triggers/matchers/by-source/SOURCE_TYPE/SOURCE_ID"
\`\`\`

## Common Template Variables

Every fire receives \`{{trigger.name}}\` and \`{{timestamp}}\` (ISO string). The handler-specific variables below come from each integration's \`extractVariables\` implementation.

### Webhook triggers
- \`{{payload}}\` — full request body, JSON-stringified
- Each path in \`config.extractFields\` becomes a variable named after the dotted path (e.g. \`{{data.user.id}}\`)

### Cron triggers
- \`{{cron.expression}}\` — the cron expression (recurring jobs only)
- \`{{cron.scheduledAt}}\` — ISO timestamp when the fire was scheduled
- \`{{cron.runAt}}\` — the ISO \`runAt\` (one-shot only)
- Each key in \`config.payload\` is merged in as a top-level variable

### Slack triggers
- \`{{slack.user}}\`, \`{{slack.userId}}\`, \`{{slack.message}}\`, \`{{slack.channel}}\`, \`{{slack.threadTs}}\`
- \`{{slack.fileCount}}\`, \`{{slack.fileIds}}\`, \`{{slack.fileNames}}\`, \`{{slack.instanceId}}\`

### Email triggers
- \`{{email.from}}\`, \`{{email.to}}\`, \`{{email.subject}}\`, \`{{email.body}}\`
- \`{{email.threadId}}\`, \`{{email.messageId}}\`, \`{{email.date}}\`
- \`{{email.hasAttachments}}\`, \`{{email.attachments}}\`, \`{{email.direction}}\`, \`{{email.labels}}\`

### Jira triggers
- \`{{jira.issueKey}}\`, \`{{jira.issueId}}\`, \`{{jira.summary}}\`, \`{{jira.status}}\`
- \`{{jira.project}}\`, \`{{jira.projectName}}\`, \`{{jira.issueType}}\`, \`{{jira.priority}}\`
- \`{{jira.assignee}}\`, \`{{jira.reporter}}\`, \`{{jira.user}}\`, \`{{jira.eventType}}\`
- \`{{jira.labels}}\`, \`{{jira.changes}}\`, \`{{jira.commentAuthor}}\`, \`{{jira.commentBody}}\`

### WhatsApp triggers
- \`{{whatsapp.from}}\`, \`{{whatsapp.fromName}}\`, \`{{whatsapp.body}}\`
- \`{{whatsapp.sessionId}}\`, \`{{whatsapp.chatId}}\`, \`{{whatsapp.isGroup}}\`, \`{{whatsapp.groupName}}\`
- \`{{whatsapp.direction}}\`, \`{{whatsapp.mediaType}}\`, \`{{whatsapp.mediaUrl}}\`, \`{{whatsapp.timestamp}}\`

## Design Guidelines

1. **Names**: Use clear, action-oriented names ("Daily Report", "Slack Approval Processor")
2. **Prompts**: Be specific. Tell the agent what to do with the event data
3. **Matching**: Start with \`structural\` for simple patterns, use \`hybrid\` to gate LLM calls behind a cheap pre-filter
4. **Testing**: Always run \`/test-match\` before enabling a trigger that will fire on production traffic
5. **Template Variables**: Reference only variables that exist for that trigger type (see the section above)
6. **Debugging**: Use the matcher-diagnostics endpoints to see exactly which matcher passed/failed and why

## Rate Limiting

Each trigger is rate-limited to **10 fires per minute**. The cap is hardcoded in \`src/packages/server/services/trigger-service.ts\` (\`RATE_LIMIT_MAX\`) and is not configurable per-trigger via the API. Requests exceeding the cap are dropped silently after the limit is hit; check fire history if a trigger appears to "miss" events.

## Webhook Security

Webhook triggers can require one of two authentication mechanisms by setting \`config.secret\`:

| Mechanism | Header | Body input |
|---|---|---|
| HMAC-SHA256 (GitHub style) | \`X-Hub-Signature-256: sha256=<hex>\` | Raw request bytes |
| HMAC-SHA256 (Bitbucket style) | \`X-Hub-Signature: sha256=<hex>\` | Raw request bytes |
| Plain shared secret | \`X-Webhook-Secret: <secret>\` | Header value compared directly to \`config.secret\` |

When \`config.secret\` is set, requests with no signature are rejected with \`401 { "error": "Missing signature" }\`. The receiver also dedupes retries via \`X-Request-UUID\` (Bitbucket) or \`X-GitHub-Delivery\` (GitHub) within a 10-minute window.

If \`config.secret\` is unset, the endpoint accepts any POST — only do this for triggers behind a trusted network or dedicated path.
`,
};
