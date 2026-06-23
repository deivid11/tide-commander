/**
 * Pure utility for stripping server-injected file/folder context blocks
 * from user message content before display in chat history.
 *
 * Two formats are supported:
 *   - Legacy: <file path="...">...</file> / <folder path="...">...</folder>
 *   - Current: <archivos_contexto><archivo ruta="..."><![CDATA[...]]></archivo></archivos_contexto>
 *
 * Both are produced by expandFileMentions() on the server. In the chat UI we
 * replace them with compact chips so the history stays readable.
 */

// Legacy format: <file path="...">...</file> and <folder path="...">...</folder>
const FILE_MENTION_BLOCK_RE = /<(file|folder) path="([^"]+)">([\s\S]*?)<\/\1>/g;

// Current format: outer <archivos_contexto> wrapper
const ARCHIVOS_CONTEXTO_RE = /<archivos_contexto>([\s\S]*?)<\/archivos_contexto>/g;

// Current format: individual <archivo ruta="..."> blocks inside the wrapper
const ARCHIVO_BLOCK_RE = /<archivo ruta="([^"]+)">([\s\S]*?)<\/archivo>/g;

// Agent mentions: <agentes_contexto> wrapper and the <agente ... nombre="..."/> entries inside it
const AGENTES_CONTEXTO_RE = /<agentes_contexto>([\s\S]*?)<\/agentes_contexto>/g;
const AGENTE_BLOCK_RE = /<agente[^>]*\bnombre="([^"]+)"[^>]*\/?>/g;

// Server-injected internal guidance (path-format hints for the LLM).
// Stripped from chat history so the user only sees their own text.
const INSTRUCCIONES_INTERNAS_RE = /<instrucciones_internas>[\s\S]*?<\/instrucciones_internas>/g;

export interface FileMentionChip {
  path: string; // file/folder path, or the agent name for agent chips
  type: 'file' | 'dir' | 'agent';
}

/**
 * Extract file/folder context blocks injected by the server.
 * Returns the cleaned display string (blocks removed) and a chip list
 * that the UI renders as compact file/folder badges.
 */
export function extractFileMentionBlocks(content: string): {
  displayContent: string;
  chips: FileMentionChip[];
} {
  const chips: FileMentionChip[] = [];

  // Current format: strip <archivos_contexto> wrapper and collect <archivo ruta> chips
  ARCHIVOS_CONTEXTO_RE.lastIndex = 0;
  let displayContent = content.replace(ARCHIVOS_CONTEXTO_RE, (_match, inner: string) => {
    ARCHIVO_BLOCK_RE.lastIndex = 0;
    const seen = new Set(chips.map((c) => c.path));
    let m;
    while ((m = ARCHIVO_BLOCK_RE.exec(inner)) !== null) {
      const filePath = m[1];
      if (!seen.has(filePath)) {
        seen.add(filePath);
        chips.push({ path: filePath, type: 'file' });
      }
    }
    return '';
  });

  // Agent mentions: strip the <agentes_contexto> wrapper and collect agent chips
  AGENTES_CONTEXTO_RE.lastIndex = 0;
  displayContent = displayContent.replace(AGENTES_CONTEXTO_RE, (_match, inner: string) => {
    AGENTE_BLOCK_RE.lastIndex = 0;
    const seen = new Set(chips.filter((c) => c.type === 'agent').map((c) => c.path));
    let m;
    while ((m = AGENTE_BLOCK_RE.exec(inner)) !== null) {
      const agentName = m[1];
      if (!seen.has(agentName)) {
        seen.add(agentName);
        chips.push({ path: agentName, type: 'agent' });
      }
    }
    return '';
  });

  // Legacy format: <file path="..."> and <folder path="...">
  FILE_MENTION_BLOCK_RE.lastIndex = 0;
  displayContent = displayContent.replace(FILE_MENTION_BLOCK_RE, (_, tag, filePath) => {
    chips.push({ path: filePath, type: tag === 'folder' ? 'dir' : 'file' });
    return '';
  });

  // Strip the internal path-format guidance the server injects alongside file context
  INSTRUCCIONES_INTERNAS_RE.lastIndex = 0;
  displayContent = displayContent.replace(INSTRUCCIONES_INTERNAS_RE, '');

  // Strip "Petición: " prefix that the server prepends to user text in the current format
  displayContent = displayContent.replace(/^Petición:\s*/m, '');

  displayContent = displayContent.replace(/^\s*\n+/, '').replace(/\n{3,}/g, '\n\n').trim();
  return { displayContent, chips };
}
