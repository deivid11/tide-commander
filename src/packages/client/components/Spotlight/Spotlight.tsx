/**
 * Spotlight - Main component (orchestrator)
 *
 * A command palette-style modal for quickly searching and navigating:
 * - Agents (with supervisor history, modified files, and user queries)
 * - Commands (spawn, commander view, settings, supervisor)
 * - Areas (project groups)
 * - Modified files
 * - Recent activity
 */

import React, { useRef, useEffect, useCallback } from 'react';
import type { SpotlightProps } from './types';
import { useSpotlightSearch } from './useSpotlightSearch';
import { SpotlightInput } from './SpotlightInput';
import { SpotlightResults } from './SpotlightResults';
import { SpotlightFooter } from './SpotlightFooter';

export function Spotlight({
  isOpen,
  onClose,
  onOpenSpawnModal,
  onOpenCommanderView,
  onOpenToolbox,
  onOpenSupervisor,
  onOpenFileExplorer,
}: SpotlightProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const { query, setQuery, selectedIndex, setSelectedIndex, results, handleKeyDown, highlightMatch } =
    useSpotlightSearch({
      isOpen,
      onClose,
      onOpenSpawnModal,
      onOpenCommanderView,
      onOpenToolbox,
      onOpenSupervisor,
      onOpenFileExplorer,
    });

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      // Focus input after a small delay to ensure modal is rendered
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
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

      // Capture Alt+N/P to prevent global shortcuts from firing
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'n' || e.key === 'p' || e.key === 'N' || e.key === 'P')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
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

  // Reset selection when query changes
  const handleResetSelection = useCallback(() => {
    setSelectedIndex(0);
  }, [setSelectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="spotlight-overlay" onClick={handleBackdropClick}>
      <div className="spotlight-modal" onKeyDown={handleKeyDown}>
        <SpotlightInput
          ref={inputRef}
          query={query}
          onQueryChange={setQuery}
          onKeyDown={handleKeyDown}
          onResetSelection={handleResetSelection}
        />

        <SpotlightResults
          ref={resultsRef}
          results={results}
          selectedIndex={selectedIndex}
          query={query}
          highlightMatch={highlightMatch}
          onSelectIndex={setSelectedIndex}
        />

        <SpotlightFooter />
      </div>
    </div>
  );
}
