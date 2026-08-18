/**
 * Global inline-output controls for bash-clickable rows.
 *
 * The toggle flips the `inlineBashOutputs` setting (persisted, applies to
 * every bash output in the terminal, live and history). When enabled, each
 * bash row renders its captured output right below the command via
 * BashInlineOutput, in addition to the existing click-to-open modal.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { store } from '../../store';
import { Icon } from '../Icon';
import { pathFromOutputClick, terminalOutputToHtml } from '../../utils/terminalOutputHtml';

export function BashInlineToggle({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation(['tools']);
  return (
    <span
      className={`bash-inline-toggle ${enabled ? 'active' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        store.updateSettings({ inlineBashOutputs: !enabled });
      }}
      title={enabled ? t('tools:display.hideOutputsInline') : t('tools:display.showOutputsInline')}
    >
      <Icon name={enabled ? 'caret-up' : 'caret-down'} size={12} />
    </span>
  );
}

/**
 * Captured command output rendered with the command's original colors. The
 * raw tool result is replayed through the terminal renderer (so `\r`
 * progress rewrites and erase-line sequences resolve like they would in a
 * real terminal) and every ANSI SGR run becomes an inline-styled span —
 * vitest greens, eslint yellows, chalk truecolor all survive. Lines with no
 * ANSI at all (git, ls, grep, cat…) get semantic highlighting instead:
 * diffs, `git status`, log levels, numbers, hashes, and clickable file paths.
 */
export function BashInlineOutput({ text, onFileClick }: { text: string; onFileClick?: (path: string) => void }) {
  const html = React.useMemo(() => (text.trim() ? terminalOutputToHtml(text) : ''), [text]);
  const handleClick = React.useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!onFileClick) return;
    const path = pathFromOutputClick(e.target);
    if (!path) return;
    e.stopPropagation();
    e.preventDefault();
    onFileClick(path);
  }, [onFileClick]);
  if (!html) return null;
  return (
    <div className={`output-line bash-inline-output ${onFileClick ? 'has-file-links' : ''}`}>
      <pre onClick={onFileClick ? handleClick : undefined} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
