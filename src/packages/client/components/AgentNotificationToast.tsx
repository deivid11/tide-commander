import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { store } from '../store';
import type { AgentNotification, AgentClass } from '../../shared/types';
import { BUILT_IN_AGENT_CLASSES } from '../../shared/types';
import { showNotification, openAgentTerminalFromNotification, isNativeApp } from '../utils/notifications';
import { triggerHaptic } from '../utils/haptics';
import { playNotificationSound, playQuestionSound } from '../utils/notificationSounds';
import { AgentIcon, getAgentIconUrl } from './AgentIcon';
import { useSwipeToDismiss } from '../hooks/useSwipeToDismiss';

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

interface SwipeableNotificationProps {
  notification: AgentNotification;
  onDismiss: (id: string) => void;
  onClick: (notification: AgentNotification) => void;
}

function SwipeableNotification({ notification, onDismiss, onClick }: SwipeableNotificationProps) {
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const classColor = getClassColor(notification.agentClass);

  const handleDismiss = useCallback(() => {
    onDismiss(notification.id);
  }, [onDismiss, notification.id]);

  const handleTap = useCallback(() => {
    onClick(notification);
  }, [onClick, notification]);

  const { ref, style, isDismissing } = useSwipeToDismiss({
    onDismiss: handleDismiss,
    onTap: handleTap,
    threshold: 72,
    ignoreTapSelector: '.agent-notification-close, button, a',
    onDismissHaptic: () => triggerHaptic(2),
  });

  const handleClick = useCallback(() => {
    // Desktop / non-touch: click opens agent chat
    if (!isTouchDevice) onClick(notification);
  }, [isTouchDevice, onClick, notification]);

  return (
    <div
      ref={ref}
      className={`agent-notification${isDismissing ? ' is-dismissing' : ''}`}
      onClick={isTouchDevice ? undefined : handleClick}
      style={{
        '--agent-color': classColor,
        ...style,
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
        type="button"
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

    // Play a pleasant cue. Notifications that read like a question / a request for
    // input get the more attention-grabbing question sound; everything else gets
    // the soft general chime.
    const settings = store.getSettings();
    const soundLevel = settings.notificationSoundEnabled ? settings.notificationSoundVolume : 0;
    if (soundLevel > 0) {
      const haystack = `${notification.title} ${notification.message}`;
      const looksLikeQuestion =
        /input|question|pregunta|decision|decisi[oó]n|necesita|need|plan\s*(ready|listo)|\?/i.test(haystack);
      if (looksLikeQuestion) {
        playQuestionSound(soundLevel);
      } else {
        playNotificationSound(soundLevel);
      }
    }

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
