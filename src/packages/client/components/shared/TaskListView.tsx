import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';
import type { AgentTodoItem } from '../../../shared/types';

interface TaskListViewProps {
  todos: AgentTodoItem[];
}

export function TaskListView({ todos }: TaskListViewProps) {
  const { t } = useTranslation(['tools']);

  const counts = {
    completed: todos.filter((todo) => todo.status === 'completed').length,
    in_progress: todos.filter((todo) => todo.status === 'in_progress').length,
    pending: todos.filter((todo) => todo.status === 'pending').length,
  };

  return (
    <div className="todo-tool-input">
      <div className="todo-tool-header">
        <span className="todo-tool-title">
          <Icon name="task" size={13} /> {t('tools:todoList.title')}
        </span>
        <div className="todo-tool-stats">
          {counts.completed > 0 && (
            <span className="todo-stat completed">
              <Icon name="check" size={11} /> {counts.completed}
            </span>
          )}
          {counts.in_progress > 0 && (
            <span className="todo-stat in-progress">
              <Icon name="play" size={11} /> {counts.in_progress}
            </span>
          )}
          {counts.pending > 0 && (
            <span className="todo-stat pending">
              <Icon name="status-pending" size={11} /> {counts.pending}
            </span>
          )}
        </div>
      </div>
      <div className="todo-tool-list">
        {todos.map((todo, idx) => (
          <div key={idx} className={`todo-item todo-${todo.status}`}>
            <span className="todo-status-icon">
              <Icon
                name={
                  todo.status === 'completed'
                    ? 'check'
                    : todo.status === 'in_progress'
                    ? 'play'
                    : 'status-pending'
                }
                size={12}
              />
            </span>
            <span className="todo-content">{todo.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
