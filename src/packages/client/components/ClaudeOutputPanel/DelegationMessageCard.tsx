import React, { useCallback, useId, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownComponents as defaultMarkdownComponents } from './MarkdownComponents';
import { Icon } from '../Icon';
import { shouldCollapseDelegationBody } from './delegationMessageParser';

export {
  parseDelegationMessage,
  shouldCollapseDelegationBody,
  type ParsedDelegationMessage,
} from './delegationMessageParser';

interface DelegationMessageCardProps {
  bossName: string;
  body: string;
}

export function DelegationMessageCard({ bossName, body }: DelegationMessageCardProps) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();

  const needsCollapse = useMemo(() => shouldCollapseDelegationBody(body), [body]);
  const collapsed = needsCollapse && !expanded;

  const toggleExpanded = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(v => !v);
  }, []);

  return (
    <div className="delegation-message-card">
      <div className="delegation-message-title">
        <span className="delegation-message-icon" aria-hidden="true">
          <Icon name="task" size={12} />
        </span>
        <span className="delegation-message-title-text">
          Task delegated from{' '}
          <strong className="delegation-message-boss-name">{bossName}</strong>
        </span>
      </div>
      <div
        id={bodyId}
        className={`delegation-message-body markdown-content${collapsed ? ' delegation-message-body--collapsed' : ''}`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={defaultMarkdownComponents}>
          {body}
        </ReactMarkdown>
      </div>
      {needsCollapse && (
        <div className="delegation-message-footer">
          <button
            type="button"
            className="delegation-message-more-btn"
            onClick={toggleExpanded}
            aria-expanded={expanded}
            aria-controls={bodyId}
          >
            <span>{expanded ? 'Show less' : 'Show more'}</span>
            <Icon name={expanded ? 'caret-up' : 'caret-down'} size={10} />
          </button>
        </div>
      )}
    </div>
  );
}
