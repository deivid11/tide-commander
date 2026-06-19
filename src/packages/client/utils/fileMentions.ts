/**
 * Pure utility for stripping server-injected <file>/<folder> context blocks
 * from user message content before display in chat history.
 *
 * These blocks are produced by expandFileMentions() on the server and carry
 * the full file/folder content for Claude. In the chat UI we replace them with
 * compact chips so the history stays readable.
 */

// Matches <file path="...">...</file> and <folder path="...">...</folder>
const FILE_MENTION_BLOCK_RE = /<(file|folder) path="([^"]+)">([\s\S]*?)<\/\1>/g;

export interface FileMentionChip {
  path: string;
  type: 'file' | 'dir';
}

/**
 * Extract [@file/@folder] context blocks injected by the server.
 * Returns the cleaned display string (blocks removed) and a chip list
 * that the UI renders as compact file/folder badges.
 */
export function extractFileMentionBlocks(content: string): {
  displayContent: string;
  chips: FileMentionChip[];
} {
  const chips: FileMentionChip[] = [];
  FILE_MENTION_BLOCK_RE.lastIndex = 0;
  let displayContent = content.replace(FILE_MENTION_BLOCK_RE, (_, tag, filePath) => {
    chips.push({ path: filePath, type: tag === 'folder' ? 'dir' : 'file' });
    return '';
  });
  displayContent = displayContent.replace(/^\s*\n+/, '').replace(/\n{3,}/g, '\n\n').trim();
  return { displayContent, chips };
}
