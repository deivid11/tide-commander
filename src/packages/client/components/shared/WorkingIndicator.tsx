import React from 'react';

interface WorkingIndicatorProps {
  detached?: boolean;
  className?: string;
}

export function WorkingIndicator({ detached = false, className = '' }: WorkingIndicatorProps) {
  const classes = `guake-working-indicator${detached ? ' detached' : ''}${className ? ` ${className}` : ''}`;

  return (
    <span className={classes}>
      <span className="guake-working-dot"></span>
      <span className="guake-working-dot"></span>
      <span className="guake-working-dot"></span>
    </span>
  );
}
