/**
 * Render-prop form of useMissingFiles, for file chips rendered inside
 * conditional branches of the big row components (OutputLine/HistoryLine)
 * where a hook cannot be called. Pass ABSOLUTE, already-resolved paths.
 */

import React from 'react';
import { useMissingFiles } from '../../utils/fileExistence';

interface WithMissingFilesProps {
  paths: readonly string[];
  /** false while the tool is still running — its file may not exist yet. */
  enabled?: boolean;
  /** Agent cwd the references were written from (lets the server resolve them like the viewer does). */
  baseDir?: string;
  children: (missing: ReadonlySet<string>) => React.ReactNode;
}

export function WithMissingFiles({ paths, enabled = true, baseDir, children }: WithMissingFilesProps) {
  const missing = useMissingFiles(paths, enabled, baseDir);
  return <>{children(missing)}</>;
}
