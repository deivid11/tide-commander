/**
 * Google Drive Skill
 * BuiltinSkillDefinition with curl instructions for agents to manage Drive files.
 */

import type { BuiltinSkillDefinition } from '../../data/builtin-skills/types.js';

export const driveSkill: BuiltinSkillDefinition = {
  slug: 'google-drive',
  name: 'Google Drive',
  description: 'Read, create, edit, and search files in Google Drive',
  allowedTools: ['Bash(curl:*)'],
  content: `# Google Drive

## List Files

\`\`\`bash
curl -s "http://localhost:5174/api/drive/files?maxResults=20"
\`\`\`

Query params: \`folderId\`, \`mimeType\`, \`maxResults\`, \`pageToken\`, \`orderBy\` (default: \`modifiedTime desc\`), \`trashed\` (true/false), \`driveId\` (scope to a Shared Drive), \`includeItemsFromAllDrives\` (true/false — include files from all Shared Drives).

## Get File Metadata

\`\`\`bash
curl -s "http://localhost:5174/api/drive/files/FILE_ID"
\`\`\`

## Read File Content

\`\`\`bash
curl -s "http://localhost:5174/api/drive/files/FILE_ID/content"
\`\`\`

For Google Docs/Sheets/Slides, content is automatically exported as text. Override with \`?exportAs=text/html\` or \`?exportAs=application/pdf\`.

Export format defaults:
- Google Docs -> text/plain
- Google Sheets -> text/csv
- Google Slides -> text/plain

## Create a File

\`\`\`bash
curl -s -X POST http://localhost:5174/api/drive/files \\
  -H "Content-Type: application/json" \\
  -d '{"name":"report.txt","content":"File contents here","mimeType":"text/plain"}'
\`\`\`

Optional fields: \`folderId\`, \`description\`, \`agentId\` (for audit logging).

To create a Google Doc instead of a plain file, use \`mimeType: "application/vnd.google-apps.document"\` and provide the content as plain text or HTML.

## Copy a File (Create from Template)

\`\`\`bash
curl -s -X POST http://localhost:5174/api/drive/files/TEMPLATE_FILE_ID/copy \\
  -H "Content-Type: application/json" \\
  -d '{"name":"New Document From Template","folderId":"OPTIONAL_DESTINATION_FOLDER"}'
\`\`\`

Duplicates an existing Drive file into a new one. Typically used to instantiate a document from a template (e.g. a Google Doc template). Body fields:
- \`name\` — optional new name (defaults to \"Copy of <original>\").
- \`folderId\` — optional destination folder; defaults to the source file's parent.
- \`description\` — optional description for the copy.
- \`agentId\`, \`workflowInstanceId\` — optional audit logging fields.

Works for both My Drive files and files inside Shared Drives.

## Update a File

\`\`\`bash
curl -s -X PATCH http://localhost:5174/api/drive/files/FILE_ID \\
  -H "Content-Type: application/json" \\
  -d '{"content":"Updated file contents","name":"renamed.txt"}'
\`\`\`

Only include fields you want to change: \`content\`, \`name\`, \`description\`, \`mimeType\`.

Note: sending \`content\` overwrites the entire file body. To edit a Google Doc in-place while preserving formatting, use the replace-text endpoint below.

## Move a File

\`\`\`bash
curl -s -X POST http://localhost:5174/api/drive/files/FILE_ID/move \\
  -H "Content-Type: application/json" \\
  -d '{"folderId":"TARGET_FOLDER_ID"}'
\`\`\`

Moves a file between folders, including across My Drive and Shared Drives. Use \`"folderId":"root"\` to move a file into the authenticated user's My Drive root.

Body fields:
- \`folderId\` — required destination folder. Use \`"root"\` for My Drive root.
- \`removeFromFolderIds\` — optional list of parent folders to detach. If omitted, every current parent is removed so the file ends up only in the destination.
- \`agentId\`, \`workflowInstanceId\` — optional audit logging fields.

## Find and Replace Text in a Google Doc

\`\`\`bash
curl -s -X POST http://localhost:5174/api/drive/files/FILE_ID/replace-text \\
  -H "Content-Type: application/json" \\
  -d '{"replacements":[{"find":"Título del documento","replace":"My New Title"},{"find":"dd/mm/aaa","replace":"2026-04-16"}]}'
\`\`\`

Convenience wrapper around the Docs API \`replaceAllText\` and \`insertText\` operations. Preserves all existing formatting (fonts, headings, tables, images). Ideal for filling in templates that contain placeholder text.

Body fields:
- \`replacements\` — array of \`{ find, replace, matchCase? }\` pairs. Each pair becomes a \`replaceAllText\` operation.
- \`appendText\` — optional plain text appended to the end of the document after all replacements run.
- \`agentId\`, \`workflowInstanceId\` — optional audit logging fields.

Response: \`{ fileId, totalOccurrencesChanged, appended }\`.

Only works on native Google Docs (\`application/vnd.google-apps.document\`). For non-Doc files, use \`PATCH /api/drive/files/FILE_ID\` instead.

## Google Docs API (Advanced)

For fine-grained control over Google Docs (beyond simple find/replace), use the Docs API passthrough endpoints. These operate only on native Google Docs.

### Create a Blank Google Doc

\`\`\`bash
curl -s -X POST http://localhost:5174/api/drive/docs \\
  -H "Content-Type: application/json" \\
  -d '{"title":"My New Document"}'
\`\`\`

Creates a blank Google Doc via the Docs API. Returns the same DriveFile shape as \`POST /files\`. To create a Doc with initial content converted from HTML or plain text, use \`POST /files\` with \`mimeType: "application/vnd.google-apps.document"\` instead.

### Get the Structured Document

\`\`\`bash
curl -s "http://localhost:5174/api/drive/docs/DOC_ID"
\`\`\`

Returns the full Docs API \`Document\` resource: body (with content elements — paragraphs, tables, section breaks), headers, footers, footnotes, inline objects (images, drawings), positioned objects, lists, named ranges, named styles, document style, revision metadata. Much richer than \`GET /files/:fileId/content\` (which only returns exported plain text).

Useful for:
- Finding exact insertion indexes for \`batch-update\` operations
- Extracting the document outline (headings, table of contents)
- Introspecting table structure, list IDs, named ranges

### Batch Update (Full Docs API Access)

\`\`\`bash
curl -s -X POST http://localhost:5174/api/drive/docs/DOC_ID/batch-update \\
  -H "Content-Type: application/json" \\
  -d '{"requests":[{"insertText":{"location":{"index":1},"text":"Hello world"}}]}'
\`\`\`

Generic passthrough to \`documents.batchUpdate\`. Accepts the raw Docs API \`requests\` array, so every Docs API mutation type is supported with no additional server code.

Body fields:
- \`requests\` — array of Docs API request objects (required, non-empty).
- \`writeControl\` — optional \`{ requiredRevisionId }\` or \`{ targetRevisionId }\` for optimistic concurrency.
- \`agentId\`, \`workflowInstanceId\` — optional audit logging fields.

Response: \`{ documentId, replies, writeControl }\`. The \`replies\` array matches the \`requests\` array positionally — some request types (createNamedRange, insertInlineImage, createFootnote) return IDs in their reply.

**Common request types** (see the Google Docs API reference for the full list):

| Category | Request Types |
|---|---|
| Text | \`insertText\`, \`deleteContentRange\`, \`replaceAllText\` |
| Formatting | \`updateTextStyle\`, \`updateParagraphStyle\`, \`updateDocumentStyle\`, \`updateSectionStyle\` |
| Structure | \`insertSectionBreak\`, \`insertPageBreak\`, \`insertTable\`, \`insertTableRow\`, \`insertTableColumn\`, \`deleteTableRow\`, \`deleteTableColumn\`, \`updateTableCellStyle\`, \`updateTableColumnProperties\`, \`updateTableRowStyle\`, \`mergeTableCells\`, \`unmergeTableCells\`, \`pinTableHeaderRows\` |
| Lists | \`createParagraphBullets\`, \`deleteParagraphBullets\` |
| Images | \`insertInlineImage\`, \`replaceImage\` |
| Headers / Footers | \`createHeader\`, \`createFooter\`, \`deleteHeader\`, \`deleteFooter\` |
| Footnotes | \`createFootnote\` |
| Named Ranges | \`createNamedRange\`, \`deleteNamedRange\`, \`replaceNamedRangeContent\` |
| Positioned Objects | \`deletePositionedObject\` |

**Index tips:** Every element in a Doc has a numeric start/end index (1 = body start). Use \`GET /docs/:docId\` to inspect \`body.content[].startIndex\` / \`endIndex\` to target specific locations. Index 1 is before the first character; the body always ends with a trailing newline.

**Example — add a bold, centered title at the top:**
\`\`\`json
{
  "requests": [
    { "insertText": { "location": { "index": 1 }, "text": "My Title\\n" } },
    { "updateParagraphStyle": { "range": { "startIndex": 1, "endIndex": 10 }, "paragraphStyle": { "namedStyleType": "HEADING_1", "alignment": "CENTER" }, "fields": "namedStyleType,alignment" } },
    { "updateTextStyle": { "range": { "startIndex": 1, "endIndex": 9 }, "textStyle": { "bold": true }, "fields": "bold" } }
  ]
}
\`\`\`

**Example — insert a 2x3 table at the end of the document:**
\`\`\`json
{
  "requests": [
    { "insertTable": { "endOfSegmentLocation": {}, "rows": 2, "columns": 3 } }
  ]
}
\`\`\`

## Delete a File

\`\`\`bash
curl -s -X DELETE "http://localhost:5174/api/drive/files/FILE_ID"
\`\`\`

## Create a Folder

\`\`\`bash
curl -s -X POST http://localhost:5174/api/drive/folders \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Project Files","parentFolderId":"OPTIONAL_PARENT_ID"}'
\`\`\`

## Search Files

\`\`\`bash
curl -s "http://localhost:5174/api/drive/search?q=quarterly+report&maxResults=10"
\`\`\`

Full-text search across file names and content. Includes results from all Shared Drives the user has access to.

## List Shared Drives (Team Drives)

\`\`\`bash
curl -s "http://localhost:5174/api/drive/drives?maxResults=50"
\`\`\`

Lists every Shared Drive the authenticated user can access. Query params: \`maxResults\`, \`pageToken\`, \`q\` (filter by name), \`useDomainAdminAccess\` (true/false, admin only).

Response shape: \`{ drives: SharedDrive[], nextPageToken?: string }\`. Each drive exposes \`driveId\`, \`name\`, \`createdTime\`, \`hidden\`, \`colorRgb\`, \`themeId\`, \`backgroundImageLink\`, and \`capabilities\`.

## Get Shared Drive Metadata

\`\`\`bash
curl -s "http://localhost:5174/api/drive/drives/DRIVE_ID"
\`\`\`

## List Files Inside a Shared Drive

\`\`\`bash
curl -s "http://localhost:5174/api/drive/files?driveId=DRIVE_ID&maxResults=20"
\`\`\`

Use the \`driveId\` query param to scope file listing to a specific Shared Drive. Combine with \`folderId\` to drill into a folder within that drive.

To list files across every Shared Drive the user has access to, set \`includeItemsFromAllDrives=true\` instead of a specific \`driveId\`.

## Notes
- Auth headers are added automatically by the system.
- Google Workspace files (Docs, Sheets, Slides) are exported to text when reading content.
- File IDs can be found in Google Drive URLs or from list/search results.
- Use \`folderId\` to scope operations to a specific folder.
- Shared Drives (formerly Team Drives) are distinct from \"My Drive\" folders and require the \`driveId\` param for targeted queries.
`,
};
