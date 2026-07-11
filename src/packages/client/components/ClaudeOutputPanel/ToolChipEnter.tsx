/**
 * Soft enter fade for LIVE terminal rows only:
 *  - tool chips (BASH / READ / EDIT / …)
 *  - final assistant responses (output-claude)
 *
 * History rows must NOT animate — pass animate={false}.
 *
 * Session-scoped enterIds so virtualizer remounts do not re-flash chips.
 * MutationObserver covers Grok empty→args tool upgrades.
 */

import React, { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Live lines that should soft-enter when they first appear. */
const ENTER_SELECTOR = [
  '.output-line.output-tool-use:not(.output-thinking)',
  '.output-line.output-claude',
].join(', ');

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

    const delay = Math.max(0, Math.min(staggerMs, 240));

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        scanAndAnimate(root, enterId, delay);
      });
    });

    // Empty Grok tool rows render null first; chip mounts later under same key.
    if (seenEnterIds.has(enterId)) {
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }

    const mo = new MutationObserver(() => {
      scanAndAnimate(root, enterId, 0);
      if (seenEnterIds.has(enterId)) mo.disconnect();
    });
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      mo.disconnect();
    };
  }, [enterId, staggerMs, animate]);

  return (
    <div ref={rootRef} className={className} data-chip-enter={enterId}>
      {children}
    </div>
  );
}
