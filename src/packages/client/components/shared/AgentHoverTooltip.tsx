import { useEffect, useState, type ReactNode } from 'react';
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

function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

export function AgentHoverTooltip({
  todos,
  subordinates,
  position = 'top',
  triggerStyle = { display: 'contents' },
  children,
}: AgentHoverTooltipProps) {
  const isMobile = useIsMobileViewport();
  const hasTodos = todos && todos.length > 0;
  const hasSubordinates = subordinates && subordinates.length > 0;

  if (isMobile) return <>{children}</>;
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
