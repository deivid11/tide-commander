/**
 * Shared thinking / reasoning row for live OutputLine and history HistoryLine.
 * Collapses long thoughts to a one-line preview; expands on click for the full text.
 * Full body renders as markdown (same pipeline as assistant replies).
 *
 * Expand state is sticky after a live stream: settling the stream (tool card /
 * next message / idle) must NOT snap the block shut while the user is still
 * reading. Virtualization remounts restore the preference via `streamId`.
 */

import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';
import { providerAssetUrl } from '../../utils/providerDisplay';
import type { AgentProvider } from '../../../shared/types';
import { StreamFadeText } from './StreamFadeText';
import { renderContentWithImages } from './contentRendering';
import { store } from '../../store';

/** Per-stream expand prefs — survives virtualized row remounts within a session. */
const expandPrefs = new Map<string, boolean>();
const EXPAND_PREFS_MAX = 250;

function rememberExpand(key: string, value: boolean): void {
  expandPrefs.set(key, value);
  if (expandPrefs.size > EXPAND_PREFS_MAX) {
    const oldest = expandPrefs.keys().next().value;
    if (oldest !== undefined) expandPrefs.delete(oldest);
  }
}

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
  /**
   * Stable stream identity (usually the output uuid). Used to remember expand
   * preference across re-renders and virtualized remounts.
   */
  streamId?: string;
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
  streamId,
  onImageClick,
  onFileClick,
}: ThinkingBlockProps) {
  const { t } = useTranslation(['tools']);
  const body = useMemo(() => normalizeThinkingText(text), [text]);
  const canCollapse = body.length > collapseAt || body.includes('\n');

  const prefKey = streamId
    ? `think:${agentId ?? ''}:${streamId}`
    : undefined;

  // Live streams open by default. Settled history stays collapsed unless the
  // user (or a prior live stream for this streamId) expanded it.
  const [expanded, setExpanded] = useState(() => {
    if (prefKey && expandPrefs.has(prefKey)) return expandPrefs.get(prefKey)!;
    return Boolean(isStreaming);
  });

  const setExpandedPersist = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setExpanded((prev) => {
        const value = typeof next === 'function' ? next(prev) : next;
        if (prefKey) rememberExpand(prefKey, value);
        return value;
      });
    },
    [prefKey],
  );

  // Never keep the stream caret/pulse after the agent is idle, even if a
  // missed finalize left isStreaming stuck true on the output row.
  const agentWorking = agentId
    ? store.getState().agents.get(agentId)?.status === 'working'
    : true;
  const liveStream = Boolean(isStreaming && agentWorking);

  // While streaming, keep expanded. When the stream settles (tool/message
  // arrives and isStreaming flips false), leave expanded alone so the user
  // can finish reading — do NOT auto-collapse.
  useEffect(() => {
    if (liveStream) {
      setExpandedPersist(true);
    }
  }, [liveStream, setExpandedPersist]);

  const showFull = liveStream || expanded || !canCollapse;
  const label =
    provider === 'codex'
      ? t('tools:display.codexThinking')
      : t('tools:display.thinking');

  // Stable identity so MarkdownBlock's memo survives re-renders (an inline
  // arrow here forced a full remark re-parse on every parent render).
  const renderMarkdown = useCallback(
    (content: string) => renderContentWithImages(content, onImageClick, onFileClick),
    [onImageClick, onFileClick],
  );

  // Settled markdown only — never computed while live-streaming (StreamFadeText
  // owns that path) and memoized so expand/collapse toggles don't re-parse.
  const settledMarkdown = useMemo(
    () => (!liveStream && showFull && body ? renderMarkdown(body) : null),
    [liveStream, showFull, body, renderMarkdown],
  );

  const preview = useMemo(
    () => (showFull ? '' : previewLine(body, collapseAt)),
    [showFull, body, collapseAt],
  );

  const toggleExpanded = useCallback(() => {
    setExpandedPersist((v) => !v);
  }, [setExpandedPersist]);

  if (!body && !liveStream) return null;

  return (
    <div
      className={`output-line output-thinking output-tool-use ${liveStream ? 'output-streaming' : ''} ${showFull ? 'is-expanded' : 'is-collapsed'} ${canCollapse ? 'is-collapsible' : ''}`}
      onClick={canCollapse && !liveStream ? toggleExpanded : undefined}
      role={canCollapse && !liveStream ? 'button' : undefined}
      tabIndex={canCollapse && !liveStream ? 0 : undefined}
      onKeyDown={
        canCollapse && !liveStream
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleExpanded();
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
              // Live MD: StreamFadeText renders completed paragraphs from its
              // memoized head and re-parses only the current paragraph.
              <StreamFadeText text={body} isStreaming renderComplete={renderMarkdown} />
            ) : (
              '…'
            )
          ) : (
            settledMarkdown
          )
        ) : (
          preview
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
