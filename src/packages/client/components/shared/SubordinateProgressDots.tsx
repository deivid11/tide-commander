import type { Agent, AgentStatus } from '../../../shared/types';

interface SubordinateProgressDotsProps {
  subordinates: Agent[];
  maxDots?: number;
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  working: 'working',
  idle: 'idle',
  waiting: 'waiting',
  waiting_permission: 'waiting permission',
  error: 'error',
  offline: 'offline',
  orphaned: 'orphaned',
};

// Ordering for dots + tooltip: idle first (free / ready), working last (still busy).
const STATUS_SORT_ORDER: Record<AgentStatus, number> = {
  idle: 0,
  error: 1,
  orphaned: 2,
  waiting_permission: 3,
  waiting: 4,
  offline: 5,
  working: 6,
};

function formatRelativeTime(ts?: number): string | null {
  if (!ts || ts <= 0) return null;
  const diff = Date.now() - ts;
  if (diff < 0) return null;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function pickPreview(sub: Agent): { text: string; source: 'task' | 'detail' | 'currentTask' | 'lastAssigned' } | null {
  if (sub.taskLabel) return { text: sub.taskLabel, source: 'task' };
  if (sub.trackingStatusDetail) return { text: sub.trackingStatusDetail, source: 'detail' };
  if (sub.currentTask) return { text: sub.currentTask, source: 'currentTask' };
  if (sub.lastAssignedTask) return { text: sub.lastAssignedTask, source: 'lastAssigned' };
  return null;
}

function sortSubordinates(subordinates: Agent[]): Agent[] {
  return [...subordinates].sort((a, b) => {
    const orderA = STATUS_SORT_ORDER[a.status] ?? 99;
    const orderB = STATUS_SORT_ORDER[b.status] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });
}

export function SubordinateProgressDots({ subordinates, maxDots = 12 }: SubordinateProgressDotsProps) {
  if (!subordinates || subordinates.length === 0) return null;
  // Hide the dots entirely when no subordinate is actively working — boss
  // bosses with all-idle subordinates don't need a visual progress indicator.
  if (!subordinates.some((sub) => sub.status === 'working')) return null;

  const sorted = sortSubordinates(subordinates);
  const dots = sorted.slice(0, maxDots);
  const overflow = sorted.length - dots.length;

  return (
    <span className="subordinate-progress-dots">
      {dots.map((sub) => (
        <span
          key={sub.id}
          className={`subordinate-progress-dot status-${sub.status}`}
        />
      ))}
      {overflow > 0 && (
        <span className="subordinate-progress-overflow">+{overflow}</span>
      )}
    </span>
  );
}

export function SubordinateProgressTooltipContent({ subordinates }: { subordinates: Agent[] }) {
  if (!subordinates || subordinates.length === 0) return null;

  const sorted = sortSubordinates(subordinates);
  const total = sorted.length;
  const working = sorted.filter((s) => s.status === 'working').length;
  const idle = sorted.filter((s) => s.status === 'idle').length;
  const summary =
    working > 0
      ? `Waiting on ${working}/${total}`
      : `${idle}/${total} idle`;

  return (
    <div className="subordinate-progress-tooltip">
      <div className="subordinate-progress-tooltip-header">{summary}</div>
      <ul className="subordinate-progress-tooltip-list">
        {sorted.map((sub) => {
          const preview = pickPreview(sub);
          const completed = sub.latestTodos?.filter((todo) => todo.status === 'completed').length ?? 0;
          const totalTodos = sub.latestTodos?.length ?? 0;
          const idleSince = sub.status === 'idle' ? formatRelativeTime(sub.lastActivity) : null;
          return (
            <li key={sub.id} className={`subordinate-progress-tooltip-item status-${sub.status}`}>
              <div className="subordinate-progress-tooltip-row">
                <span className={`subordinate-progress-tooltip-dot status-${sub.status}`} />
                <span className="subordinate-progress-tooltip-name">{sub.name}</span>
                <span className="subordinate-progress-tooltip-status">{STATUS_LABEL[sub.status] ?? sub.status}</span>
              </div>
              {preview && (
                <div className={`subordinate-progress-tooltip-preview source-${preview.source}`}>
                  {preview.text}
                </div>
              )}
              <div className="subordinate-progress-tooltip-meta">
                {totalTodos > 0 && (
                  <span className="subordinate-progress-tooltip-meta-chip">
                    {completed}/{totalTodos} todos
                  </span>
                )}
                {idleSince && (
                  <span className="subordinate-progress-tooltip-meta-chip muted">
                    idle {idleSince}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
