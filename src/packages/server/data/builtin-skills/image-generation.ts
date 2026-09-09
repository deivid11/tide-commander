import type { BuiltinSkillDefinition } from './types.js';

export const imageGeneration: BuiltinSkillDefinition = {
  slug: 'image-generation',
  name: 'Image Generation',
  description:
    'Generate images from a text prompt with the OpenAI image models via the Tide Commander images API; files land in a directory you choose and render inline in the terminal.',
  allowedTools: ['Bash(curl:*)', 'Bash(jq:*)'],
  // Opt-in (it spends money): enable it per agent/class in the Skills panel.
  assignedAgentClasses: [],
  content: `# Image Generation

Turn a prompt into real image files on disk through \`POST /api/images/generate\` — never by calling api.openai.com yourself. The server holds the OpenAI key (it is never exposed to you), writes the files, and hands you back their absolute paths.

Use it when asked for an illustration, icon, logo draft, mockup, texture, diagram-as-art, avatar, banner or placeholder art. For technical diagrams (architecture, flow, sequence) prefer a Mermaid block — it stays editable and costs nothing.

All calls use the API Calling Convention scaffolding (host, \`-H "X-Auth-Token: ..."\`). No exclamation marks in commands.

## 1. Generate

\`POST /api/images/generate\`
\`\`\`json
{"agentId":"YOUR_AGENT_ID","prompt":"a watercolor lighthouse at dusk, muted teal palette","outputDir":"/abs/path/to/dir","filename":"lighthouse","size":"1024x1024","quality":"medium"}
\`\`\`

| Field | Meaning |
|---|---|
| \`prompt\` (required) | What to draw. Be specific — see the prompt rules below. |
| \`outputDir\` | Absolute directory; created if missing. Defaults to the server's generated-images folder. Must be under the home, working or temp directory. |
| \`filename\` | Base name without extension. Defaults to a slug of the prompt. Existing files are never overwritten — a \`-2\` suffix is added. |
| \`model\` | Defaults to \`gpt-image-1\`. |
| \`size\` | \`1024x1024\` (square), \`1536x1024\` (landscape), \`1024x1536\` (portrait), \`auto\`. |
| \`quality\` | \`low\`, \`medium\` (good default), \`high\`, \`auto\`. Higher costs more and takes longer. |
| \`background\` | \`transparent\` (use with \`png\` or \`webp\` for logos/icons), \`opaque\`, \`auto\`. |
| \`format\` | \`png\` (default), \`jpeg\`, \`webp\`. |
| \`n\` | How many variations, 1-10. Default 1. |

Synchronous: the response IS the result — \`ok\`, \`images[]\` (each with \`path\`, \`filename\`, \`bytes\`), \`model\`, \`timeMs\`, \`usage\`, and \`error\` when it failed. A \`high\` quality render can take 1-2 minutes, so fire it through the Streaming Exec API (or plain curl with a generous timeout) rather than letting it look frozen.

## 2. Show the user what you made

After a successful call, reference every file in your reply on its own line as:

\`[Image: /abs/path/from/the/response.png]\`

Tide Commander renders that as a clickable inline thumbnail. A path in plain prose does not render — use the exact \`[Image: ...]\` form, with the absolute path the API returned.

## 3. Check the key is configured

\`GET /api/images/status\` → \`{"configured":true,"source":"secret","maskedKey":"sk-proj-…f3a9","defaultModel":"gpt-image-1","defaultOutputDir":"..."}\`

If \`configured\` is false, tell the user to add a secret named \`OPENAI_API_KEY\` in Settings → Secrets (or set \`OPENAI_API_KEY\` in the server environment). Do not ask them to paste the key to you, and never send a key in the request body — the API ignores it.

## Prompt rules
- Describe subject, composition, style, palette and mood; name what should NOT be there only if it matters. "A flat-vector fox mascot, three-quarter view, orange and cream, thick outlines, white background" beats "a fox logo".
- State the aspect ratio through \`size\`, not in the prompt.
- Text inside images is unreliable beyond a few words — keep any lettering short and verify it in the result.
- For icons, logos and stickers: \`background: "transparent"\` with \`format: "png"\`.
- Reuse the user's own wording for brand names, colors and subjects; do not silently restyle their request.

## Rules
- Each call costs real money. Generate one image unless variations were asked for; do not silently retry a refused prompt with a reworded one — report the refusal.
- \`"ok":false\` is a **normal result to report** (content policy refusal, quota exhausted, model not available for the org), not an API error to debug. Quote the \`error\` field to the user.
- Write into the user's project or a directory they named; ask first before dropping files into a repo you are not working in.
- Do not put generated images into a git commit unless the user asked for that.
- Finish with a one-line summary (what you made, where it landed) plus the \`[Image: ...]\` reference.`,
};
