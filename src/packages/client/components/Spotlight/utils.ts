/**
 * Utility functions for the Spotlight component
 */

import { AGENT_CLASSES } from '../../../shared/types';
import { FILE_ICONS } from './types';

/**
 * Get file icon based on file extension
 */
export function getFileIconFromPath(path: string): string {
  const ext = '.' + path.split('.').pop()?.toLowerCase();
  return FILE_ICONS[ext] || FILE_ICONS.default;
}

/**
 * Get agent icon based on agent class
 */
export function getAgentIcon(agentClass: string): string {
  const classInfo = AGENT_CLASSES[agentClass as keyof typeof AGENT_CLASSES];
  return classInfo?.icon || '🤖';
}

/**
 * Format duration in human readable form
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ago`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

/**
 * Format timestamp to relative time
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  return formatDuration(diff);
}

/**
 * Get type label for display
 */
export function getTypeLabel(type: string): string {
  switch (type) {
    case 'agent':
      return 'Agent';
    case 'command':
      return 'Command';
    case 'area':
      return 'Area';
    case 'activity':
      return 'Activity';
    case 'modified-file':
      return 'Changed';
    case 'building':
      return 'Server';
    default:
      return type;
  }
}
