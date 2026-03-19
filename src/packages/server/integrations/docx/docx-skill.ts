/**
 * DOCX Integration - Built-in Skill Definition
 * Provides agents with curl-based instructions for document generation.
 */

import type { BuiltinSkillDefinition } from '../../data/builtin-skills/types.js';

export const docxSkill: BuiltinSkillDefinition = {
  slug: 'document-generator',
  name: 'Document Generator',
  description: 'Generate DOCX documents from templates',
  allowedTools: ['Bash(curl:*)'],
  content: `# Document Generator

## List Available Templates

\`\`\`bash
curl -s -H "X-Auth-Token: {{AUTH_TOKEN}}" "http://localhost:{{PORT}}/api/documents/templates"
\`\`\`

## Generate a Document

\`\`\`bash
curl -s -X POST -H "X-Auth-Token: {{AUTH_TOKEN}}" http://localhost:{{PORT}}/api/documents/generate \\
  -H "Content-Type: application/json" \\
  -d '{"templateId":"TEMPLATE_ID","variables":{"release_name":"v2.1.0","release_date":"2024-03-15","release_type":"Normal","requester_name":"Juan Perez"},"outputFilename":"CC-v2.1.0.docx"}'
\`\`\`

Returns the generated document metadata including the file \`path\` on disk. Use this path when sending the file as an email attachment.

## Convert to PDF

\`\`\`bash
curl -s -X POST -H "X-Auth-Token: {{AUTH_TOKEN}}" http://localhost:{{PORT}}/api/documents/convert \\
  -H "Content-Type: application/json" \\
  -d '{"sourceFileId":"GENERATED_DOC_ID","outputFormat":"pdf"}'
\`\`\`

Returns \`{ fileId, fileName, filePath }\` with the path to the PDF file.

## Notes
- Variables in the template use \`{variableName}\` syntax.
- For lists, use \`{#items}{name}{/items}\` syntax.
- For conditionals, use \`{#isUrgent}URGENT{/isUrgent}\`.
- The generated file path can be passed directly to the email send endpoint's attachments parameter.
- PDF conversion requires LibreOffice to be installed on the host.
`,
};
