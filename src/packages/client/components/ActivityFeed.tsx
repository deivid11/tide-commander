import React, { useCallback, useMemo } from 'react';
import { store, useActivities, Activity } from '../store';
import { formatTime } from '../utils/formatting';
import { TOOL_ICONS } from '../utils/outputRendering';

// Known tool names for parsing
const TOOL_NAMES = ['WebSearch', 'WebFetch', 'Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Task', 'TodoWrite', 'NotebookEdit', 'AskUserQuestion'];

export function ActivityFeed() {
  const activities = useActivities();

  const handleActivityClick = useCallback((agentId: string) => {
    store.selectAgent(agentId);
  }, []);

  // Memoize the sliced activities to avoid creating new array on each render
  const displayedActivities = useMemo(() => activities.slice(0, 100), [activities]);

  if (activities.length === 0) {
    return (
      <div className="activity-empty">
        <span style={{ opacity: 0.5 }}>No activity yet...</span>
      </div>
    );
  }

  return (
    <div id="activity-list">
      {displayedActivities.map((activity, index) => (
        <ActivityItem
          key={`${activity.timestamp}-${index}`}
          activity={activity}
          onClick={() => handleActivityClick(activity.agentId)}
        />
      ))}
    </div>
  );
}

interface ActivityItemProps {
  activity: Activity;
  onClick: () => void;
}

interface ParsedToolActivity {
  toolName: string;
  icon: string;
  param?: string;
}

function parseToolActivity(message: string): ParsedToolActivity | null {
  // Check for "ToolName: param" format
  for (const toolName of TOOL_NAMES) {
    if (message.startsWith(`${toolName}: `)) {
      return {
        toolName,
        icon: TOOL_ICONS[toolName] || '\uD83D\uDD27',
        param: message.slice(toolName.length + 2),
      };
    }
    // Also check for "Using ToolName" format
    if (message === `Using ${toolName}`) {
      return {
        toolName,
        icon: TOOL_ICONS[toolName] || '\uD83D\uDD27',
      };
    }
  }
  return null;
}

function ActivityItem({ activity, onClick }: ActivityItemProps) {
  const toolInfo = parseToolActivity(activity.message);

  if (toolInfo) {
    return (
      <div className="activity-item activity-tool" onClick={onClick}>
        <span className="activity-time">{formatTime(activity.timestamp)}</span>
        <span className="activity-agent">{activity.agentName}</span>
        <span className="activity-tool-icon">{toolInfo.icon}</span>
        <span className="activity-tool-name">{toolInfo.toolName}</span>
        {toolInfo.param && (
          <span className="activity-tool-param">{toolInfo.param}</span>
        )}
      </div>
    );
  }

  return (
    <div className="activity-item" onClick={onClick}>
      <span className="activity-time">{formatTime(activity.timestamp)}</span>
      <span className="activity-agent">{activity.agentName}:</span>
      <span className="activity-message">{activity.message}</span>
    </div>
  );
}
