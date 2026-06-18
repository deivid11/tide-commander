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
 * MRU (most-recently-used) tracking for agents selected from Spotlight.
 * Persisted in localStorage as { [agentId]: epochMs } so an explicit Spotlight
 * pick contributes to an agent's "recently used" recency even when that agent has
 * no recent server-side activity. Capped to the most-recent entries.
 */
const RECENT_AGENTS_STORAGE_KEY = 'tide-commander:spotlight-recent-agents';
const RECENT_AGENTS_MAX = 15;

/**
 * Read the map of agentId -> last-selected timestamp (epoch ms). Safe if storage
 * is unavailable. Legacy values (a plain id array from older builds) are ignored
 * — recency cleanly falls back to server activity until new selections are made.
 */
export function getRecentAgentTimes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RECENT_AGENTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [id, ts] of Object.entries(parsed)) {
      if (typeof id === 'string' && typeof ts === 'number') out[id] = ts;
    }
    return out;
  } catch {
    return {};
  }
}

/** Record an agent as just-used from Spotlight (stamps it with the current time). */
export function recordRecentAgent(agentId: string): void {
  try {
    const times = getRecentAgentTimes();
    times[agentId] = Date.now();
    // Keep only the most-recent entries so the map cannot grow unbounded.
    const trimmed = Object.entries(times)
      .sort((a, b) => b[1] - a[1])
      .slice(0, RECENT_AGENTS_MAX);
    localStorage.setItem(RECENT_AGENTS_STORAGE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // Ignore storage failures (private mode, quota) — the MRU boost is a nicety.
  }
}

/**
 * Absolute "recently used" timestamp for an agent (epoch ms): the later of its
 * server-side last activity and its last explicit Spotlight selection. Higher =
 * more recent. Used as the descending sort key for the empty-query agent list.
 */
export function agentRecency(
  agentId: string | undefined,
  lastActivity: number | undefined,
  recentTimes: Record<string, number>
): number {
  const selected = agentId ? recentTimes[agentId] ?? 0 : 0;
  return Math.max(lastActivity ?? 0, selected);
}

/**
 * MRU tracking for buildings opened/focused, mirroring the agent MRU above.
 * Buildings have no reliable server-side "user opened it" signal, so a
 * localStorage timestamp recorded on each open is the recency source the
 * Recents (Ctrl+L) overlay sorts by. Capped to the most-recent entries.
 */
const RECENT_BUILDINGS_STORAGE_KEY = 'tide-commander:recents-recent-buildings';
const RECENT_BUILDINGS_MAX = 25;

/** Read the map of buildingId -> last-opened timestamp (epoch ms). Safe if storage is unavailable. */
export function getRecentBuildingTimes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RECENT_BUILDINGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [id, ts] of Object.entries(parsed)) {
      if (typeof id === 'string' && typeof ts === 'number') out[id] = ts;
    }
    return out;
  } catch {
    return {};
  }
}

/** Record a building as just-opened/focused (stamps it with the current time). */
export function recordRecentBuilding(buildingId: string): void {
  try {
    const times = getRecentBuildingTimes();
    times[buildingId] = Date.now();
    const trimmed = Object.entries(times)
      .sort((a, b) => b[1] - a[1])
      .slice(0, RECENT_BUILDINGS_MAX);
    localStorage.setItem(RECENT_BUILDINGS_STORAGE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // Ignore storage failures (private mode, quota) — recency is a nicety.
  }
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
