/**
 * OutputLine component for rendering live/streaming output in CommanderView
 * Memoized for performance
 */

import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ClaudeOutput } from '../../store';
import {
  TOOL_ICONS,
  isErrorResult,
  formatTimestamp,
} from '../../utils/outputRendering';

interface OutputLineProps {
  output: ClaudeOutput;
}

export const OutputLine = memo(function OutputLine({ output }: OutputLineProps) {
  const { text, isStreaming, isUserPrompt, timestamp } = output;

  // Format timestamp for display
  const timeStr = formatTimestamp(timestamp || Date.now());

  // Handle user prompts
  if (isUserPrompt) {
    return (
      <div className="msg-line msg-user msg-live">
        <span className="msg-timestamp">{timeStr}</span>
        <span className="msg-role">You</span>
        <span className="msg-content markdown-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </span>
      </div>
    );
  }

  // Handle tool usage messages
  if (text.startsWith('Using tool:')) {
    const toolName = text.replace('Using tool:', '').trim();
    const icon = TOOL_ICONS[toolName] || TOOL_ICONS.default;
    return (
      <div className="msg-line msg-tool msg-live">
        <div className="msg-tool-header">
          <span className="msg-timestamp">{timeStr}</span>
          <span className="msg-tool-icon">{icon}</span>
          <span className="msg-tool-name">{toolName}</span>
          {isStreaming && <span className="msg-tool-streaming">...</span>}
        </div>
      </div>
    );
  }

  // Handle tool result messages
  if (text.startsWith('Tool result:')) {
    const resultContent = text.replace('Tool result:', '').trim();
    const isError = isErrorResult(resultContent);
    const resultIcon = isError ? '❌' : '✓';
    return (
      <div className={`msg-line msg-result msg-live ${isError ? 'msg-result-error' : 'msg-result-success'}`}>
        <div className="msg-result-header">
          <span className="msg-timestamp">{timeStr}</span>
          <span className="msg-result-icon">{resultIcon}</span>
          <span className="msg-result-label">{isError ? 'Error' : 'Result'}</span>
        </div>
        <pre className="msg-result-content">{resultContent}</pre>
      </div>
    );
  }

  let className = 'msg-line msg-output msg-assistant msg-live';
  if (isStreaming) className += ' streaming';

  return (
    <div className={className}>
      <span className="msg-timestamp">{timeStr}</span>
      <span className="msg-role">Claude</span>
      <span className="msg-content markdown-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </span>
    </div>
  );
});
