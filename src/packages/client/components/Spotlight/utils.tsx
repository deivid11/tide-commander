/**
 * Utility functions for the Spotlight component
 */

import React from 'react';
import { Icon, type IconName } from '../Icon';
import { FILE_ICON_NAMES } from './types';

/**
 * Map an agent class slug to a semantic Icon name.
 */
function getAgentClassIconName(agentClass: string): IconName {
  switch (agentClass) {
    case 'scout':
      return 'class-scout';
    case 'builder':
      return 'class-builder';
    case 'debugger':
      return 'class-debugger';
    case 'architect':
      return 'class-architect';
    case 'warrior':
      return 'class-warrior';
    case 'support':
      return 'class-support';
    case 'boss':
      return 'class-boss';
    default:
      return 'class-default';
  }
}

/**
 * Get file icon JSX based on file extension
 */
export function getFileIconFromPath(path: string, size = 16): React.ReactNode {
  const ext = '.' + (path.split('.').pop()?.toLowerCase() ?? '');
  const name = FILE_ICON_NAMES[ext] || FILE_ICON_NAMES.default;
  return <Icon name={name} size={size} />;
}

/**
 * Get agent icon JSX based on agent class
 */
export function getAgentIcon(agentClass: string, size = 16): React.ReactNode {
  return <Icon name={getAgentClassIconName(agentClass)} size={size} weight="fill" />;
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
    case 'modified-file':
      return 'Changed';
    case 'building':
      return 'Server';
    default:
      return type;
  }
}
