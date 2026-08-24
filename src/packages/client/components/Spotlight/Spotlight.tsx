/**
 * Spotlight - Main component (orchestrator)
 *
 * A command palette-style modal for quickly searching and navigating:
 * - Agents (with modified files and user queries)
 * - Commands (spawn, commander view, settings)
 * - Areas (project groups)
 * - Files (filename search across every area project)
 * - Modified files
 * - Recent activity
 */

import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import type { SpotlightProps } from './types';
import { useSpotlightSearch } from './useSpotlightSearch';
import { SpotlightInput } from './SpotlightInput';
import { SpotlightTabs } from './SpotlightTabs';
import { SpotlightResults } from './SpotlightResults';
import { SpotlightFooter } from './SpotlightFooter';
import { SpotlightFileDetailModal, type SpotlightFileDetail } from './SpotlightFileDetailModal';
import { SpotlightPluginCommandResults } from './SpotlightPluginCommandResults';
import { SpotlightCommandResultModal } from './SpotlightCommandResultModal';
import {
  matchSpotlightPluginCommands,
  runPluginCommand,
  type SpotlightPluginCommand,
} from './pluginCommands';
import { getPluginSlashCommands } from '../../plugins/registry';
import { usePluginRegistryRevision } from '../../plugins/hooks';
import type { PluginOutputEnvelope } from '../../plugins/types';
import { store } from '../../store';
import { SHELL_COMMAND_PLUGIN_ID } from '../../plugins/shell-commands/execution';

const MOBILE_BREAKPOINT = 768;

