/**
 * Gmail Skill
 * BuiltinSkillDefinition that provides curl-based Gmail instructions to agents.
 */

import type { BuiltinSkillDefinition } from '../../data/builtin-skills/types.js';

export const gmailSkill: BuiltinSkillDefinition = {
  slug: 'gmail-email',
  name: 'Gmail Email',
  description: 'Send and receive emails via Gmail, check for approvals',
  allowedTools: ['Bash(curl:*)'],
  content: `# Gmail Email Integration

Use these endpoints to send and receive emails, and check for approvals via Gmail.

## Send an Email

\`\`\`bash
curl -s -X POST http://localhost:5174/api/email/send \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": ["recipient@example.com"],
    "subject": "Your Subject",
    "body": "<p>HTML body here</p>",
    "bodyText": "Plain text version (optional)",
    "cc": ["cc@example.com"],
    "bcc": ["bcc@example.com"]
  }'
\`\`\`

To reply in a thread, include:
- \`"threadId": "THREAD_ID"\` — Continue an existing thread
- \`"inReplyTo": "MESSAGE_ID"\` — In-Reply-To header for the message ID

To track which agent/workflow sent the email, add:
- \`"agentId": "AGENT_ID"\`
- \`"workflowInstanceId": "WORKFLOW_ID"\`

To attach files:
\`\`\`bash
"attachments": [
  {"filename": "file.pdf", "path": "/path/to/file.pdf", "mimeType": "application/pdf"}
]
\`\`\`

## Get Recent Emails

\`\`\`bash
curl -s "http://localhost:5174/api/email/recent?query=from:user@example.com&maxResults=10"
\`\`\`

Query parameters:
- \`query\`: Gmail search query (optional, e.g. "from:email@example.com", "subject:approval")
- \`maxResults\`: Number of messages to fetch (default 10)
- \`after\`: Unix timestamp to get messages after this date (optional)

## Get a Thread

\`\`\`bash
curl -s "http://localhost:5174/api/email/thread/THREAD_ID"
\`\`\`

Returns all messages in the thread with full details (sender, recipients, body, subject, etc.)

## Check for Approvals

\`\`\`bash
curl -s -X POST http://localhost:5174/api/email/check-approvals \\
  -H "Content-Type: application/json" \\
  -d '{
    "threadId": "THREAD_ID",
    "requiredApprovers": ["approver1@example.com", "approver2@example.com"],
    "minApprovals": 2,
    "approvalKeywords": ["approved", "ok", "yes"]
  }'
\`\`\`

Parameters:
- \`threadId\`: The thread to check (required)
- \`requiredApprovers\`: List of approver emails (required)
- \`minApprovals\`: Minimum approvals needed (default: requiredApprovers.length)
- \`approvalKeywords\`: Keywords that count as approval (default: "approved, aprobado, autorizado, yes, ok")

Returns:
\`\`\`json
{
  "approved": true,
  "approvalCount": 2,
  "totalRequired": 2,
  "approvedBy": ["approver1@example.com", "approver2@example.com"],
  "pendingFrom": [],
  "details": [...]
}
\`\`\`

## Check Status

\`\`\`bash
curl -s http://localhost:5174/api/email/status
\`\`\`

Returns:
\`\`\`json
{
  "configured": true,
  "authenticated": true,
  "emailAddress": "user@gmail.com",
  "pollingActive": false,
  "lastPollAt": 1234567890,
  "lastError": null
}
\`\`\`

## Start Email Polling

\`\`\`bash
curl -s -X POST http://localhost:5174/api/email/polling/start \\
  -H "Content-Type: application/json" \\
  -d '{"intervalMs": 30000}'
\`\`\`

Polls for new emails every \`intervalMs\` milliseconds (default 30000).

## Stop Email Polling

\`\`\`bash
curl -s -X POST http://localhost:5174/api/email/polling/stop \\
  -H "Content-Type: application/json"
\`\`\`

## Notes

- Emails are logged to the event database automatically
- Approval checking looks for keywords in reply messages (case-insensitive)
- Attachments support file paths or raw content
- The Gmail account must be configured with OAuth2 credentials in the integration settings
- Default approval keywords: "approved, aprobado, autorizado, yes, ok"
`,
};
