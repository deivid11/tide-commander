import React, { forwardRef, useEffect } from 'react';
import { Icon } from '../Icon';
import type { SpotlightPluginCommand } from './pluginCommands';

interface SpotlightPluginCommandResultsProps {
  commands: SpotlightPluginCommand[];
  selectedIndex: number;
  executing: boolean;
  error: string | null;
  onSelectIndex: (index: number) => void;
  onExecute: (command: SpotlightPluginCommand) => void;
}

export const SpotlightPluginCommandResults = forwardRef<HTMLDivElement, SpotlightPluginCommandResultsProps>(
  function SpotlightPluginCommandResults({
    commands,
    selectedIndex,
    executing,
    error,
    onSelectIndex,
    onExecute,
  }, ref) {
    useEffect(() => {
      if (!ref || typeof ref === 'function') return;
      ref.current?.querySelector('.spotlight-command-item.selected')?.scrollIntoView({ block: 'nearest' });
    }, [ref, selectedIndex]);

    return (
      <div className="spotlight-results spotlight-command-results" ref={ref}>
        <div className="spotlight-command-mode-banner">
          <span className="spotlight-command-mode-icon"><Icon name="terminal" size={13} /></span>
          <div>
            <strong>Plugin command mode</strong>
            <span>Runs locally without sending a prompt to an AI agent</span>
          </div>
        </div>

        {error && (
          <div className="spotlight-command-error" role="alert">
            <Icon name="warn" size={13} />
            <span>{error}</span>
          </div>
        )}

        {commands.length === 0 ? (
          <div className="spotlight-empty spotlight-command-empty">
            <Icon name="search" size={18} />
            <strong>No matching plugin command</strong>
            <span>Type <code>/</code> to see enabled plugin commands.</span>
          </div>
        ) : commands.map((command, index) => (
          <button
            key={`${command.pluginId}:${command.name}`}
            type="button"
            className={`spotlight-item spotlight-command-item${index === selectedIndex ? ' selected' : ''}`}
            disabled={executing}
            onMouseEnter={() => onSelectIndex(index)}
            onClick={() => onExecute(command)}
          >
            <span className="spotlight-item-icon spotlight-command-item-icon"><Icon name="plug" size={16} /></span>
            <span className="spotlight-item-content">
              <span className="spotlight-item-header">
                <code className="spotlight-command-name">{command.name}</code>
                {command.name !== command.canonicalName && (
                  <span className="spotlight-command-alias">alias of {command.canonicalName}</span>
                )}
              </span>
              <span className="spotlight-item-subtitle">{command.summary}</span>
            </span>
            <span className="spotlight-command-plugin-badge">{command.pluginName}</span>
            {executing && index === selectedIndex
              ? <span className="spotlight-loading-spinner" aria-label="Running command" />
              : <span className="spotlight-command-enter">↵</span>}
          </button>
        ))}
      </div>
    );
  }
);
