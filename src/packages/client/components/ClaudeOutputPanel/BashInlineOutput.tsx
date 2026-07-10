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

export function BashInlineOutput({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="output-line bash-inline-output">
      <pre>{text}</pre>
    </div>
  );
}
