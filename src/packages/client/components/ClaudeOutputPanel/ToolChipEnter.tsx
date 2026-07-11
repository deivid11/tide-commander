/**
 * Soft fade-in for tool chips (BASH / READ / EDIT / LIST FILES / …).
 *
 * Same spirit as StreamFadeText: injects styles and applies enter motion via
 * element.style so it works even if SCSS is stale. Kept subtle — opacity +
 * a light rise only (no scale pop / blur).
 *
 * Intentionally does NOT honor prefers-reduced-motion — StreamFadeText also
 * ignores it; both are live-terminal polish.
 *
 * Watches the row with MutationObserver so Grok empty→args upgrades (null →
 * chip) still animate on first real paint. Each DOM node animates once
 * (data-tide-chip-animated).
 */

import React, { useLayoutEffect, useRef, type ReactNode } from 'react';

const STYLE_ID = 'tide-tool-chip-keyframes-v5';

const KEYFRAMES_CSS = `
@keyframes tide-tool-chip-in {
  0% {
    opacity: 0;
    transform: translateY(4px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}
`.trim();

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = KEYFRAMES_CSS;
  document.head.appendChild(el);
}

function animateChipElement(el: HTMLElement, delayMs = 0): void {
  if (el.dataset.tideChipAnimated === '1') return;
  el.dataset.tideChipAnimated = '1';

  // Soft transition: opacity + slight rise only (no scale/blur "pop").
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

function scanAndAnimate(root: HTMLElement, delayMs: number): number {
  const chips = root.querySelectorAll<HTMLElement>(
    '.output-line.output-tool-use:not(.output-thinking)',
  );
  if (chips.length === 0) return 0;

  ensureKeyframes();
  let n = 0;
  chips.forEach((chip) => {
    if (chip.dataset.tideChipAnimated === '1') return;
    animateChipElement(chip, delayMs);
    n += 1;
  });
  return n;
}

export interface ToolChipEnterProps {
  enterId: string;
  children: ReactNode;
  className?: string;
  staggerMs?: number;
}

export function ToolChipEnter({ enterId, children, className, staggerMs = 0 }: ToolChipEnterProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    ensureKeyframes();
    const delay = Math.max(0, Math.min(staggerMs, 240));

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        scanAndAnimate(root, delay);
      });
    });

    const mo = new MutationObserver(() => {
      scanAndAnimate(root, 0);
    });
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      mo.disconnect();
    };
  }, [enterId, staggerMs]);

  return (
    <div ref={rootRef} className={className} data-chip-enter={enterId}>
      {children}
    </div>
  );
}
