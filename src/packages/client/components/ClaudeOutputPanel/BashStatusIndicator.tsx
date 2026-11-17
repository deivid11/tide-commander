/**
 * The status glyph at the end of a Bash row: an activity spinner while the
 * command runs, then a result icon. Shared by OutputLine (live) and
 * HistoryLine: history rows used to render NO status at all, and since every
 * session refresh swaps live rows for their history twins, most commands —
 * including ones still running — lost their status after a few seconds.
 */

import React from 'react';
import { Icon } from '../Icon';
import { ActivityGlyph } from '../shared/ActivityGlyph';
import { useAgentIsWorking } from '../../store/selectors';

interface BashStatusIconProps {
  running: boolean;
  hasOutput: boolean;
  /** A tracked exec task for this command completed. */
  completedTask?: boolean;
}

export function BashStatusIcon({ running, hasOutput, completedTask }: BashStatusIconProps) {
  if (running) {
    return (
      <span className="bash-output-indicator bash-output-indicator--running">
        <ActivityGlyph animated size={11} className="bash-activity-glyph" />
      </span>
    );
  }
  return (
    <span className="bash-output-indicator">
      <Icon name={completedTask ? 'success' : (hasOutput ? 'file-text' : 'terminal')} size={12} />
    </span>
  );
}

interface HistoryBashStatusProps {
  /** `_bashOutput` as paired by the history loader: undefined = no tool_result yet. */
  output: string | undefined;
  agentId?: string | null;
  completedTask?: boolean;
}

/**
 * History row status. A row without a tool_result is running only while its
 * agent works — an interrupted command must not spin forever. Only those rows
 * subscribe to the agent's status, so finished history stays render-cheap.
 */
export function HistoryBashStatus({ output, agentId, completedTask }: HistoryBashStatusProps) {
  if (output !== undefined) {
    return <BashStatusIcon running={false} hasOutput={output.trim().length > 0} completedTask={completedTask} />;
  }
  return <PendingBashStatus agentId={agentId} completedTask={completedTask} />;
}

function PendingBashStatus({ agentId, completedTask }: { agentId?: string | null; completedTask?: boolean }) {
  const working = useAgentIsWorking(agentId ?? null);
  return <BashStatusIcon running={working && !completedTask} hasOutput={false} completedTask={completedTask} />;
}
