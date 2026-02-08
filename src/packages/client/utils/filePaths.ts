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
