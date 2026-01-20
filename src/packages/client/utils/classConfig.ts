/**
 * Agent class configuration utilities
 * Centralized functions for getting class icons, colors, and descriptions
 */

import { AGENT_CLASS_CONFIG } from '../scene/config';
import type { CustomAgentClass, BuiltInAgentClass } from '../../shared/types';

/**
 * Convert a numeric color (0xRRGGBB) to hex string (#RRGGBB)
 */
export function normalizeColor(color: number | string): string {
  if (typeof color === 'string') return color;
  return '#' + color.toString(16).padStart(6, '0');
}

/**
 * Get the configuration for an agent class (built-in or custom)
 * Returns icon, color (as hex string), and optional description
 */
export function getClassConfig(
  agentClass: string,
  customClasses: CustomAgentClass[]
): { icon: string; color: string; description?: string } {
  // Check built-in classes first
  const builtIn = AGENT_CLASS_CONFIG[agentClass as BuiltInAgentClass];
  if (builtIn) {
    return {
      icon: builtIn.icon,
      color: normalizeColor(builtIn.color),
      description: builtIn.description,
    };
  }

  // Check custom classes
  const custom = customClasses.find(c => c.id === agentClass);
  if (custom) {
    return {
      icon: custom.icon,
      color: custom.color,
      description: custom.description,
    };
  }

  // Fallback for unknown classes
  return { icon: '🤖', color: '#888888' };
}
