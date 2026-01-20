/**
 * MessageLine component for rendering history messages in CommanderView
 * Memoized for performance
 */

import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { HistoryMessage } from './types';
import {
  TOOL_ICONS,
  isErrorResult,
  formatTimestamp,
} from '../../utils/outputRendering';

interface MessageLineProps {
  message: HistoryMessage;
}

export const MessageLine = memo(function MessageLine({ message }: MessageLineProps) {
  const { type, content, toolName, timestamp } = message;

  // Format timestamp for display
  const timeStr = timestamp ? formatTimestamp(timestamp) : '';

  if (type === 'tool_use') {
    const icon = TOOL_ICONS[toolName || ''] || TOOL_ICONS.default;
    // Try to format content nicely
    let formattedContent = content;
    try {
      const parsed = JSON.parse(content);
      formattedContent = JSON.stringify(parsed, null, 2);
    } catch {
      // Not JSON, use as-is
    }

    return (
      <div className="msg-line msg-tool">
        <div className="msg-tool-header">
          {timeStr && <span className="msg-timestamp">{timeStr}</span>}
          <span className="msg-tool-icon">{icon}</span>
          <span className="msg-tool-name">{toolName}</span>
        </div>
        <pre className="msg-tool-content">{formattedContent}</pre>
      </div>
    );
  }

  if (type === 'tool_result') {
    // Determine if result is success/error using shared utility
    const isError = isErrorResult(content);
    const resultIcon = isError ? '❌' : '✓';

    return (
      <div className={`msg-line msg-result ${isError ? 'msg-result-error' : 'msg-result-success'}`}>
        <div className="msg-result-header">
          {timeStr && <span className="msg-timestamp">{timeStr}</span>}
          <span className="msg-result-icon">{resultIcon}</span>
          <span className="msg-result-label">{isError ? 'Error' : 'Result'}</span>
        </div>
        <pre className="msg-result-content">{content}</pre>
      </div>
    );
  }

  const isUser = type === 'user';

  return (
    <div className={`msg-line ${isUser ? 'msg-user' : 'msg-assistant'}`}>
      {timeStr && <span className="msg-timestamp">{timeStr}</span>}
      <span className="msg-role">{isUser ? 'You' : 'Claude'}</span>
      <span className="msg-content markdown-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </span>
    </div>
  );
});
