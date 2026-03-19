/**
 * Jira Integration - Built-in Skill Definition
 * Provides curl-based instructions for agents to interact with Jira.
 */

import type { BuiltinSkillDefinition } from '../../data/builtin-skills/types.js';

export const jiraSkill: BuiltinSkillDefinition = {
  slug: 'jira-service-desk',
  name: 'Jira Service Desk',
  description: 'Create, update, and manage Jira Service Desk tickets',
  allowedTools: ['Bash(curl:*)'],
  content: `# Jira Service Desk

You have access to the Jira Service Desk integration. Use these endpoints via curl.

## Create a ticket

\`\`\`bash
curl -s -X POST "{{BASE_URL}}/api/jira/issues" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{
    "projectKey": "SD",
    "issueType": "Change Request",
    "summary": "CC - Release v2.1.0 - 2026-03-20",
    "description": "Control de Cambios for release v2.1.0. Requested by: John Doe. Systems affected: API, Frontend.",
    "priority": "Medium",
    "labels": ["cc", "release"]
  }'
\`\`\`
Returns: \`{ "key": "SD-1234", "id": "10042", "self": "https://..." }\`

## Get a ticket

\`\`\`bash
curl -s "{{BASE_URL}}/api/jira/issues/SD-1234" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}"
\`\`\`

## Update a ticket

\`\`\`bash
curl -s -X PATCH "{{BASE_URL}}/api/jira/issues/SD-1234" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "summary": "Updated summary", "priority": "High" }'
\`\`\`

## Add a comment

\`\`\`bash
curl -s -X POST "{{BASE_URL}}/api/jira/issues/SD-1234/comments" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "body": "CC document generated and sent for approval." }'
\`\`\`

## Transition a ticket (change status)

First, list available transitions:
\`\`\`bash
curl -s "{{BASE_URL}}/api/jira/issues/SD-1234/transitions" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}"
\`\`\`

Then transition:
\`\`\`bash
curl -s -X POST "{{BASE_URL}}/api/jira/issues/SD-1234/transitions" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{ "transitionId": "31", "comment": "Approved and release completed" }'
\`\`\`

## Search tickets (JQL)

\`\`\`bash
curl -s "{{BASE_URL}}/api/jira/search?jql=project%3DSD%20AND%20labels%3Dcc&maxResults=10" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}"
\`\`\`

## Create a Service Desk request

\`\`\`bash
curl -s -X POST "{{BASE_URL}}/api/jira/service-desk/1/requests" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{
    "requestTypeId": "10",
    "summary": "New service request",
    "description": "Details of the request"
  }'
\`\`\`

## Custom Fields

Custom fields can be passed via the \`customFields\` object when creating or updating issues.
Field mappings (workflow variable to Jira custom field IDs) are configured in the integration settings.

\`\`\`bash
curl -s -X POST "{{BASE_URL}}/api/jira/issues" \\
  -H "Content-Type: application/json" \\
  -H "X-Auth-Token: {{AUTH_TOKEN}}" \\
  -d '{
    "projectKey": "SD",
    "issueType": "Change Request",
    "summary": "Release v2.1.0",
    "description": "Details...",
    "customFields": {
      "release_name": "v2.1.0",
      "environment": "production"
    }
  }'
\`\`\`
`,
};
