/**
 * Resolve a file path against an agent cwd when the path is relative.
 */
export function resolveAgentFilePath(filePath: string, cwd?: string): string {
  if (!filePath) return filePath;
  if (filePath.startsWith('/')) return filePath;
  if (!cwd || !cwd.startsWith('/')) return filePath;

  const rel = filePath.replace(/^\.\//, '');
  const cwdParts = cwd.split('/').filter(Boolean);
  const relParts = rel.split('/').filter(Boolean);
  const stack = [...cwdParts];

  for (const part of relParts) {
    if (part === '.') continue;
    if (part === '..') {
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(part);
  }

  return `/${stack.join('/')}`;
}

/**
 * Parse optional line notation from a file reference.
 * Supports `path/to/file.ts:16`, `path/to/file.ts:16:3`, and `path/to/file.ts#L16`.
 */
export function parseFilePathReference(fileRef: string): { path: string; line?: number } {
  if (!fileRef) return { path: fileRef };
  const normalized = fileRef
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/[),.;]+$/g, '');

  // Support anchors like path/to/file.ts#L16 or path/to/file.ts#L16C3
  const anchorMatch = normalized.match(/^(.*)#L(\d+)(?:C\d+)?$/i);
  if (anchorMatch) {
    return { path: anchorMatch[1], line: Number(anchorMatch[2]) };
  }

  // Support suffixes like path/to/file.ts:16 or path/to/file.ts:16:3
  const suffixMatch = normalized.match(/^(.+?\.[^:\s]+):(\d+)(?::\d+)?$/);
  if (suffixMatch && suffixMatch[1].includes('.')) {
    return { path: suffixMatch[1], line: Number(suffixMatch[2]) };
  }

  return { path: normalized };
}

/**
 * Resolve a file reference against cwd while preserving optional line notation.
 */
export function resolveAgentFileReference(fileRef: string, cwd?: string): { path: string; line?: number } {
  const parsed = parseFilePathReference(fileRef);
  return {
    path: resolveAgentFilePath(parsed.path, cwd),
    line: parsed.line,
  };
}
