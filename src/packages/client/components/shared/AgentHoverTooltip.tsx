import type { ReactNode } from 'react';
import type { Agent, AgentTodoItem } from '../../../shared/types';
import { Tooltip, type TooltipPosition } from './Tooltip';
import { TaskProgressTooltipContent } from './TaskProgressDots';
import { SubordinateProgressTooltipContent } from './SubordinateProgressDots';

interface AgentHoverTooltipProps {
  todos?: AgentTodoItem[];
  subordinates?: Agent[];
  position?: TooltipPosition;
  /** Wrapper layout — `contents` keeps the trigger transparent to layout. */
  triggerStyle?: React.CSSProperties;
  children: ReactNode;
}

export function AgentHoverTooltip({
  todos,
  subordinates,
  position = 'top',
  triggerStyle = { display: 'contents' },
  children,
}: AgentHoverTooltipProps) {
  const hasTodos = todos && todos.length > 0;
  const hasSubordinates = subordinates && subordinates.length > 0;

  if (!hasTodos && !hasSubordinates) return <>{children}</>;

  const content = (
    <div className="agent-hover-tooltip">
      {hasTodos && <TaskProgressTooltipContent todos={todos!} />}
      {hasTodos && hasSubordinates && <div className="agent-hover-tooltip-divider" />}
      {hasSubordinates && <SubordinateProgressTooltipContent subordinates={subordinates!} />}
    </div>
  );

  return (
    <Tooltip content={content} position={position} maxWidth={360} triggerStyle={triggerStyle}>
      {children}
    </Tooltip>
  );
}
