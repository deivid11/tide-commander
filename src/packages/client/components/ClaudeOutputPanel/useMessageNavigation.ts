/**
 * useMessageNavigation - Hook for keyboard navigation of terminal messages
 *
 * Handles Alt+J (down) and Alt+K (up) keyboard shortcuts for navigating
 * through messages in the terminal output, with auto-scrolling support.
 */

import { useState, useCallback, useEffect, useRef } from 'react';

export interface UseMessageNavigationProps {
  /** Total number of navigable messages (history + output combined) */
  totalMessages: number;
  /** Whether the terminal is open */
  isOpen: boolean;
  /** Whether any modal is open (to prevent navigation) */
  hasModalOpen?: boolean;
  /** Ref to the scroll container for auto-scrolling */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Selected agent ID (to reset selection when agent changes) */
  selectedAgentId: string | null;
  /** Ref to the input element to focus when typing during navigation */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** Ref to the textarea element to focus when typing during navigation */
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  /** Whether the textarea is currently being used */
  useTextarea?: boolean;
}

export interface UseMessageNavigationReturn {
  /** Currently selected message index (-1 means no selection) */
  selectedIndex: number;
  /** Set the selected index directly */
  setSelectedIndex: (index: number) => void;
  /** Clear the selection */
  clearSelection: () => void;
  /** Navigate to previous message (up) */
  navigatePrev: () => void;
  /** Navigate to next message (down) */
  navigateNext: () => void;
  /** Navigate page up (multiple messages) */
  navigatePageUp: () => void;
  /** Navigate page down (multiple messages) */
  navigatePageDown: () => void;
  /** Check if a message at given index is selected */
  isSelected: (index: number) => boolean;
}

// Number of messages to jump when using page up/down
const PAGE_SIZE = 10;