export function Spotlight({
  isOpen,
  onClose,
  onOpenSpawnModal,
  onOpenCommanderView,
  onOpenToolbox,
  onOpenFileExplorer,
  onOpenPM2LogsModal,
  onOpenBossLogsModal,
  onOpenDatabasePanel,
  onOpenMonitoringModal,
  onOpenSessionFinder,
}: SpotlightProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const resultsLengthRef = useRef(0);
  const commandModeRef = useRef(false);
  const completeCommandRef = useRef<() => void>(() => undefined);
  const [fileDetail, setFileDetail] = useState<SpotlightFileDetail | null>(null);
  const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);
  const [executingCommand, setExecutingCommand] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandResult, setCommandResult] = useState<{ command: string; output: PluginOutputEnvelope } | null>(null);
  const pluginRegistryRevision = usePluginRegistryRevision();

  const {
    query,
    setQuery,
    selectedIndex,
    setSelectedIndex,
    results,
    loadingTypes,
    activeTab,
    setActiveTab,
    cycleTab,
    areaSections,
    handleKeyDown,
    highlightMatch,
  } = useSpotlightSearch({
    isOpen,
    onClose,
    onOpenSpawnModal,
    onOpenCommanderView,
    onOpenToolbox,
    onOpenFileExplorer,
    onOpenPM2LogsModal,
    onOpenBossLogsModal,
    onOpenDatabasePanel,
    onOpenMonitoringModal,
    onOpenSessionFinder,
    onOpenFileDetail: setFileDetail,
  });

  const commandMode = query.startsWith('/');
  const commandMatches = useMemo(
    () => matchSpotlightPluginCommands(query, getPluginSlashCommands()),
    // The revision is the external registry's change signal.
    [query, pluginRegistryRevision],
  );

  const completeSelectedCommand = useCallback(() => {
    const selected = commandMatches[commandSelectedIndex];
    if (!selected) return;
    const suffix = query.trim().replace(/^\S+/, '');
    setQuery(`${selected.name}${suffix}`);
    setCommandSelectedIndex(0);
  }, [commandMatches, commandSelectedIndex, query, setQuery]);

  const executePluginCommand = useCallback(async (selected: SpotlightPluginCommand) => {
    setExecutingCommand(true);
    setCommandError(null);
    try {
      const agentId = selected.pluginId === SHELL_COMMAND_PLUGIN_ID || selected.requiresAgent
        ? store.getState().selectedAgentIds.values().next().value
        : undefined;
      const result = await runPluginCommand(selected, query, { agentId });
      if (result.kind === 'output') setCommandResult(result);
      onClose();
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : String(error));
    } finally {
      setExecutingCommand(false);
    }
  }, [onClose, query]);

  resultsLengthRef.current = commandMode ? commandMatches.length : results.length;
  commandModeRef.current = commandMode;
  completeCommandRef.current = completeSelectedCommand;

  // Keep the latest cycleTab in a ref so the window-level keydown handler can
  // cycle tabs without re-subscribing on every render.
  const cycleTabRef = useRef(cycleTab);
  cycleTabRef.current = cycleTab;

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      setCommandResult(null);
      setCommandError(null);
      // Focus input after a small delay to ensure modal is rendered, and select
      // the restored last query so the user can immediately type over it.
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen]);

  // On mobile, keep the overlay fitted to the visual viewport so the modal stays
  // above the software keyboard. visualViewport.height shrinks when the keyboard
  // opens; setting the overlay's height/top to match ensures the modal is never
  // hidden behind the keyboard.
  useEffect(() => {
    if (!isOpen) return;

    const vv = window.visualViewport;
    if (!vv || window.innerWidth > MOBILE_BREAKPOINT) return;

    const syncViewport = () => {
      const el = overlayRef.current;
      if (!el) return;
      el.style.height = `${vv.height}px`;
      el.style.top = `${vv.offsetTop}px`;
    };

    syncViewport();
    vv.addEventListener('resize', syncViewport);
    vv.addEventListener('scroll', syncViewport);

    return () => {
      vv.removeEventListener('resize', syncViewport);
      vv.removeEventListener('scroll', syncViewport);
      const el = overlayRef.current;
      if (el) {
        el.style.height = '';
        el.style.top = '';
      }
    };
  }, [isOpen]);

  // Capture Escape and Alt+N/P at window level to prevent other handlers from intercepting
  useEffect(() => {
    if (!isOpen) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Handle Escape to close the spotlight - intercept before other capture handlers
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
        return;
      }

      // Tab cycles result tabs (Shift+Tab goes backward). Intercept before the
      // browser moves focus away from the search input.
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (commandModeRef.current) completeCommandRef.current();
        else cycleTabRef.current(e.shiftKey ? -1 : 1);
        return;
      }

      // Capture Alt+N/P to prevent global shortcuts from firing, and handle navigation here
      // since stopImmediatePropagation prevents the input's onKeyDown from receiving the event
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'n' || e.key === 'p' || e.key === 'N' || e.key === 'P')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const keyLower = e.key.toLowerCase();
        const len = resultsLengthRef.current;
        if (len === 0) return;
        const update = (current: number) => keyLower === 'p'
          ? (current > 0 ? current - 1 : len - 1)
          : (current < len - 1 ? current + 1 : 0);
        if (commandModeRef.current) setCommandSelectedIndex(update);
        else setSelectedIndex(update);
        return;
      }
    };

    // Add with capture to intercept before global shortcut handlers
    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true });
    };
  }, [isOpen, onClose]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // Reset selection when query changes.
  const handleResetSelection = useCallback(() => {
    setSelectedIndex(0);
    setCommandSelectedIndex(0);
    setCommandError(null);
  }, [setSelectedIndex]);

  useEffect(() => {
    if (commandSelectedIndex >= commandMatches.length) {
      setCommandSelectedIndex(Math.max(0, commandMatches.length - 1));
    }
  }, [commandMatches.length, commandSelectedIndex]);

  const handleInputKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!commandMode) {
      handleKeyDown(event);
      return;
    }
    const count = commandMatches.length;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (count === 0) return;
      setCommandSelectedIndex((index) => event.key === 'ArrowUp'
        ? (index > 0 ? index - 1 : count - 1)
        : (index < count - 1 ? index + 1 : 0));
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      completeSelectedCommand();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const selected = commandMatches[commandSelectedIndex];
      if (selected && !executingCommand) void executePluginCommand(selected);
    }
  }, [commandMatches, commandMode, commandSelectedIndex, completeSelectedCommand, executePluginCommand, executingCommand, handleKeyDown]);

  if (!isOpen) {
    if (commandResult) {
      return (
        <SpotlightCommandResultModal
          command={commandResult.command}
          output={commandResult.output}
          onClose={() => setCommandResult(null)}
        />
      );
    }
    return fileDetail
      ? <SpotlightFileDetailModal detail={fileDetail} onClose={() => setFileDetail(null)} />
      : null;
  }

  return (
    <div ref={overlayRef} className="spotlight-overlay" onClick={handleBackdropClick}>
      <div className="spotlight-modal">
        <SpotlightInput
          ref={inputRef}
          query={query}
          onQueryChange={setQuery}
          onKeyDown={handleInputKeyDown}
          onResetSelection={handleResetSelection}
          commandMode={commandMode}
          executingCommand={executingCommand}
        />

        {!commandMode && <SpotlightTabs activeTab={activeTab} onSelect={setActiveTab} />}

        {commandMode ? (
          <SpotlightPluginCommandResults
            ref={resultsRef}
            commands={commandMatches}
            selectedIndex={commandSelectedIndex}
            executing={executingCommand}
            error={commandError}
            onSelectIndex={setCommandSelectedIndex}
            onExecute={(command) => void executePluginCommand(command)}
          />
        ) : (
          <SpotlightResults
            ref={resultsRef}
            results={results}
            loadingTypes={loadingTypes}
            selectedIndex={selectedIndex}
            query={query}
            activeTab={activeTab}
            areaSections={areaSections}
            highlightMatch={highlightMatch}
            onSelectIndex={setSelectedIndex}
          />
        )}

        <SpotlightFooter commandMode={commandMode} />
      </div>
    </div>
  );
}
