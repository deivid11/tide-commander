import React, { useCallback, useId, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownComponents as defaultMarkdownComponents } from './MarkdownComponents';
import { Icon } from '../Icon';
import { AgentIcon } from '../AgentIcon';
import { useAgent } from '../../store/selectors';
import { store } from '../../store';
import { shouldCollapseAgentChatBody } from './agentChatMessageParser';

export {
  parseAgentChatMessage,
  shouldCollapseAgentChatBody,
  type ParsedAgentChatMessage,
} from './agentChatMessageParser';

interface AgentChatMessageCardProps {
  senderName: string;
  senderId: string;
  body: string;
}

export function AgentChatMessageCard({ senderName, senderId, body }: AgentChatMessageCardProps) {
  const sender = useAgent(senderId);
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();

  const needsCollapse = useMemo(() => shouldCollapseAgentChatBody(body), [body]);
  const collapsed = needsCollapse && !expanded;

  const toggleExpanded = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(v => !v);
  }, []);

  const handleSenderClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (sender) {
      store.selectAgent(senderId);
      store.setTerminalOpen(true);
    }
  }, [sender, senderId]);

  return (
    <div className="agent-chat-message-card">
      <div className="agent-chat-message-title">
        <span className="agent-chat-message-icon" aria-hidden="true">
          <Icon name="envelope-simple" size={12} />
        </span>
        <span className="agent-chat-message-title-text">
          Message from{' '}
          {sender ? (
            <span className="agent-chat-message-sender clickable-agent-name" onClick={handleSenderClick}>
              <AgentIcon agent={sender} size={12} />
              <strong>{sender.name}</strong>
            </span>
          ) : (
            <strong className="agent-chat-message-sender-name">{senderName}</strong>
          )}
          <span className="agent-chat-message-sender-id" title={senderId}>
            {senderId.slice(0, 8)}
          </span>
        </span>
      </div>
      <div
        id={bodyId}
        className={`agent-chat-message-body markdown-content${collapsed ? ' agent-chat-message-body--collapsed' : ''}`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={defaultMarkdownComponents}>
          {body}
        </ReactMarkdown>
      </div>
      {needsCollapse && (
        <div className="agent-chat-message-footer">
          <button
            type="button"
            className="agent-chat-message-more-btn"
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
