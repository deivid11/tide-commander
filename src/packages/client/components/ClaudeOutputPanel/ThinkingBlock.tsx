/**
 * Shared thinking / reasoning row for live OutputLine and history HistoryLine.
 * Collapses long thoughts to a one-line preview; expands on click for the full text.
 */

import React, { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';
import { providerAssetUrl } from '../../utils/providerDisplay';
import type { AgentProvider } from '../../../shared/types';

export interface ThinkingBlockProps {
  text: string;
  /** When true, force expanded (e.g. still streaming). */
  isStreaming?: boolean;
  agentName?: string | null;
  provider?: AgentProvider | string | null;
  timeStr?: string;
  timestampTitle?: string;
  /** Compact single-line threshold (chars). Longer text gets expand/collapse. */
  collapseAt?: number;
}

function normalizeThinkingText(raw: string): string {
  return raw
    .replace(/^\[thinking\]\s*/i, '')
    .replace(/\*+/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function previewLine(text: string, maxLen: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen - 1).trimEnd()}…`;
}

export const ThinkingBlock = memo(function ThinkingBlock({
  text,
  isStreaming = false,
  agentName,
  provider,
  timeStr,
  timestampTitle,
  collapseAt = 140,
}: ThinkingBlockProps) {
  const { t } = useTranslation(['tools']);
  const body = useMemo(() => normalizeThinkingText(text), [text]);
  const canCollapse = body.length > collapseAt || body.includes('\n');
  const [expanded, setExpanded] = useState(false);
  const showFull = isStreaming || expanded || !canCollapse;
  const label =
    provider === 'codex'
      ? t('tools:display.codexThinking')
      : t('tools:display.thinking');

  if (!body && !isStreaming) return null;

  return (
    <div
      className={`output-line output-thinking output-tool-use ${isStreaming ? 'output-streaming' : ''} ${showFull ? 'is-expanded' : 'is-collapsed'} ${canCollapse ? 'is-collapsible' : ''}`}
      onClick={canCollapse && !isStreaming ? () => setExpanded((v) => !v) : undefined}
      role={canCollapse && !isStreaming ? 'button' : undefined}
      tabIndex={canCollapse && !isStreaming ? 0 : undefined}
      onKeyDown={
        canCollapse && !isStreaming
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setExpanded((v) => !v);
              }
            }
          : undefined
      }
      title={canCollapse && !isStreaming ? (showFull ? 'Collapse thinking' : 'Expand thinking') : undefined}
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
      {isStreaming && <span className="output-thinking-pulse" aria-hidden />}
      <span className={`output-thinking-content ${showFull ? 'is-full' : 'is-preview'}`}>
        {showFull ? (body || (isStreaming ? '…' : '')) : previewLine(body, collapseAt)}
      </span>
      {canCollapse && !isStreaming && (
        <span className="output-thinking-toggle" aria-hidden>
          <Icon name={showFull ? 'caret-up' : 'caret-down'} size={11} />
        </span>
      )}
    </div>
  );
});
