import React from 'react';
import { RecentEvent } from './types';
import { formatTime } from './utils';
import styles from './dashboard-view.module.scss';

interface EventsTimelineProps {
  events: RecentEvent[];
  maxVisible?: number;
  onEventClick?: (event: RecentEvent) => void;
}

/**
 * Get icon for event type
 */
function getEventIcon(type: RecentEvent['type']): string {
  switch (type) {
    case 'agent_status':
      return '🤖';
    case 'task_complete':
      return '✓';
    case 'task_failed':
      return '❌';
    case 'building_online':
      return '🟢';
    case 'building_offline':
      return '🔴';
    case 'error':
      return '⚠️';
    default:
      return '📌';
  }
}

/**
 * Individual timeline event item
 */
const TimelineEvent = React.memo(
  ({
    event,
    isFirst,
    isLast,
    onClick,
  }: {
    event: RecentEvent;
    isFirst: boolean;
    isLast: boolean;
    onClick?: () => void;
  }) => {
    return (
      <div
        className={`${styles['timeline-event']} ${styles[`timeline-event--${event.severity}`]}`}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : -1}
        onKeyDown={
          onClick
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  onClick();
                }
              }
            : undefined
        }
      >
        {/* Connector line */}
        {!isLast && <div className={styles['timeline-event__line']} />}

        {/* Timeline dot and content */}
        <div className={styles['timeline-event__content']}>
          <div className={styles['timeline-event__dot']}>
            <span className={styles['timeline-event__icon']}>{getEventIcon(event.type)}</span>
          </div>

          <div className={styles['timeline-event__body']}>
            <div className={styles['timeline-event__header']}>
              <h4 className={styles['timeline-event__title']}>{event.message}</h4>
              <span className={styles['timeline-event__time']}>{formatTime(event.timestamp)}</span>
            </div>

            {event.agentName && (
              <p className={styles['timeline-event__meta']}>
                Agent: <strong>{event.agentName}</strong>
              </p>
            )}
            {event.buildingName && (
              <p className={styles['timeline-event__meta']}>
                Building: <strong>{event.buildingName}</strong>
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }
);

TimelineEvent.displayName = 'TimelineEvent';

/**
 * Main Events Timeline component
 */
export const EventsTimeline: React.FC<EventsTimelineProps> = ({
  events,
  maxVisible = 8,
  onEventClick,
}) => {
  const visibleEvents = events.slice(0, maxVisible);
  const hasMore = events.length > maxVisible;

  return (
    <div className={styles['events-timeline']}>
      <div className={styles['events-timeline__header']}>
        <h2 className={styles['events-timeline__title']}>Recent Events</h2>
        <span className={styles['events-timeline__count']}>
          {visibleEvents.length} {hasMore ? `of ${events.length}` : ''}
        </span>
      </div>

      {events.length === 0 ? (
        <div className={styles['events-timeline__empty']}>
          <p>No recent events</p>
        </div>
      ) : (
        <div className={styles['events-timeline__container']}>
          {visibleEvents.map((event, index) => (
            <TimelineEvent
              key={event.id}
              event={event}
              isFirst={index === 0}
              isLast={index === visibleEvents.length - 1}
              onClick={onEventClick ? () => onEventClick(event) : undefined}
            />
          ))}

          {hasMore && (
            <div className={styles['events-timeline__more']}>
              <button className={styles['events-timeline__more-btn']}>
                View {events.length - maxVisible} more events
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

EventsTimeline.displayName = 'EventsTimeline';
