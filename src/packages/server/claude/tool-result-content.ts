/**
 * Serialization of Anthropic tool_result content blocks into the plain text the
 * terminal renders.
 *
 * A `Read` on an image file answers with an inline base64 block. Naively
 * `JSON.stringify`-ing that content ships the whole payload — one real session
 * here carried a 439 KB single message, and its 880-message history weighed
 * 4.5 MB of which ~2 MB was base64 — through the history endpoint, the live
 * WebSocket stream, and finally into a DOM text node nobody can read. Images
 * collapse to a one-line placeholder instead; everything else is unchanged.
 */

interface Base64ImageSource {
  type?: string;
  data?: string;
  media_type?: string;
}

interface ContentBlock {
  type?: string;
  text?: string;
  source?: Base64ImageSource;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Replace inline base64 image blocks with a compact placeholder. Returns the
 * value unchanged when it holds no such block, so non-image tool results keep
 * their exact previous serialization.
 */
function stripInlineImages(content: unknown): unknown {
  if (!Array.isArray(content)) return content;

  let replaced = false;
  const blocks = content.map((raw) => {
    const block = raw as ContentBlock;
    if (block?.type !== 'image' || block.source?.type !== 'base64') return raw;

    const data = block.source.data ?? '';
    // base64 encodes 3 bytes per 4 chars.
    const bytes = Math.floor((data.length * 3) / 4);
    const mediaType = block.source.media_type || 'image';
    replaced = true;
    return { type: 'text', text: `[Image: ${mediaType}, ${formatBytes(bytes)}]` };
  });

  return replaced ? blocks : content;
}

/**
 * Serialize a tool_result block's `content` to the string the terminal shows.
 * Strings pass through; block arrays are stripped of inline base64 images first.
 */
export function serializeToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  return JSON.stringify(stripInlineImages(content));
}
