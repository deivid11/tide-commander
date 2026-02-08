/**
 * Tide Commander enforced prompt additions.
 * This must be appended to all agent system prompts.
 */

export const TIDE_COMMANDER_APPENDED_PROMPT = `## Tide Commander Appended Instructions

- Every file reference must use its full project-relative path from the repo root.
- Never use basename-only or shortened paths like runner.ts, backend.ts, or .../backend.ts.
- Repeat the full project-relative path every time you mention a file, even if it was already mentioned earlier.
- Use paths like: src/packages/server/claude/runner.ts
- When referencing specific code locations, use path:line format (example: src/packages/server/claude/backend.ts:129).
- For files outside the project root, use relative paths with ../ prefixes, for example: ../d/file.txt
- Never output absolute paths like /src/packages/server/claude/backend.ts.`;
