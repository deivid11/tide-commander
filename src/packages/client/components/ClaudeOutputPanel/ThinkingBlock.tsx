/**
 * Shared thinking / reasoning row for live OutputLine and history HistoryLine.
 * Collapses long thoughts to a one-line preview; expands on click for the full text.
 * Full body renders as markdown (same pipeline as assistant replies).
 */

import React, { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';
import { providerAssetUrl } from '../../utils/providerDisplay';
import type { AgentProvider } from '../../../shared/types';
import { StreamFadeText } from './StreamFadeText';
import { renderContentWithImages } from './contentRendering';
import { store } from '../../store';

export interface ThinkingBlockProps {
  text: string;
  /** When true, force expanded (e.g. still streaming). */
  isStreaming?: boolean;
  agentId?: string;
  agentName?: string | null;
  provider?: AgentProvider | string | null;
  timeStr?: string;
  timestampTitle?: string;
  /** Compact single-line threshold (chars). Longer text gets expand/collapse. */
  collapseAt?: number;
  onImageClick?: (url: string, name: string) => void;
  onFileClick?: (path: string) => void;
}

/** Strip the legacy `[thinking]` prefix and tidy blank lines — keep markdown. */
function normalizeThinkingText(raw: string): string {
  return raw
    .replace(/^\[thinking\]\s*/i, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** One-line collapsed preview without raw markdown noise. */
function previewLine(text: string, maxLen: number): string {
  const oneLine = text
    .replace(/```[\s\S]*?```/g, '…')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen - 1).trimEnd()}…`;
}

export const ThinkingBlock = memo(function ThinkingBlock({
  text,
  isStreaming = false,
  agentId,
  agentName,
  provider,
  timeStr,
  timestampTitle,
  collapseAt = 140,
  onImageClick,
  onFileClick,
}: ThinkingBlockProps) {
  const { t } = useTranslation(['tools']);
  const body = useMemo(() => normalizeThinkingText(text), [text]);
  const canCollapse = body.length > collapseAt || body.includes('\n');
  const [expanded, setExpanded] = useState(false);

  // Never keep the stream caret/pulse after the agent is idle, even if a
  // missed finalize left isStreaming stuck true on the output row.
  const agentWorking = agentId
    ? store.getState().agents.get(agentId)?.status === 'working'
    : true;
  const liveStream = Boolean(isStreaming && agentWorking);

  const showFull = liveStream || expanded || !canCollapse;
  const label =
    provider === 'codex'
      ? t('tools:display.codexThinking')
      : t('tools:display.thinking');

  if (!body && !liveStream) return null;

  const markdown = body
    ? renderContentWithImages(body, onImageClick, onFileClick)
    : null;

  return (
    <div
      className={`output-line output-thinking output-tool-use ${liveStream ? 'output-streaming' : ''} ${showFull ? 'is-expanded' : 'is-collapsed'} ${canCollapse ? 'is-collapsible' : ''}`}
      onClick={canCollapse && !liveStream ? () => setExpanded((v) => !v) : undefined}
      role={canCollapse && !liveStream ? 'button' : undefined}
      tabIndex={canCollapse && !liveStream ? 0 : undefined}
      onKeyDown={
        canCollapse && !liveStream
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setExpanded((v) => !v);
              }
            }
          : undefined
      }
      title={canCollapse && !liveStream ? (showFull ? 'Collapse thinking' : 'Expand thinking') : undefined}
    >
      {timeStr && (
        <span className="output-timestamp" title={timestampTitle || timeStr}>
          {timeStr}
        </span>
      )}
      {agentName && (
        <span className="output-agent-badge" title={`Agent: ${agentName}`}>
          {agentName}
        </span>
      )}
      <span className="output-thinking-icon" aria-hidden>
        <Icon name="brain" size={14} />
      </span>
      {provider && (
        <img
          src={providerAssetUrl(provider as AgentProvider, import.meta.env.BASE_URL)}
          alt=""
          className="output-thinking-provider"
          title={String(provider)}
        />
      )}
      <span className="output-tool-name output-thinking-label">{label}</span>
      {liveStream && <span className="output-thinking-pulse" aria-hidden />}
      <span
        className={`output-thinking-content ${showFull ? 'is-full' : 'is-preview'} ${showFull ? 'markdown-content' : ''}`}
      >
        {showFull ? (
          liveStream ? (
            body ? (
              // Live MD: StreamFadeText re-renders markdown each chunk when
              // renderComplete is set (no raw ** / half fences as plain text).
              <StreamFadeText
                text={body}
                isStreaming
                renderComplete={(t) => renderContentWithImages(t, onImageClick, onFileClick)}
              />
            ) : (
              '…'
            )
          ) : (
            markdown
          )
        ) : (
          previewLine(body, collapseAt)
        )}
      </span>
      {canCollapse && !liveStream && (
        <span className="output-thinking-toggle" aria-hidden>
          <Icon name={showFull ? 'caret-up' : 'caret-down'} size={11} />
        </span>
      )}
    </div>
  );
});
