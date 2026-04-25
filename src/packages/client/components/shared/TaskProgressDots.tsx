import type { AgentTodoItem } from '../../../shared/types';

interface TaskProgressDotsProps {
  todos: AgentTodoItem[];
  maxDots?: number;
}

const STATUS_ICON: Record<AgentTodoItem['status'], string> = {
  completed: '✓',
  in_progress: '▶',
  pending: '○',
};

export function TaskProgressDots({ todos, maxDots = 12 }: TaskProgressDotsProps) {
  if (!todos || todos.length === 0) return null;

  const total = todos.length;
  const dots = todos.slice(0, maxDots);
  const overflow = total - dots.length;

  return (
    <span className="task-progress-dots">
      {dots.map((todo, idx) => (
        <span
          key={idx}
          className={`task-progress-dot task-progress-dot-${todo.status}`}
        />
      ))}
      {overflow > 0 && (
        <span className="task-progress-overflow">+{overflow}</span>
      )}
    </span>
  );
}

export function TaskProgressTooltipContent({ todos }: { todos: AgentTodoItem[] }) {
  if (!todos || todos.length === 0) return null;
  const completed = todos.filter((todo) => todo.status === 'completed').length;
  const total = todos.length;

  return (
    <div className="task-progress-tooltip">
      <div className="task-progress-tooltip-header">
        {completed}/{total} tasks done
      </div>
      <ul className="task-progress-tooltip-list">
        {todos.map((todo, idx) => (
          <li key={idx} className={`task-progress-tooltip-item status-${todo.status}`}>
            <span className="task-progress-tooltip-icon">{STATUS_ICON[todo.status]}</span>
            <span className="task-progress-tooltip-text">{todo.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
