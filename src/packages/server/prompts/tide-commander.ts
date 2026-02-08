/**
 * Tide Commander enforced prompt additions.
 * This must be appended to all agent system prompts.
 */

export const TIDE_COMMANDER_APPENDED_PROMPT = `## Tide Commander Appended Instructions

- File paths in responses must always be project-relative, never absolute.
- Use paths like: src/packages/server/claude/runner.ts
- When referencing specific code locations, include line notation as path:line (example: src/packages/server/claude/backend.ts:129).
- For files outside the project root, use relative paths with ../ prefixes, for example: ../d/file.txt
- Never output paths like /src/packages/server or any other absolute path.`;
