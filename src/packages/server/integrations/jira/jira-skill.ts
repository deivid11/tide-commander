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

Manage Jira issues through the proxy API. Auth headers are added automatically by the system.
All Jira credentials (base URL, email, API token) are handled server-side - never include them in requests.

## Quick Reference

**Search recent issues:**
\`\`\`bash
curl -s "http://localhost:5174/api/jira/search?jql=created%20%3E%3D%20-30d%20ORDER%20BY%20created%20DESC&maxResults=5"
\`\`\`

**Get a specific issue:**
\`\`\`bash
curl -s http://localhost:5174/api/jira/issues/SD-1234
\`\`\`

**Create an issue:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/jira/issues \\
  -H "Content-Type: application/json" \\
  -d '{"summary":"Issue title","description":"Details here"}'
\`\`\`
If projectKey and issueType are omitted, configured defaults are used.

---

## Search (JQL)

\`\`\`bash
curl -s "http://localhost:5174/api/jira/search?jql=QUERY&maxResults=N&startAt=0"
\`\`\`

Returns flat issue objects with key, summary, status, priority, assignee, issueType, project, created, updated, and labels inline - no extra API calls needed.

Query params: \`jql\` (required), \`maxResults\` (default 25), \`startAt\` (default 0), \`fields\` (comma-separated, optional override)

**IMPORTANT: Jira Cloud rejects unbounded JQL.** Always include a filter like \`project = X\`, \`created >= -30d\`, or similar.

### Common JQL Recipes

\`\`\`
# Last N issues across all projects
created >= -30d ORDER BY created DESC

# Issues by project
project = SD ORDER BY created DESC

# Open issues
project = SD AND status != Done ORDER BY updated DESC

# Issues assigned to someone
project = SD AND assignee = "user@email.com" ORDER BY created DESC

# Search by keyword in summary
project = SD AND summary ~ "vpn" ORDER BY created DESC

# Issues with specific label
project = SD AND labels = "release" ORDER BY created DESC

# Recently updated
updated >= -7d ORDER BY updated DESC
\`\`\`

Remember to URL-encode the jql value in the query string (spaces as %20, = as %3D, etc.), or use curl --data-urlencode:
\`\`\`bash
curl -s -G http://localhost:5174/api/jira/search --data-urlencode "jql=project = SD ORDER BY created DESC" --data-urlencode "maxResults=10"
\`\`\`

## Get Issue

\`\`\`bash
curl -s http://localhost:5174/api/jira/issues/SD-1234
\`\`\`

Returns full Jira issue with all fields including description, comments count, etc.

## Create Issue

\`\`\`bash
curl -s -X POST http://localhost:5174/api/jira/issues \\
  -H "Content-Type: application/json" \\
  -d '{
    "projectKey": "SD",
    "issueType": "Task",
    "summary": "Issue title",
    "description": "Issue description",
    "priority": "Medium",
    "labels": ["tag1", "tag2"]
  }'
\`\`\`

\`projectKey\` and \`issueType\` are optional if defaults are configured in the integration settings.
Returns: \`{ "key": "SD-1234", "id": "10042", "self": "..." }\`

## Update Issue

\`\`\`bash
curl -s -X PATCH http://localhost:5174/api/jira/issues/SD-1234 \\
  -H "Content-Type: application/json" \\
  -d '{"summary": "Updated title", "priority": "High"}'
\`\`\`

## Comments

**Add a comment:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/jira/issues/SD-1234/comments \\
  -H "Content-Type: application/json" \\
  -d '{"body": "Comment text here"}'
\`\`\`

**Get comments:**
\`\`\`bash
curl -s http://localhost:5174/api/jira/issues/SD-1234/comments
\`\`\`

## Transitions (Change Status)

**List available transitions:**
\`\`\`bash
curl -s http://localhost:5174/api/jira/issues/SD-1234/transitions
\`\`\`

**Apply a transition:**
\`\`\`bash
curl -s -X POST http://localhost:5174/api/jira/issues/SD-1234/transitions \\
  -H "Content-Type: application/json" \\
  -d '{"transitionId": "31", "comment": "Transition reason"}'
\`\`\`

## Service Desk Requests

\`\`\`bash
curl -s -X POST http://localhost:5174/api/jira/service-desk/1/requests \\
  -H "Content-Type: application/json" \\
  -d '{"requestTypeId": "10", "summary": "Request title", "description": "Details"}'
\`\`\`

## Custom Fields

Pass custom fields via the \`customFields\` object when creating or updating. Field mappings (friendly name to Jira field ID) are configured in integration settings.

\`\`\`bash
curl -s -X POST http://localhost:5174/api/jira/issues \\
  -H "Content-Type: application/json" \\
  -d '{"summary": "Release v2.1.0", "customFields": {"release_name": "v2.1.0", "environment": "production"}}'
\`\`\`

## Notes
- Auth headers are added automatically by the system.
- The proxy handles all Jira authentication - never include Jira credentials in requests.
- All text is automatically converted to Atlassian Document Format (ADF) by the proxy.
- Use \`curl -s -G ... --data-urlencode\` for JQL queries with special characters.
`,
};
