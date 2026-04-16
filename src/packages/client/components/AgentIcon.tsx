import React from 'react';
import { getClassConfig } from '../utils/classConfig';
import { useCustomAgentClassesArray } from '../store/selectors';
import { apiUrl, authUrl } from '../utils/storage';
import type { CustomAgentClass } from '../../shared/types';

interface AgentIconProps {
  agent?: { class: string };
  classId?: string;
  size?: number | string;
  className?: string;
  style?: React.CSSProperties;
  /** Pre-resolved custom classes array — avoids hook call when used outside React or in lists that already have it */
  customClasses?: CustomAgentClass[];
}

/**
 * Renders an agent class icon — either a custom uploaded image or the emoji fallback.
 */
export const AgentIcon = React.memo(function AgentIcon({
  agent,
  classId,
  size = 20,
  className,
  style,
  customClasses: externalCustomClasses,
}: AgentIconProps) {
  const hookCustomClasses = useCustomAgentClassesArray();
  const customClasses = externalCustomClasses ?? hookCustomClasses;
  const resolvedClass = classId ?? agent?.class ?? '';
  const config = getClassConfig(resolvedClass, customClasses);

  const fontSize = typeof size === 'string' ? size : `${size}px`;

  if (config.iconPath) {
    const imgSize = typeof size === 'number' ? `${size}px` : size;
    return (
      <img
        src={authUrl(apiUrl(`/api/custom-class-icons/${config.iconPath}`))}
        alt={resolvedClass}
        className={className}
        style={{
          display: 'inline-block',
          verticalAlign: 'middle',
          objectFit: 'cover',
          width: imgSize,
          height: imgSize,
          ...style,
        }}
      />
    );
  }

  return (
    <span
      className={className}
      style={{
        fontSize,
        lineHeight: 1,
        ...style,
      }}
    >
      {config.icon}
    </span>
  );
});

/**
 * Non-hook helper for contexts that already have customClasses and config resolved
 * (e.g. notification toasts that use store.getState() directly).
 */
export function getAgentIconUrl(iconPath: string): string {
  return authUrl(apiUrl(`/api/custom-class-icons/${iconPath}`));
}
