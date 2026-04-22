/**
 * Spotlight - Main component (orchestrator)
 *
 * A command palette-style modal for quickly searching and navigating:
 * - Agents (with modified files and user queries)
 * - Commands (spawn, commander view, settings)
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
}: SpotlightProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const resultsLengthRef = useRef(0);

  const { query, setQuery, selectedIndex, setSelectedIndex, results, handleKeyDown, highlightMatch } =
    useSpotlightSearch({
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
    });

  resultsLengthRef.current = results.length;

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      // Focus input after a small delay to ensure modal is rendered
      setTimeout(() => {
        inputRef.current?.focus();
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

      // Capture Alt+N/P to prevent global shortcuts from firing, and handle navigation here
      // since stopImmediatePropagation prevents the input's onKeyDown from receiving the event
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'n' || e.key === 'p' || e.key === 'N' || e.key === 'P')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const keyLower = e.key.toLowerCase();
        const len = resultsLengthRef.current;
        if (keyLower === 'p') {
          setSelectedIndex((i) => (i > 0 ? i - 1 : len - 1));
        } else {
          setSelectedIndex((i) => (i < len - 1 ? i + 1 : 0));
        }
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

  // Reset selection when query changes
  const handleResetSelection = useCallback(() => {
    setSelectedIndex(0);
  }, [setSelectedIndex]);

  if (!isOpen) return null;

  return (
    <div ref={overlayRef} className="spotlight-overlay" onClick={handleBackdropClick}>
      <div className="spotlight-modal">
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
