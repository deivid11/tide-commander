import React, { memo } from 'react';
import './ActivityGlyph.scss';

interface ActivityGlyphProps {
  /** Use the shared pre-rendered animated WebP; false renders the static SVG. */
  animated?: boolean;
  className?: string;
  size?: number;
}

/**
 * Small, reusable working-state glyph.
 *
 * Motion is pre-rendered into one shared animated WebP. Unlike a CSS transform
 * animation, it does not keep a compositor layer running at the monitor's
 * 165+ Hz refresh rate. Low Power Mode swaps it for the inline static SVG.
 */
export const ActivityGlyph = memo(function ActivityGlyph({
  animated = false,
  className = '',
  size = 14,
}: ActivityGlyphProps) {
  return (
    <span
      className={`activity-glyph${animated ? ' activity-glyph--animated' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {animated && (
        <img
          className="activity-glyph__image"
          src="/assets/activity-spinner.webp?v=2"
          alt=""
          draggable={false}
        />
      )}
      <svg
        className="activity-glyph__static"
        viewBox="0 0 16 16"
        fill="none"
        focusable="false"
      >
        <circle className="activity-glyph__track" cx="8" cy="8" r="5.75" />
        <circle
          className="activity-glyph__arc"
          cx="8"
          cy="8"
          r="5.75"
          pathLength="100"
          strokeDasharray="62 38"
          strokeDashoffset="4"
        />
        <circle className="activity-glyph__head" cx="12.72" cy="4.72" r="1.15" />
      </svg>
    </span>
  );
});
