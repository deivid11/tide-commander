/**
 * Google Calendar Skill
 * BuiltinSkillDefinition with curl instructions for agents to manage calendar events.
 */

import type { BuiltinSkillDefinition } from '../../data/builtin-skills/types.js';

export const calendarSkill: BuiltinSkillDefinition = {
  slug: 'google-calendar',
  name: 'Google Calendar',
  description: 'Create and manage Google Calendar events',
  allowedTools: ['Bash(curl:*)'],
  content: `# Google Calendar

## Create an Event

\`\`\`bash
curl -s -X POST http://localhost:5174/api/calendar/events \\
  -H "Content-Type: application/json" \\
  -d '{"summary":"Release v2.1.0","description":"CC approved release","startDateTime":"2024-03-15T22:00:00-06:00","endDateTime":"2024-03-15T23:00:00-06:00","attendees":["dev@company.com","lead@company.com"]}'
\`\`\`

Optional fields: \`location\`, \`calendarId\` (default: primary), \`agentId\` (for audit logging).

## List Upcoming Events

\`\`\`bash
curl -s "http://localhost:5174/api/calendar/events?timeMin=$(date -u +%Y-%m-%dT%H:%M:%SZ)&maxResults=10"
\`\`\`

Query params: \`timeMin\`, \`timeMax\` (ISO 8601), \`maxResults\`, \`calendarId\`.

## Get a Single Event

\`\`\`bash
curl -s "http://localhost:5174/api/calendar/events/EVENT_ID"
\`\`\`

## Update an Event

\`\`\`bash
curl -s -X PATCH http://localhost:5174/api/calendar/events/EVENT_ID \\
  -H "Content-Type: application/json" \\
  -d '{"summary":"Updated title","attendees":["dev@company.com","newdev@company.com"]}'
\`\`\`

Only include fields you want to change.

## Delete an Event

\`\`\`bash
curl -s -X DELETE "http://localhost:5174/api/calendar/events/EVENT_ID"
\`\`\`

## Calculate Working Days

\`\`\`bash
curl -s -X POST http://localhost:5174/api/calendar/working-days \\
  -H "Content-Type: application/json" \\
  -d '{"targetDate":"2024-03-20"}'
\`\`\`

Returns \`{ workingDays, isUrgent, holidays }\`. Excludes weekends and configured holidays.
Optional: \`startDate\` (default: today), \`holidays\` (array of ISO dates to override config).

## Notes
- All datetimes must be ISO 8601 format with timezone offset (e.g. "2024-03-15T22:00:00-06:00").
- Attendees receive Google Calendar invitations automatically.
- The event link (\`htmlLink\`) in the response can be shared in Slack or email.
- Auth headers are added automatically by the system.
`,
};
