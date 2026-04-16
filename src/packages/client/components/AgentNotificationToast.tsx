import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { store } from '../store';
import type { AgentNotification, AgentClass } from '../../shared/types';
import { BUILT_IN_AGENT_CLASSES } from '../../shared/types';
import { showNotification, openAgentTerminalFromNotification, isNativeApp } from '../utils/notifications';
import { triggerHaptic } from '../utils/haptics';
import { AgentIcon, getAgentIconUrl } from './AgentIcon';

interface AgentNotificationContextType {
  showAgentNotification: (notification: AgentNotification) => void;
}

const AgentNotificationContext = createContext<AgentNotificationContextType | null>(null);

// Get icon for agent class
function getClassIcon(agentClass: AgentClass): string {
  const builtIn = BUILT_IN_AGENT_CLASSES[agentClass as keyof typeof BUILT_IN_AGENT_CLASSES];
  if (builtIn) return builtIn.icon;
  // For custom classes, we'd need to look them up from store
  const customClasses = store.getState().customAgentClasses;
  const custom = customClasses.get(agentClass);
  if (custom) return custom.icon;
  return '🤖';
}

// Returns a PNG icon URL for custom classes with an uploaded iconPath; undefined otherwise.
function getClassIconUrl(agentClass: AgentClass): string | undefined {
  const customClasses = store.getState().customAgentClasses;
  const custom = customClasses.get(agentClass);
  return custom?.iconPath ? getAgentIconUrl(custom.iconPath) : undefined;
}

// Get color for agent class
function getClassColor(agentClass: AgentClass): string {
  const builtIn = BUILT_IN_AGENT_CLASSES[agentClass as keyof typeof BUILT_IN_AGENT_CLASSES];
  if (builtIn) return builtIn.color;
  const customClasses = store.getState().customAgentClasses;
  const custom = customClasses.get(agentClass);
  if (custom) return custom.color;
  return '#888888';
}

// Maximum notifications to show at once
const MAX_VISIBLE_NOTIFICATIONS = 3;

// Swipe dismiss threshold (px)
const SWIPE_DISMISS_THRESHOLD = 80;

interface SwipeableNotificationProps {
  notification: AgentNotification;
  onDismiss: (id: string) => void;
  onClick: (notification: AgentNotification) => void;
}

function SwipeableNotification({ notification, onDismiss, onClick }: SwipeableNotificationProps) {
  const touchRef = useRef({ startX: 0, startY: 0, locked: false });
  const [swipeX, setSwipeX] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const swipingRef = useRef(false);
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const classColor = getClassColor(notification.agentClass);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, locked: false };
    swipingRef.current = false;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchRef.current.startX;
    const dy = e.touches[0].clientY - touchRef.current.startY;

    // Once direction is locked, stick with it
    if (!touchRef.current.locked) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return; // Dead zone
      touchRef.current.locked = true;
      if (Math.abs(dy) > Math.abs(dx)) return; // Vertical scroll — bail
    }

    // Only allow leftward swipe (negative dx)
    if (dx < 0) {
      swipingRef.current = true;
      setSwipeX(dx);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (swipeX < -SWIPE_DISMISS_THRESHOLD) {
      setDismissing(true);
      triggerHaptic(2);
      setTimeout(() => onDismiss(notification.id), 200);
    } else {
      setSwipeX(0);
    }
    // Prevent onClick from firing after swipe
    setTimeout(() => { swipingRef.current = false; }, 50);
  }, [swipeX, onDismiss, notification.id]);

  const handleClick = useCallback(() => {
    if (!swipingRef.current) onClick(notification);
  }, [onClick, notification]);

  // Opacity fades as user swipes further left
  const progress = Math.min(Math.abs(swipeX) / (SWIPE_DISMISS_THRESHOLD * 1.5), 1);
  const opacity = dismissing ? 0 : 1 - progress * 0.6;
  const translateX = dismissing ? '-120%' : `${swipeX}px`;
  const transition = swipingRef.current && !dismissing
    ? 'none'
    : 'transform 0.2s ease-out, opacity 0.2s ease-out';

  return (
    <div
      className={`agent-notification${dismissing ? ' is-dismissing' : ''}`}
      onClick={isTouchDevice ? undefined : handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        '--agent-color': classColor,
        transform: `translateX(${translateX})`,
        opacity,
        transition,
      } as React.CSSProperties}
    >
      <span className="agent-notification-icon"><AgentIcon classId={notification.agentClass} size={36} /></span>
      <div className="agent-notification-content">
        <div className="agent-notification-header">
          <span className="agent-notification-name">{notification.agentName}</span>
          <span className="agent-notification-separator">&middot;</span>
          <span className="agent-notification-title">{notification.title}</span>
        </div>
        <div className="agent-notification-message">{notification.message}</div>
      </div>
      <button
        className="agent-notification-close"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(notification.id);
        }}
      >
        &times;
      </button>
    </div>
  );
}

