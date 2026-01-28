/**
 * Tooltip - Custom tooltip component for app-wide use
 *
 * Provides styled tooltips with configurable position and delay.
 * Use for help text, descriptions, and contextual information.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  /** The content to show in the tooltip */
  content: React.ReactNode;
  /** The element that triggers the tooltip */
  children: React.ReactNode;
  /** Position of the tooltip relative to the trigger */
  position?: TooltipPosition;
  /** Delay in ms before showing the tooltip */
  delay?: number;
  /** Max width of the tooltip */
  maxWidth?: number;
  /** Whether the tooltip is disabled */
  disabled?: boolean;
  /** Custom class name for the tooltip */
  className?: string;
}

export function Tooltip({
  content,
  children,
  position = 'top',
  delay = 300,
  maxWidth = 280,
  disabled = false,
  className = '',
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const calculatePosition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;
    const padding = 8;

    let top = 0;
    let left = 0;

    switch (position) {
      case 'top':
        top = triggerRect.top + scrollY - tooltipRect.height - padding;
        left = triggerRect.left + scrollX + (triggerRect.width - tooltipRect.width) / 2;
        break;
      case 'bottom':
        top = triggerRect.bottom + scrollY + padding;
        left = triggerRect.left + scrollX + (triggerRect.width - tooltipRect.width) / 2;
        break;
      case 'left':
        top = triggerRect.top + scrollY + (triggerRect.height - tooltipRect.height) / 2;
        left = triggerRect.left + scrollX - tooltipRect.width - padding;
        break;
      case 'right':
        top = triggerRect.top + scrollY + (triggerRect.height - tooltipRect.height) / 2;
        left = triggerRect.right + scrollX + padding;
        break;
    }

    // Keep tooltip within viewport
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (left < padding) left = padding;
    if (left + tooltipRect.width > viewportWidth - padding) {
      left = viewportWidth - tooltipRect.width - padding;
    }
    if (top < padding) top = padding;
    if (top + tooltipRect.height > viewportHeight + scrollY - padding) {
      top = viewportHeight + scrollY - tooltipRect.height - padding;
    }

    setCoords({ top, left });
  }, [position]);

  const showTooltip = useCallback(() => {
    if (disabled) return;
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  }, [delay, disabled]);

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  }, []);

  useEffect(() => {
    if (isVisible) {
      // Small delay to ensure tooltip is rendered before calculating position
      requestAnimationFrame(calculatePosition);
    }
  }, [isVisible, calculatePosition]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const tooltip = isVisible && content && createPortal(
    <div
      ref={tooltipRef}
      className={`tide-tooltip tide-tooltip--${position} ${className}`}
      style={{
        position: 'absolute',
        top: coords.top,
        left: coords.left,
        maxWidth,
        zIndex: 10000,
      }}
      role="tooltip"
    >
      <div className="tide-tooltip__content">
        {content}
      </div>
      <div className="tide-tooltip__arrow" />
    </div>,
    document.body
  );

  return (
    <>
      <span
        ref={triggerRef}
        className="tide-tooltip-trigger"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        style={{ display: 'inline-flex' }}
      >
        {children}
      </span>
      {tooltip}
    </>
  );
}

/**
 * HelpTooltip - A specialized tooltip for help/info icons
 * Shows a help icon that reveals detailed information on hover
 */
export interface HelpTooltipProps {
  /** The help text to display */
  text: React.ReactNode;
  /** Optional title for the tooltip */
  title?: string;
  /** Position of the tooltip */
  position?: TooltipPosition;
  /** Size of the help icon */
  size?: 'sm' | 'md' | 'lg';
}

export function HelpTooltip({
  text,
  title,
  position = 'top',
  size = 'md',
}: HelpTooltipProps) {
  const content = (
    <>
      {title && <div className="tide-tooltip__title">{title}</div>}
      <div className="tide-tooltip__text">{text}</div>
    </>
  );

  return (
    <Tooltip content={content} position={position}>
      <span className={`tide-help-icon tide-help-icon--${size}`} tabIndex={0}>
        ?
      </span>
    </Tooltip>
  );
}

export default Tooltip;
