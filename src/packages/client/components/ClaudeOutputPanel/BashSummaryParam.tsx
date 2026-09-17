/**
 * Bash row param for a command too long or too multi-line to read inline:
 * `5 steps · tests [outputRendering.test.ts] → grep → head +2  318 chars`.
 * Each step's file is a chip that opens the file viewer; the row click still
 * opens the full command and its output.
 */

import React from 'react';
import type { BashRowSummary } from '../../utils/outputRendering';
import { resolveAgentFileReference } from '../../utils/filePaths';
import { FileTypeIcon } from './FileTypeIcon';
import { filePreviewHandlers } from './toolPreviewHover';

interface BashSummaryParamProps {
  summary: BashRowSummary;
  agentCwd?: string;
  onFileClick?: (path: string) => void;
  onClick?: () => void;
  title?: string;
}

export const BashSummaryParam = React.memo(function BashSummaryParam({
  summary,
  agentCwd,
  onFileClick,
  onClick,
  title,
}: BashSummaryParamProps) {
  return (
    <span
      className="output-tool-param bash-command bash-summary-param"
      onClick={onClick}
      title={title}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      {summary.totalSteps > 1 && (
        <span className="bash-summary-count">{summary.totalSteps} steps ·</span>
      )}
      {summary.steps.map((step, index) => {
        const resolvedPath = step.file ? resolveAgentFileReference(step.file, agentCwd).path : null;
        const open = (event: React.SyntheticEvent) => {
          if (!onFileClick || !resolvedPath) return;
          event.stopPropagation();
          onFileClick(resolvedPath);
        };
        return (
          <React.Fragment key={`${step.label}-${step.file ?? ''}-${index}`}>
            {index > 0 && <span className="bash-summary-arrow">→</span>}
            <span className="bash-summary-text">{step.label}</span>
            {step.file && resolvedPath && (
              <span
                className={`codex-file-chip ${onFileClick ? 'is-clickable' : ''}`}
                title={resolvedPath}
                role={onFileClick ? 'button' : undefined}
                tabIndex={onFileClick ? 0 : undefined}
                onClick={open}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open(event);
                  }
                }}
                {...filePreviewHandlers(step.file, agentCwd)}
              >
                <FileTypeIcon path={step.file} size={12} />
                <span>{step.file.split('/').pop() || step.file}</span>
              </span>
            )}
          </React.Fragment>
        );
      })}
      {summary.extraSteps > 0 && <span className="bash-summary-text">+{summary.extraSteps}</span>}
      <span className="bash-summary-lines">
        {summary.lineCount > 2 ? `${summary.lineCount} lines` : `${summary.charCount} chars`}
      </span>
    </span>
  );
});