export function AgentNotificationProvider({ children }: { children: React.ReactNode }) {
  const { t: _t } = useTranslation(['notifications']);
  const [notifications, setNotifications] = useState<AgentNotification[]>([]);
  const timeoutRefs = useRef<Map<string, number>>(new Map());

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      timeoutRefs.current.forEach((timeout) => clearTimeout(timeout));
    };
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    const timeout = timeoutRefs.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      timeoutRefs.current.delete(id);
    }
  }, []);

  const showAgentNotification = useCallback((notification: AgentNotification) => {
    // Keep track of the latest sender for keyboard jump from Commander (Tab).
    store.setLatestNotificationAgentId(notification.agentId);

    // Show in-app toast notification
    setNotifications((prev) => {
      // Limit to max visible, remove oldest if needed
      const newList = [...prev, notification];
      if (newList.length > MAX_VISIBLE_NOTIFICATIONS) {
        const removed = newList.shift();
        if (removed) {
          const timeout = timeoutRefs.current.get(removed.id);
          if (timeout) {
            clearTimeout(timeout);
            timeoutRefs.current.delete(removed.id);
          }
        }
      }
      return newList;
    });

    // Auto-dismiss after 8 seconds (longer than regular toasts since these are from agents)
    const timeout = window.setTimeout(() => {
      removeNotification(notification.id);
    }, 8000);
    timeoutRefs.current.set(notification.id, timeout);

    // Send browser notification on web only.
    // On native Android, the foreground service (WebSocketForegroundService)
    // handles notifications via its own WebSocket — skip here to avoid duplicates.
    if (!isNativeApp()) {
      const iconUrl = getClassIconUrl(notification.agentClass);
      const titlePrefix = iconUrl ? '' : `${getClassIcon(notification.agentClass)} `;
      showNotification({
        title: `${titlePrefix}${notification.agentName}: ${notification.title}`,
        body: notification.message,
        icon: iconUrl,
        data: {
          type: 'agent_notification',
          agentId: notification.agentId,
          notificationId: notification.id,
        },
      });
    }
  }, [removeNotification]);

  const handleNotificationClick = useCallback((notification: AgentNotification) => {
    // Force-open terminal for the sending agent when clicking an agent notification.
    openAgentTerminalFromNotification(notification.agentId);
    removeNotification(notification.id);
  }, [removeNotification]);

  return (
    <AgentNotificationContext.Provider value={{ showAgentNotification }}>
      {children}
      <div id="agent-notification-container">
        {notifications.map((notification) => (
          <SwipeableNotification
            key={notification.id}
            notification={notification}
            onDismiss={removeNotification}
            onClick={handleNotificationClick}
          />
        ))}
      </div>
    </AgentNotificationContext.Provider>
  );
}

export function useAgentNotification(): AgentNotificationContextType {
  const context = useContext(AgentNotificationContext);
  if (!context) {
    throw new Error('useAgentNotification must be used within AgentNotificationProvider');
  }
  return context;
}
