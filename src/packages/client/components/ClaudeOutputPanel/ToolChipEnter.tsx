/**
 * Soft enter fade for LIVE tool chips (BASH / READ / EDIT / …) only.
 * Assistant text rows fade via StreamFadeText's CompleteBlockFade — keeping
 * them out of this selector avoids double-animating the same row.
 *
 * History rows must NOT animate — pass animate={false}.
 *
 * Session-scoped enterIds so virtualizer remounts do not re-flash chips.
 * MutationObserver covers Grok empty→args tool upgrades — attached ONLY while
 * the row is still empty; rows that render non-matching content (thinking,
 * user prompts, text) are marked seen immediately so live-stream DOM mutations
 * don't re-run the scan dozens of times per second.
 */

import React, { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Live lines that should soft-enter when they first appear. */
const ENTER_SELECTOR = '.output-line.output-tool-use:not(.output-thinking)';

/** Each logical row id animates at most once per page session. */
const seenEnterIds = new Set<string>();

function animateEnterElement(el: HTMLElement, delayMs = 0): void {
  if (el.dataset.tideChipAnimated === '1') return;
  el.dataset.tideChipAnimated = '1';

  el.style.transition = 'none';
  el.style.opacity = '0';
  el.style.transform = 'translateY(4px)';
  el.style.filter = '';
  void el.offsetWidth;

  const duration = '0.38s';
  const ease = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const delay = `${Math.max(0, delayMs)}ms`;
  el.style.transition = [
    `opacity ${duration} ${ease} ${delay}`,
    `transform ${duration} ${ease} ${delay}`,
  ].join(', ');
  el.style.opacity = '1';
  el.style.transform = 'translateY(0)';

  const onEnd = (ev: TransitionEvent) => {
    if (ev.target !== el) return;
    if (ev.propertyName !== 'opacity') return;
    el.style.transition = '';
    el.style.transform = '';
    el.removeEventListener('transitionend', onEnd);
  };
  el.addEventListener('transitionend', onEnd);
}

function scanAndAnimate(root: HTMLElement, enterId: string, delayMs: number): number {
  if (seenEnterIds.has(enterId)) return 0;

  const nodes = root.querySelectorAll<HTMLElement>(ENTER_SELECTOR);
  if (nodes.length === 0) return 0;

  seenEnterIds.add(enterId);
  let n = 0;
  nodes.forEach((node) => {
    if (node.dataset.tideChipAnimated === '1') return;
    animateEnterElement(node, delayMs);
    n += 1;
  });
  return n;
}

export interface ToolChipEnterProps {
  enterId: string;
  children: ReactNode;
  className?: string;
  staggerMs?: number;
  /** When false, skip enter animation (history / already-loaded rows). */
  animate?: boolean;
}

export function ToolChipEnter({
  enterId,
  children,
  className,
  staggerMs = 0,
  animate = true,
}: ToolChipEnterProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!animate) return;
    const root = rootRef.current;
    if (!root || !enterId) return;
    // Already animated this session (virtualizer remount) — nothing to do.
    if (seenEnterIds.has(enterId)) return;

    const delay = Math.max(0, Math.min(staggerMs, 240));

    let mo: MutationObserver | null = null;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        scanAndAnimate(root, enterId, delay);
        if (seenEnterIds.has(enterId)) return;

        if (root.childElementCount > 0) {
          // The row rendered real content that doesn't match the selector
          // (thinking / user / text rows). It will never become a tool chip —
          // mark it seen so streaming DOM mutations don't keep re-scanning.
          seenEnterIds.add(enterId);
          return;
        }

        // Row rendered null (Grok early tool card without args) — the chip
        // mounts later under the same key. Watch until it appears.
        mo = new MutationObserver(() => {
          scanAndAnimate(root, enterId, 0);
          if (seenEnterIds.has(enterId)) mo?.disconnect();
        });
        mo.observe(root, { childList: true, subtree: true });
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      mo?.disconnect();
    };
  }, [enterId, staggerMs, animate]);

  return (
    <div ref={rootRef} className={className} data-chip-enter={enterId}>
      {children}
    </div>
  );
}
