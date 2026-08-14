/**
 * Works around a Chromium bug that strands native `title` tooltips on screen.
 *
 * Chromium renders a tooltip as its own window at a floating level (layer 103
 * on macOS), owned by the browser/app-mode process. When the window is
 * deactivated while a tooltip is showing — Cmd+Tab, AltTab, or any programmatic
 * activation of another app — installed web apps can fail to tear that window
 * down. The result floats above every other application and survives moving the
 * cursor away, hiding the owning app, and even minimizing its window; only
 * hovering another tooltip in the same app reclaims it.
 *
 * Removing the `title` attribute destroys the tooltip window immediately, so on
 * blur we strip it from whatever the cursor is over and restore it on focus.
 * Only the hover chain can be showing a tooltip, so that is all we touch.
 */

interface StashedTitle {
  el: Element;
  title: string;
}

let stashed: StashedTitle[] = [];
let lastHovered: Element | null = null;

function hoverChain(): Element[] {
  const chain = new Set<Element>();

  // `:hover` normally still matches once the window goes inactive, but Chromium
  // clears it in some paths — the tracked mouseover target covers those.
  for (const el of Array.from(document.querySelectorAll(':hover'))) {
    chain.add(el);
  }
  for (let el: Element | null = lastHovered; el; el = el.parentElement) {
    chain.add(el);
  }

  return Array.from(chain);
}

function stripHoveredTitles(): void {
  // A blur without an intervening focus would otherwise drop the stashed
  // originals and make the removal permanent.
  restoreTitles();

  for (const el of hoverChain()) {
    const title = el.getAttribute('title');
    if (title !== null) {
      stashed.push({ el, title });
      el.removeAttribute('title');
    }
  }
}

function restoreTitles(): void {
  for (const { el, title } of stashed) {
    // Skip elements React has since unmounted or re-rendered with a new title.
    if (el.isConnected && !el.hasAttribute('title')) {
      el.setAttribute('title', title);
    }
  }
  stashed = [];
}

export function installTooltipLeakFix(): void {
  document.addEventListener(
    'mouseover',
    (e) => {
      lastHovered = e.target instanceof Element ? e.target : null;
    },
    { capture: true, passive: true }
  );

  window.addEventListener('blur', stripHoveredTitles);
  window.addEventListener('focus', restoreTitles);
}