export function useMessageNavigation({
  totalMessages,
  isOpen,
  hasModalOpen = false,
  scrollContainerRef,
  selectedAgentId,
  inputRef,
  textareaRef,
  useTextarea = false,
}: UseMessageNavigationProps): UseMessageNavigationReturn {
  // Selected message index (-1 means no selection, starts from bottom)
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  // Track the previous agent to reset selection on agent change
  const prevAgentRef = useRef<string | null>(null);

  // Reset selection when agent changes
  useEffect(() => {
    if (prevAgentRef.current !== selectedAgentId) {
      setSelectedIndex(-1);
      prevAgentRef.current = selectedAgentId;
    }
  }, [selectedAgentId]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedIndex(-1);
  }, []);

  // Track ongoing scroll animation
  const scrollAnimationRef = useRef<number | null>(null);

  // Easing function for smooth scroll (ease-out cubic)
  const easeOutCubic = (t: number): number => {
    return 1 - Math.pow(1 - t, 3);
  };

  // Custom smooth scroll with easing
  const smoothScrollTo = useCallback((container: HTMLElement, targetScrollTop: number, duration: number = 200) => {
    // Cancel any ongoing animation
    if (scrollAnimationRef.current) {
      cancelAnimationFrame(scrollAnimationRef.current);
    }

    const startScrollTop = container.scrollTop;
    const distance = targetScrollTop - startScrollTop;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutCubic(progress);

      container.scrollTop = startScrollTop + (distance * easedProgress);

      if (progress < 1) {
        scrollAnimationRef.current = requestAnimationFrame(animate);
      } else {
        scrollAnimationRef.current = null;
      }
    };

    scrollAnimationRef.current = requestAnimationFrame(animate);
  }, []);

  // Scroll to make selected message visible with nice animation
  const scrollToIndex = useCallback((index: number) => {
    if (!scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    const messageEl = container.querySelector(`[data-message-index="${index}"]`) as HTMLElement;

    if (messageEl) {
      const containerRect = container.getBoundingClientRect();
      const messageRect = messageEl.getBoundingClientRect();

      // Add some padding for visual comfort
      const padding = 20;

      // Check if message is above the visible area
      if (messageRect.top < containerRect.top + padding) {
        const targetScroll = container.scrollTop + (messageRect.top - containerRect.top) - padding;
        smoothScrollTo(container, targetScroll, 180);
      }
      // Check if message is below the visible area
      else if (messageRect.bottom > containerRect.bottom - padding) {
        const targetScroll = container.scrollTop + (messageRect.bottom - containerRect.bottom) + padding;
        smoothScrollTo(container, targetScroll, 180);
      }
    }
  }, [scrollContainerRef, smoothScrollTo]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (scrollAnimationRef.current) {
        cancelAnimationFrame(scrollAnimationRef.current);
      }
    };
  }, []);

  // Navigate to previous message (up / Alt+K)
  const navigatePrev = useCallback(() => {
    if (totalMessages === 0) return;

    setSelectedIndex((current) => {
      let newIndex: number;
      if (current === -1) {
        // Start from the last message when first navigating
        newIndex = totalMessages - 1;
      } else if (current > 0) {
        // Move up
        newIndex = current - 1;
      } else {
        // Already at the top, stay there
        newIndex = 0;
      }

      // Schedule scroll after state update
      requestAnimationFrame(() => scrollToIndex(newIndex));
      return newIndex;
    });
  }, [totalMessages, scrollToIndex]);

  // Navigate to next message (down / Alt+J)
  const navigateNext = useCallback(() => {
    if (totalMessages === 0) return;

    setSelectedIndex((current) => {
      let newIndex: number;
      if (current === -1) {
        // Start from the last message when first navigating
        newIndex = totalMessages - 1;
      } else if (current < totalMessages - 1) {
        // Move down
        newIndex = current + 1;
      } else {
        // Already at the bottom, clear selection (exit navigation mode)
        return -1;
      }

      // Schedule scroll after state update
      requestAnimationFrame(() => scrollToIndex(newIndex));
      return newIndex;
    });
  }, [totalMessages, scrollToIndex]);

  // Navigate page up (Alt+U) - jump multiple messages
  const navigatePageUp = useCallback(() => {
    if (totalMessages === 0) return;

    setSelectedIndex((current) => {
      let newIndex: number;
      if (current === -1) {
        // Start from the last message when first navigating
        newIndex = totalMessages - 1;
      } else {
        // Jump up by PAGE_SIZE, but don't go below 0
        newIndex = Math.max(0, current - PAGE_SIZE);
      }

      // Schedule scroll after state update
      requestAnimationFrame(() => scrollToIndex(newIndex));
      return newIndex;
    });
  }, [totalMessages, scrollToIndex]);

  // Navigate page down (Alt+D) - jump multiple messages
  const navigatePageDown = useCallback(() => {
    if (totalMessages === 0) return;

    setSelectedIndex((current) => {
      let newIndex: number;
      if (current === -1) {
        // Start from the last message when first navigating
        newIndex = totalMessages - 1;
      } else if (current + PAGE_SIZE >= totalMessages) {
        // Would go past the end, clear selection (exit navigation mode)
        return -1;
      } else {
        // Jump down by PAGE_SIZE
        newIndex = current + PAGE_SIZE;
      }

      // Schedule scroll after state update
      requestAnimationFrame(() => scrollToIndex(newIndex));
      return newIndex;
    });
  }, [totalMessages, scrollToIndex]);

  // Check if a message is selected
  const isSelected = useCallback((index: number) => {
    return selectedIndex === index;
  }, [selectedIndex]);

  // Keyboard shortcuts for message navigation (Alt+J / Alt+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (hasModalOpen) return;

      // Alt+K → previous message (up)
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'k') {
        e.preventDefault();
        // Blur input when starting navigation
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        navigatePrev();
      }
      // Alt+J → next message (down)
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'j') {
        e.preventDefault();
        // Blur input when starting navigation
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        navigateNext();
      }
      // Alt+U → page up (fast navigation)
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'u') {
        e.preventDefault();
        // Blur input when starting navigation
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        navigatePageUp();
      }
      // Alt+D → page down (fast navigation)
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'd') {
        e.preventDefault();
        // Blur input when starting navigation
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        navigatePageDown();
      }
      // Escape → clear selection
      if (e.key === 'Escape' && selectedIndex !== -1) {
        e.preventDefault();
        clearSelection();
      }

      // Space → activate selected message (click on tool param, bash output, etc.)
      // But don't trigger when typing in an input field
      const target = e.target as HTMLElement;
      const isInInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (e.key === ' ' && selectedIndex !== -1 && !isInInputField) {
        e.preventDefault();
        const container = scrollContainerRef.current;
        if (!container) return;

        const messageEl = container.querySelector(`[data-message-index="${selectedIndex}"]`) as HTMLElement;
        if (!messageEl) return;

        // Try clicking on various interactive elements in priority order
        const clickableSelectors = [
          '.clickable-path',           // File tool paths
          '.output-tool-use.bash-clickable', // Bash tool (whole line is clickable)
          '.clickable-bash',           // Bash in history
          '.history-view-md-btn',      // View markdown button
        ];

        for (const selector of clickableSelectors) {
          const clickable = messageEl.querySelector(selector) as HTMLElement;
          if (clickable) {
            clickable.click();
            return;
          }
        }

        // If the message wrapper itself is a bash tool, click it
        const toolUseLine = messageEl.querySelector('.output-tool-use') as HTMLElement;
        if (toolUseLine?.classList.contains('bash-clickable')) {
          toolUseLine.click();
        }
        return;
      }

      // When in navigation mode and user types a character (not navigation keys),
      // focus the input and let the character be typed
      if (selectedIndex !== -1 && !isInInputField) {
        // Skip navigation keys, modifier-only keys, and special keys
        const isNavigationKey = e.altKey && ['j', 'k', 'u', 'd'].includes(e.key.toLowerCase());
        const isSpecialKey = ['Escape', 'Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key);
        const isArrowKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);
        const isFunctionKey = e.key.startsWith('F') && e.key.length <= 3; // F1-F12

        // If it's a printable character or common editing key (not a navigation/special key)
        if (!isNavigationKey && !isSpecialKey && !isArrowKey && !isFunctionKey && !e.ctrlKey && !e.metaKey) {
          // Focus the appropriate input element
          const inputElement = useTextarea ? textareaRef?.current : inputRef?.current;
          if (inputElement) {
            inputElement.focus();
            // Clear selection since user is now typing
            setSelectedIndex(-1);
            // Let the default event happen so the character gets typed
            return;
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, hasModalOpen, navigatePrev, navigateNext, navigatePageUp, navigatePageDown, clearSelection, selectedIndex, inputRef, textareaRef, useTextarea]);

  // Adjust selection if messages are removed
  useEffect(() => {
    if (selectedIndex >= totalMessages && totalMessages > 0) {
      setSelectedIndex(totalMessages - 1);
    } else if (totalMessages === 0) {
      setSelectedIndex(-1);
    }
  }, [totalMessages, selectedIndex]);

  return {
    selectedIndex,
    setSelectedIndex,
    clearSelection,
    navigatePrev,
    navigateNext,
    navigatePageUp,
    navigatePageDown,
    isSelected,
  };
}
