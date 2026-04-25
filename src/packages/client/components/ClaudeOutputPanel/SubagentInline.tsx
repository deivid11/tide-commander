/**
 * SubagentInline — inline activity / stream panel for Task & Agent tool chips.
 *
 * Shared between live (OutputLine) and persisted (HistoryLine) renderers so the
 * subagent stream survives a JSONL re-fetch: the live tool_use chip gets
 * deduped against the persisted history once the JSONL flushes, after which
 * only HistoryLine renders the chip — without this shared panel, the
 * `Stream (X events)` block would vanish on panel re-mount even while the
 * subagent is still streaming.
 */

import React, { memo, useState, useRef, useEffect } from 'react';
import { Icon } from '../Icon';
import { getToolIconName } from '../../utils/outputRendering';
import type { Subagent, SubagentStreamEntry } from '../../../shared/types';

const SubagentStreamPanel = memo(function SubagentStreamPanel({ entries, isWorking }: { entries: SubagentStreamEntry[]; isWorking: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isWorking && expanded && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries.length, isWorking, expanded]);

  const visibleEntries = expanded ? entries : entries.slice(-3);

  return (
    <div className="subagent-stream-panel">
      <div
        className="subagent-stream-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="stream-toggle-arrow"><Icon name={expanded ? 'caret-down' : 'caret-right'} size={10} /></span>
        <span>{expanded ? 'Hide stream' : `Stream (${entries.length} events)`}</span>
      </div>
      {(expanded || entries.length <= 3) && (
        <div className="subagent-stream-list" ref={listRef}>
          {visibleEntries.map((entry, i) => (
            <div key={i} className={`subagent-stream-entry entry-${entry.type}${entry.isError ? ' entry-error' : ''}`}>
              {entry.type === 'text' && (
                <>
                  <span className="stream-entry-icon"><Icon name="robot" size={12} /></span>
                  <span className="stream-entry-text">{entry.text}</span>
                </>
              )}
              {entry.type === 'tool_use' && (
                <>
                  <span className="stream-entry-icon"><Icon name={getToolIconName(entry.toolName || '')} size={12} /></span>
                  <span className="stream-entry-tool">{entry.toolName}</span>
                  {entry.toolKeyParam && <span className="stream-entry-param">{entry.toolKeyParam}</span>}
                </>
              )}
              {entry.type === 'tool_result' && (
                <>
                  <span className="stream-entry-icon"><Icon name={entry.isError ? 'cross' : 'check'} size={12} /></span>
                  <span className="stream-entry-result">{entry.resultPreview}</span>
                </>
              )}
            </div>
          ))}
          {isWorking && <span className="subagent-cursor">▌</span>}
        </div>
      )}
    </div>
  );
});

export const SubagentInline = memo(function SubagentInline({ subagent }: { subagent: Subagent }) {
  const hasActivities = !!(subagent.activities && subagent.activities.length > 0);
  const hasStreamEntries = !!(subagent.streamEntries && subagent.streamEntries.length > 0);
  const shouldRender = subagent.status === 'working' || hasActivities || subagent.stats || hasStreamEntries;
  if (!shouldRender) return null;

  return (
    <div className="subagent-activity-container">
      <div className={`subagent-activity-inline status-${subagent.status}`}>
        <div className="subagent-activity-header">
          <span className="subagent-type-badge">{subagent.subagentType}</span>
          <span className="subagent-elapsed">
            {subagent.completedAt
              ? `${((subagent.completedAt - subagent.startedAt) / 1000).toFixed(0)}s`
              : `${((Date.now() - subagent.startedAt) / 1000).toFixed(0)}s`}
          </span>
        </div>

        {hasActivities && (
          <div className="subagent-activity-list">
            {subagent.activities!.slice(-8).map((activity, i) => (
              <div key={i} className="subagent-activity-item">
                <span className="activity-icon"><Icon name={getToolIconName(activity.toolName)} size={12} /></span>
                <span className="activity-tool">{activity.toolName}</span>
                <span className="activity-desc">{activity.description.length > 80 ? activity.description.slice(0, 77) + '...' : activity.description}</span>
              </div>
            ))}
            {subagent.status === 'working' && (
              <span className="subagent-cursor">▌</span>
            )}
          </div>
        )}

        {subagent.stats && (
          <div className="subagent-stats-bar">
            <span>{(subagent.stats.durationMs / 1000).toFixed(0)}s</span>
            <span>{(subagent.stats.tokensUsed / 1000).toFixed(1)}K tokens</span>
            <span>{subagent.stats.toolUseCount} tools</span>
          </div>
        )}

        {hasStreamEntries && (
          <SubagentStreamPanel
            entries={subagent.streamEntries!}
            isWorking={subagent.status === 'working'}
          />
        )}
      </div>
    </div>
  );
});
