/**
 * Replace Chromium's native `title` tooltips with one drawn inside the page.
 *
 * On macOS Chromium shows a `title` through AppKit's tooltip machinery, in a
 * separate native window that it opens and closes by faking tracking events.
 * That window can be orphaned: it then floats over the app (and over other apps)
 * indefinitely, no matter where the cursor goes, until the app is restarted.
 * Nothing in the page can close it once it leaks, so the only reliable fix is
 * to never let it open: while the mouse is over an element its `title` (and its
 * ancestors') is taken off the DOM and shown in a tooltip of our own, then put
 * back when the mouse leaves. Outside of hover the attribute stays in place, so
 * accessible names and anything else reading `title` keep working.
 */
const SHOW_DELAY_MS = 600;
const CURSOR_GAP_PX = 18;
const VIEWPORT_MARGIN_PX = 6;
/** Moving this far from where the tooltip appeared closes it. */
const DISMISS_DISTANCE_PX = 8;

export function installTooltipLeakFix(): () => void {
  /** Titles currently taken off the DOM: the hovered element and its ancestors. */
  const held = new Map<Element, string>();
  let hovered: Element | null = null;
  /** Element whose title is on screen, about to be, or was dismissed. */
  let owner: Element | null = null;
  let ownerText = '';
  let tip: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let x = 0;
  let y = 0;
  let shownX = 0;
  let shownY = 0;

  const hide = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    tip?.remove();
    tip = null;
  };

  const show = (text: string) => {
    timer = null;
    shownX = x;
    shownY = y;
    tip = document.createElement('div');
    tip.className = 'tide-title-tip';
    tip.setAttribute('aria-hidden', 'true');
    tip.textContent = text;
    document.body.appendChild(tip);
    // As a popover it joins the top layer, above modal dialogs and other popovers.
    if (typeof tip.showPopover === 'function') {
      tip.popover = 'manual';
      tip.showPopover();
    }
    const { width, height } = tip.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN_PX;
    const below = y + CURSOR_GAP_PX;
    const fitsBelow = below + height + VIEWPORT_MARGIN_PX <= window.innerHeight;
    tip.style.left = `${Math.max(VIEWPORT_MARGIN_PX, Math.min(x, maxLeft))}px`;
    tip.style.top = `${Math.max(VIEWPORT_MARGIN_PX, fitsBelow ? below : y - height - 8)}px`;
  };

  const restore = (element: Element) => {
    const title = held.get(element);
    held.delete(element);
    // Do not overwrite a title that React set while the element was hovered.
    if (title !== undefined && element.isConnected && !element.hasAttribute('title')) {
      element.setAttribute('title', title);
    }
  };

  /** Take the titles off the hovered chain and (re)schedule the nearest one. */
  const sync = () => {
    const chain = new Set<Element>();
    for (let element = hovered; element; element = element.parentElement) chain.add(element);

    for (const element of [...held.keys()]) {
      if (!chain.has(element)) restore(element);
    }

    let nextOwner: Element | null = null;
    for (const element of chain) {
      const title = element.getAttribute('title');
      if (title !== null) {
        held.set(element, title);
        element.removeAttribute('title');
      }
      // Like the native tooltip, the nearest title wins, and an empty one suppresses.
      if (nextOwner === null && held.has(element)) nextOwner = element;
    }

    const text = nextOwner ? (held.get(nextOwner) ?? '') : '';
    if (nextOwner === owner && text === ownerText) return;
    hide();
    owner = nextOwner;
    ownerText = text;
    if (text.trim()) timer = setTimeout(() => show(text), SHOW_DELAY_MS);
  };

  const isMouse = (event: Event) => (event as PointerEvent).pointerType === 'mouse';

  const onPointerOver = (event: Event) => {
    // Touch never shows a native tooltip, and a tap has no "leave" to close ours.
    if (!isMouse(event)) return;
    hovered = event.target instanceof Element ? event.target : null;
    sync();
  };

  const onPointerOut = (event: Event) => {
    if (!isMouse(event) || (event as PointerEvent).relatedTarget) return;
    // The pointer left the window.
    hovered = null;
    sync();
  };

  const onPointerMove = (event: Event) => {
    x = (event as PointerEvent).clientX;
    y = (event as PointerEvent).clientY;
    // Do not linger over a large element once the cursor has moved on.
    if (tip && Math.hypot(x - shownX, y - shownY) > DISMISS_DISTANCE_PX) hide();
  };

  // Dismissed until the pointer reaches another element, as the native tooltip is.
  const dismiss = () => hide();

  // React can set a new title on an element while it is hovered (a counter, a
  // toggled label): take that one too, or the native tooltip would show it.
  const observer =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver((records) => {
          if (records.some((record) => held.has(record.target as Element))) sync();
        });
  observer?.observe(document, { attributes: true, attributeFilter: ['title'], subtree: true });

  const capture = { capture: true, passive: true };
  document.addEventListener('pointerover', onPointerOver, capture);
  document.addEventListener('pointerout', onPointerOut, capture);
  document.addEventListener('pointermove', onPointerMove, capture);
  document.addEventListener('pointerdown', dismiss, capture);
  document.addEventListener('keydown', dismiss, capture);
  document.addEventListener('scroll', dismiss, capture);
  window.addEventListener('blur', dismiss);

  return () => {
    observer?.disconnect();
    hide();
    hovered = null;
    owner = null;
    for (const element of [...held.keys()]) restore(element);
    document.removeEventListener('pointerover', onPointerOver, true);
    document.removeEventListener('pointerout', onPointerOut, true);
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerdown', dismiss, true);
    document.removeEventListener('keydown', dismiss, true);
    document.removeEventListener('scroll', dismiss, true);
    window.removeEventListener('blur', dismiss);
  };
}
