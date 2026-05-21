import React from 'react';
import type { WhatsAppMessageEvent } from '../../../shared/event-types';
import { formatBubbleTimestamp, messageTypeIcon } from './format';

interface MessageBubbleProps {
  message: WhatsAppMessageEvent;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const side = message.direction === 'outbound' ? 'outbound' : 'inbound';
  const icon = messageTypeIcon(message.messageType);
  const body = (message.body ?? '').trim();
  const hasBody = body.length > 0;
  const placeholder = !hasBody ? `[${message.messageType}]` : null;

  return (
    <div className={`whatsapp-history-bubble whatsapp-history-bubble--${side}`}>
      <div className="whatsapp-history-bubble__inner">
        {icon && (
          <span className="whatsapp-history-bubble__type-icon" title={message.messageType}>{icon}</span>
        )}
        {hasBody ? (
          <span className="whatsapp-history-bubble__body">{body}</span>
        ) : (
          <span className="whatsapp-history-bubble__placeholder">{placeholder}</span>
        )}
        {message.audioTranscription && (
          <span className="whatsapp-history-bubble__transcription">
            “{message.audioTranscription}”
          </span>
        )}
        {message.mediaPath && (
          <a
            className="whatsapp-history-bubble__media-link"
            href={message.mediaPath}
            target="_blank"
            rel="noopener noreferrer"
          >
            {message.mediaFilename || 'open media'}
          </a>
        )}
        <span className="whatsapp-history-bubble__time">
          {formatBubbleTimestamp(message.timestamp)}
        </span>
      </div>
    </div>
  );
}
