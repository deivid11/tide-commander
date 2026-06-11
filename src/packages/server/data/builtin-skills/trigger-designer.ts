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

Triggers are event-driven rules that automatically fire agents with predefined prompt templates when events occur.

Trigger fields: **name**, **description**, **type**, **agentId** (agent to fire), **matchMode** (\`structural\`, \`llm\`, \`hybrid\`), optional **extractionMode** (\`structural\` or \`llm\`), **config** (type-specific), **promptTemplate** (supports \`{{variable}}\` interpolation), **enabled**, plus \`llmMatch\`/\`llmExtract\` (see below).

All endpoints are on \`http://localhost:{{PORT}}\` and require \`-H "Content-Type: application/json" -H "X-Auth-Token: {{AUTH_TOKEN}}"\`. Below, endpoints are written as METHOD path — JSON body.

## CRUD

- List: \`GET /api/triggers\`
- Details: \`GET /api/triggers/TRIGGER_ID\`
- Create: \`POST /api/triggers\` — bodies per type below
- Update: \`PATCH /api/triggers/TRIGGER_ID\` — e.g. \`{ "enabled": false, "promptTemplate": "New prompt" }\`
- Delete: \`DELETE /api/triggers/TRIGGER_ID\`

## Trigger Types

| Type | Fires When |
|---|---|
| \`webhook\` | \`POST /api/triggers/webhook/:triggerId\` receives a request; HMAC-validated; recommended path for GitHub/Bitbucket Cloud webhooks |
| \`cron\` | On a schedule (recurring expression or one-shot \`runAt\`) |
| \`slack\` | A Slack message matches the configured filters |
| \`email\` | A Gmail message matches the configured filters |
| \`jira\` | A Jira webhook delivery matches |
| \`whatsapp\` | A WhatsApp message matches the configured filters |
| \`bitbucket\` | Type exists in the type system; webhook receiver handles it — see Bitbucket section |

## Create a Trigger

Full example (webhook):

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

The webhook endpoint will be \`http://localhost:{{PORT}}/api/triggers/webhook/TRIGGER_ID\` — POST JSON to it to fire. Each dotted path in \`config.extractFields\` becomes a template variable of the same name (e.g. \`{{data.user.id}}\`); the full payload is \`{{payload}}\` (JSON-stringified). Secret handling: see Webhook Security.

Other types use the same body shape with these differences:

### Cron (recurring)

\`\`\`json
"type": "cron",
"config": {
  "expression": "0 9 * * 1-5",
  "timezone": "America/Mexico_City",
  "payload": { "report": "daily-status" }
},
"promptTemplate": "Generate {{report}} report for {{cron.scheduledAt}}"
\`\`\`

\`config.payload\` keys are merged into template variables on every fire, in addition to built-in \`{{cron.expression}}\` and \`{{cron.scheduledAt}}\`. Common expressions: \`0 9 * * *\` daily 9 AM; \`0 9 * * 1-5\` weekdays 9 AM; \`0 */4 * * *\` every 4 h; \`0 0 1 * *\` first of month; \`*/15 * * * *\` every 15 min.

### Cron (one-shot)

Omit \`expression\` (set \`""\`) and set \`runOnce: true\` + \`runAt\` (ISO 8601, treated as UTC):

\`\`\`json
"config": { "expression": "", "timezone": "UTC", "runOnce": true, "runAt": "2026-05-15T17:00:00Z", "payload": { "topic": "Q2 review prep" } }
\`\`\`

After firing, the trigger auto-disables and \`config.completedAt\` is set. If the server was down at \`runAt\` past the grace window, the trigger is marked errored with \`config.missedAt\`. One-shot fires also get \`{{cron.runAt}}\`.

### Validate a cron expression

\`POST /api/triggers/validate-cron\` — \`{ "expression": "0 9 * * 1-5", "timezone": "America/Mexico_City" }\` → \`{ "valid": true, "nextFires": ["2026-05-11T15:00:00.000Z", ...] }\` or \`{ "valid": false, "error": "..." }\`.

### Slack

\`\`\`json
"type": "slack",
"config": { "channelId": "C0123456789", "messagePattern": "approve|deny" },
"promptTemplate": "Process approval request from @{{slack.user}}: {{slack.message}}"
\`\`\`

### Email

\`\`\`json
"type": "email",
"matchMode": "llm",
"config": { "subjectPattern": "urgent|critical" },
"llmMatch": { "prompt": "Is this a real customer escalation requiring same-day reply?" },
"promptTemplate": "Handle customer inquiry from {{email.from}}: {{email.subject}}\\n\\n{{email.body}}"
\`\`\`

### Jira

\`\`\`json
"type": "jira",
"config": { "projectKey": "INCIDENT", "events": ["jira:issue_created"], "jqlFilter": "priority = P1" },
"promptTemplate": "Respond to P1 incident {{jira.issueKey}}: {{jira.summary}}"
\`\`\`

### WhatsApp

\`\`\`json
"type": "whatsapp",
"config": { "direction": "inbound", "dmOnly": true, "bodyPattern": "order" },
"promptTemplate": "Reply to {{whatsapp.fromName}} ({{whatsapp.from}}): {{whatsapp.body}}"
\`\`\`

### Bitbucket Cloud

Use \`type: "bitbucket"\` so the trigger gets the typed UI (workspace / repo-slug / event-key fields). The central receiver at \`POST /api/triggers/webhook/:triggerId\` accepts both \`webhook\` and \`bitbucket\` types; its signature, dedupe, and author-loop helpers auto-detect the Bitbucket vs GitHub flavor from request headers, so the type is purely UI/metadata. Config is webhook-style:

\`\`\`json
"type": "bitbucket",
"config": {
  "method": "POST",
  "secret": "GENERATE_A_RANDOM_HIGH_ENTROPY_STRING",
  "extractFields": ["pullrequest.id", "pullrequest.title", "repository.full_name", "actor.nickname"]
},
"promptTemplate": "Review pull request #{{pullrequest.id}} on {{repository.full_name}}: {{pullrequest.title}}"
\`\`\`

After creation, paste the per-trigger URL \`http://<public-host>/api/triggers/webhook/TRIGGER_ID\` and the same secret into Bitbucket → Repository settings → Webhooks. The receiver verifies \`X-Hub-Signature\` (Bitbucket HMAC-SHA256), dedupes retries via \`X-Request-UUID\`, and respects an author-loop guard via the \`BITBUCKET_BOT_USERNAME\` env var. See \`docs/bitbucket-pr-review.md\` and the \`bitbucket-reviewer\` skill (agent-side prompt).

## Matching Modes

| Mode | How It Works | Best For |
|---|---|---|
| \`structural\` | Per-handler field matching (regex/equality on the typed payload) | Predictable, structured events |
| \`llm\` | LLM (Haiku by default) evaluates relevance given \`llmMatch.prompt\` | Complex, semantic matching |
| \`hybrid\` | Structural pre-filter; if it passes, LLM verifies | Balance of speed and cost |

For \`llm\` and \`hybrid\`, also set:

\`\`\`json
"llmMatch": { "prompt": "Natural-language condition the event must satisfy", "model": "haiku", "temperature": 0, "maxTokens": 150, "minConfidence": 0.6 }
\`\`\`

## LLM Variable Extraction

To pull free-form variables out of unstructured payloads, set:

\`\`\`json
"extractionMode": "llm",
"llmExtract": { "prompt": "Extract the customer's account ID and request type", "variables": ["accountId", "requestType"] }
\`\`\`

Extracted variables are merged on top of the structural variables before prompt interpolation.

## Test, Fire, History, Diagnostics

- Dry-run the full match + extract pipeline without firing the agent: \`POST /api/triggers/TRIGGER_ID/test-match\` — \`{ "payload": { "messageText": "urgent: fix the database", "sender": "alice@example.com" } }\`, or a fully-formed event under \`event\`: \`{ "event": { "source": "slack", "type": "message", "data": { ... }, "timestamp": 1700000000000 } }\`. Response (\`TestMatchResult\` from \`src/packages/shared/trigger-types.ts\`):

\`\`\`json
{
  "structuralMatch": true,
  "llmMatch": { "match": true, "confidence": 0.92, "reason": "...", "durationMs": 412, "model": "haiku", "tokensUsed": 84 },
  "extractedVariables": { "slack.user": "alice", "slack.message": "..." },
  "wouldFire": true,
  "matcherExecutions": [ ... ]
}
\`\`\`

- Fire manually (bypasses match logic, fires the agent with supplied variables): \`POST /api/triggers/TRIGGER_ID/fire\` — \`{ "variables": { "requester": "alice@example.com", "priority": "high" }, "payload": { "raw": "optional raw payload, recorded with the fire" } }\`
- Fire history: \`GET /api/triggers/TRIGGER_ID/events?limit=10\` — recent fire records (\`TriggerFireRow\` from \`src/packages/shared/trigger-types.ts\`) with status, variables, payload, LLM results, duration
- All matchers that ran for one trigger event: \`GET /api/triggers/events/EVENT_ID/matchers\`
- Matcher-execution history across all events: \`GET /api/triggers/TRIGGER_ID/matcher-history?limit=100\`
- Every matcher evaluated against a specific source message (e.g. one Slack ts): \`GET /api/triggers/matchers/by-source/SOURCE_TYPE/SOURCE_ID\`

## Template Variables

Every fire receives \`{{trigger.name}}\` and \`{{timestamp}}\` (ISO string). Per type:

- **Webhook**: \`{{payload}}\` (full request body, JSON-stringified); one variable per \`config.extractFields\` dotted path
- **Cron**: \`{{cron.expression}}\` (recurring only), \`{{cron.scheduledAt}}\` (ISO), \`{{cron.runAt}}\` (one-shot only); each \`config.payload\` key as a top-level variable
- **Slack**: \`{{slack.user}}\`, \`{{slack.userId}}\`, \`{{slack.message}}\`, \`{{slack.channel}}\`, \`{{slack.threadTs}}\`, \`{{slack.fileCount}}\`, \`{{slack.fileIds}}\`, \`{{slack.fileNames}}\`, \`{{slack.instanceId}}\`
- **Email**: \`{{email.from}}\`, \`{{email.to}}\`, \`{{email.subject}}\`, \`{{email.body}}\`, \`{{email.threadId}}\`, \`{{email.messageId}}\`, \`{{email.date}}\`, \`{{email.hasAttachments}}\`, \`{{email.attachments}}\`, \`{{email.direction}}\`, \`{{email.labels}}\`
- **Jira**: \`{{jira.issueKey}}\`, \`{{jira.issueId}}\`, \`{{jira.summary}}\`, \`{{jira.status}}\`, \`{{jira.project}}\`, \`{{jira.projectName}}\`, \`{{jira.issueType}}\`, \`{{jira.priority}}\`, \`{{jira.assignee}}\`, \`{{jira.reporter}}\`, \`{{jira.user}}\`, \`{{jira.eventType}}\`, \`{{jira.labels}}\`, \`{{jira.changes}}\`, \`{{jira.commentAuthor}}\`, \`{{jira.commentBody}}\`
- **WhatsApp**: \`{{whatsapp.from}}\`, \`{{whatsapp.fromName}}\`, \`{{whatsapp.body}}\`, \`{{whatsapp.sessionId}}\`, \`{{whatsapp.chatId}}\`, \`{{whatsapp.isGroup}}\`, \`{{whatsapp.groupName}}\`, \`{{whatsapp.direction}}\`, \`{{whatsapp.mediaType}}\`, \`{{whatsapp.mediaUrl}}\`, \`{{whatsapp.timestamp}}\`

## Rate Limiting

10 fires per minute per trigger, hardcoded (\`RATE_LIMIT_MAX\` in \`src/packages/server/services/trigger-service.ts\`), not configurable via the API. Excess requests are dropped silently — check fire history if a trigger appears to miss events.

## Webhook Security

When \`config.secret\` is set, the receiver requires one of:

| Mechanism | Header | Body input |
|---|---|---|
| HMAC-SHA256 (GitHub style) | \`X-Hub-Signature-256: sha256=<hex>\` | Raw request bytes |
| HMAC-SHA256 (Bitbucket style) | \`X-Hub-Signature: sha256=<hex>\` | Raw request bytes |
| Plain shared secret | \`X-Webhook-Secret: <secret>\` | Header value compared directly to \`config.secret\` |

Requests with no signature are rejected with \`401 { "error": "Missing signature" }\`. Retries are deduped via \`X-Request-UUID\` (Bitbucket) or \`X-GitHub-Delivery\` (GitHub) within a 10-minute window. If \`config.secret\` is unset, the endpoint accepts any POST — only acceptable behind a trusted network or dedicated path.

## Design Guidelines

1. Clear, action-oriented names ("Daily Report", "Slack Approval Processor")
2. Specific prompts: tell the agent what to do with the event data
3. Start with \`structural\` for simple patterns; use \`hybrid\` to gate LLM calls behind a cheap pre-filter
4. Always run \`/test-match\` before enabling a trigger that fires on production traffic
5. Reference only variables that exist for that trigger type
6. Use the matcher-diagnostics endpoints to see exactly which matcher passed/failed and why
`,
};
