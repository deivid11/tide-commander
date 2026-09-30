/**
 * Bash row param for a command that writes files (`cat > f <<'EOF'`, `sed -i`):
 * file chips that open the file viewer instead of a one-line heredoc dump.
 * Shared by OutputLine (live) and HistoryLine (both views) so the row renders
 * the same before and after a reload.
 */

import React from 'react';
import { formatShellWriteFollowUp, type ShellWriteSummary } from '../../utils/outputRendering';
import type { EditData } from './types';
import { resolveAgentFileReference } from '../../utils/filePaths';
import { FileTypeIcon } from './FileTypeIcon';
import { filePreviewHandlers } from './toolPreviewHover';
import { MISSING_FILE_TITLE, useMissingFiles } from '../../utils/fileExistence';

interface ShellWriteParamProps {
  summary: ShellWriteSummary;
  agentCwd?: string;
  onFileClick?: (path: string, editData?: EditData) => void;
  /** Row-level click (full command + output modal). */
  onClick?: () => void;
  title?: string;
}

export const ShellWriteParam = React.memo(function ShellWriteParam({
  summary,
  agentCwd,
  onFileClick,
  onClick,
  title,
}: ShellWriteParamProps) {
  const followUp = formatShellWriteFollowUp(summary.otherCommands);
  const resolvedPaths = summary.paths.map((path) => resolveAgentFileReference(path, agentCwd).path);
  // Only exact paths (absolute, or joined onto a `cd` in the same command) are
  // checked: a bare name ran wherever the shell happened to be, which the
  // agent cwd is only a guess of.
  const missing = useMissingFiles(resolvedPaths.filter((_, index) => summary.paths[index].startsWith('/')), true, agentCwd);
  return (
    <span
      className="output-tool-param bash-command bash-write-param"
      onClick={onClick}
      title={title}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      {summary.paths.map((path, index) => {
        const resolvedPath = resolvedPaths[index];
        const isMissing = missing.has(resolvedPath);
        const open = (event: React.SyntheticEvent) => {
          if (!onFileClick) return;
          event.stopPropagation();
          // Ask for the diff, not just the file. A patch script states its own
          // replacements, so the modal can rebuild the original exactly; for a
          // plain redirect/sed it falls back to git.
          const replacements = summary.replacements[path];
          onFileClick(path, {
            oldString: '',
            newString: '',
            operation: 'shell-write',
            ...(replacements ? { replacements } : {}),
          });
        };
        return (
          <span
            key={path}
            className={`codex-file-chip ${onFileClick ? 'is-clickable' : ''}${isMissing ? ' is-missing' : ''}`}
            title={isMissing ? `${resolvedPath}\n${MISSING_FILE_TITLE}` : resolvedPath}
            role={onFileClick ? 'button' : undefined}
            tabIndex={onFileClick ? 0 : undefined}
            onClick={open}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                open(event);
              }
            }}
            {...filePreviewHandlers(path, agentCwd)}
          >
            <FileTypeIcon path={path} size={12} />
            <span>{path.split('/').pop() || path}</span>
          </span>
        );
      })}
      {followUp && <span className="bash-write-follow-up">{followUp}</span>}
    </span>
  );
});
