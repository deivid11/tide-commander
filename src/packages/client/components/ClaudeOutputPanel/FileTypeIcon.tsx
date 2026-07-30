/**
 * FileTypeIcon - vscode-icons glyph for a file path, sized for inline chips.
 *
 * Shared by the live (OutputLine) and history (HistoryLine) renderers so a file
 * chip looks identical before and after a reload.
 */

import React from 'react';
import { getIconForFileName } from '../FileExplorerPanel/fileUtils';

interface FileTypeIconProps {
  /** Full path or bare filename — only the basename drives the icon. */
  path: string;
  size?: number;
  className?: string;
}

export function FileTypeIcon({ path, size = 12, className }: FileTypeIconProps) {
  const name = path.split('/').pop() || path;
  return (
    <img
      src={getIconForFileName(name)}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={size}
      height={size}
      className={className ? `file-type-icon ${className}` : 'file-type-icon'}
    />
  );
}
