import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { store } from '../store';
import type { AgentNotification, AgentClass } from '../../shared/types';
import { BUILT_IN_AGENT_CLASSES } from '../../shared/types';
import { showNotification } from '../utils/notifications';

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

export function AgentNotificationProvider({ children }: { children: React.ReactNode }) {
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

    // Also send native notification (Android/browser)
    // This works in background and shows in notification shade
    showNotification({
      title: `${notification.agentName}: ${notification.title}`,
      body: notification.message,
      data: {
        type: 'agent_notification',
        agentId: notification.agentId,
        notificationId: notification.id,
      },
    });
  }, [removeNotification]);

  const handleNotificationClick = useCallback((notification: AgentNotification) => {
    // Select the agent and open its terminal panel
    store.selectAgent(notification.agentId);
    // Optionally focus the terminal panel - this would require UI state management
    // For now, selecting the agent should be enough to show its panel
    removeNotification(notification.id);
  }, [removeNotification]);

  return (
    <AgentNotificationContext.Provider value={{ showAgentNotification }}>
      {children}
      <div id="agent-notification-container">
        {notifications.map((notification) => {
          const classIcon = getClassIcon(notification.agentClass);
          const classColor = getClassColor(notification.agentClass);

          return (
            <div
              key={notification.id}
              className="agent-notification"
              onClick={() => handleNotificationClick(notification)}
              style={{ '--agent-color': classColor } as React.CSSProperties}
            >
              <div className="agent-notification-avatar">
                <span className="agent-notification-icon">{classIcon}</span>
              </div>
              <div className="agent-notification-content">
                <div className="agent-notification-header">
                  <span className="agent-notification-name">{notification.agentName}</span>
                  <span className="agent-notification-hint">Click to focus</span>
                </div>
                <div className="agent-notification-title">{notification.title}</div>
                <div className="agent-notification-message">{notification.message}</div>
              </div>
              <button
                className="agent-notification-close"
                onClick={(e) => {
                  e.stopPropagation();
                  removeNotification(notification.id);
                }}
              >
                &times;
              </button>
            </div>
          );
        })}
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
