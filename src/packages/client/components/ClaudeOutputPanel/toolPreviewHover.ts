/**
 * Ctrl+hover preview state for guake terminal tool rows.
 *
 * Deliberately a module-level external store rather than React state: the
 * terminal renders hundreds of tool rows, and putting "am I hovered / is Ctrl
 * held" in each one would re-render every visible row on a modifier press and
 * one row on every mouse enter/leave while scrolling. Here the rows only ever
 * *call* into this module (no subscription, no re-render) and the single popup
 * host is the lone subscriber.
 *
 * The popup is anchored to the row's rect (captured on enter), not to the
 * cursor — a tooltip that chases the mouse is unreadable, and rect anchoring
 * means no mousemove listener at all.
 */

import { useSyncExternalStore, type MouseEvent as ReactMouseEvent } from 'react';

import { parseFilePathReference, resolveAgentFilePath } from '../../utils/filePaths';

export interface ToolPreviewAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type ToolPreviewTarget =
  | {
      kind: 'file';
      /** Absolute path, already resolved against the agent cwd. */
      path: string;
      toolName: string;
      /** Passed as `baseDir` so the server's fallback search matches the click path. */
      baseDir?: string;
      highlightRange?: { offset: number; limit: number };
    }
  | {
      kind: 'edit';
      path: string;
      baseDir?: string;
      oldString?: string;
      newString?: string;
      unifiedDiff?: string;
    }
  | {
      kind: 'bash';
      command: string;
      output?: string;
      isRunning?: boolean;
    };

export interface ToolPreviewState {
  target: ToolPreviewTarget;
  anchor: ToolPreviewAnchor;
}

/** Root class of the popup — used to tell "inside the popup" events from outside ones. */
export const TOOL_PREVIEW_CLASS = 'tool-hover-preview';

/**
 * Grace period between leaving the row (or the popup) and hiding. The popup is
 * interactive, so the pointer must be able to travel from row to popup without
 * the thing evaporating mid-journey.
 */
const HIDE_DELAY_MS = 200;

const subscribers = new Set<() => void>();

/**
 * Feature switch, mirrored from the `toolHoverPreview` setting by the popup
 * host. Held here rather than read from the store so this module keeps no
 * import edge to the store barrel, and so the check costs one boolean on the
 * hover path instead of a state read per row.
 */
let enabled = true;

let hovered: ToolPreviewState | null = null;
let active: ToolPreviewState | null = null;
// Which element the pointer is on vs. which element owns the popup on screen.
// They diverge whenever the pointer wanders onto a *different* row while a
// popup is still up, which is precisely when it must fade.
let hoveredElement: HTMLElement | null = null;
let activeElement: HTMLElement | null = null;
let pointerInPopup = false;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let globalListenersInstalled = false;
let dismissListenersInstalled = false;

function emit(): void {
  for (const fn of subscribers) fn();
}

function cancelHide(): void {
  if (hideTimer === null) return;
  clearTimeout(hideTimer);
  hideTimer = null;
}

function setActive(next: ToolPreviewState | null): void {
  cancelHide();
  if (active === next) return;
  active = next;
  if (active) {
    installDismissListeners();
  } else {
    pointerInPopup = false;
    activeElement = null;
    removeDismissListeners();
  }
  emit();
}

/**
 * Hide unless, once the grace period is up, the pointer is inside the popup or
 * back on the row that owns it. Resting on some *other* row does not count —
 * that popup no longer describes what is under the cursor.
 */
function scheduleHide(): void {
  if (!active) return;
  cancelHide();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (!pointerInPopup && hoveredElement !== activeElement) setActive(null);
  }, HIDE_DELAY_MS);
}

const isModifier = (e: KeyboardEvent) => e.key === 'Control' || e.key === 'Meta';

/**
 * There is deliberately NO remembered "Ctrl is down" flag. Every mouse event
 * carries `ctrlKey`, so the modifier is read fresh from whichever event is
 * being handled. A cached flag only has to miss ONE keyup — window blur,
 * Ctrl+click, a focus change, a shortcut that opens something — to leave the
 * preview stuck on, popping up on every plain hover afterwards.
 *
 * Keydown covers the one case a mouse event can't: Ctrl pressed while the
 * pointer is already resting on a row, with no movement to report it.
 */
function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && active) {
    hovered = null;
    hoveredElement = null;
    setActive(null);
    return;
  }
  if (!isModifier(e) || !hovered || active) return;
  activeElement = hoveredElement;
  setActive(hovered);
}

/** Losing the window mid-hover leaves no way to observe the pointer — start clean. */
function onWindowBlur(): void {
  hovered = null;
  hoveredElement = null;
  setActive(null);
}

const isInsidePopup = (target: EventTarget | null): boolean =>
  target instanceof Element && !!target.closest(`.${TOOL_PREVIEW_CLASS}`);

/**
 * Scrolling the page moves the anchored row out from under the popup, and a
 * click usually opens something over it — but scrolling or clicking *inside*
 * the popup is exactly what we now want to support, so those pass through.
 */
function onDismissEvent(e: Event): void {
  if (isInsidePopup(e.target)) return;
  hovered = null;
  hoveredElement = null;
  setActive(null);
}

/**
 * No `keyup` listener on purpose. Releasing Ctrl must not hide the popup —
 * reaching in to scroll it means letting go of Ctrl (Ctrl+wheel is browser
 * zoom) — and with the modifier read fresh from each mouse event, there is no
 * flag left for a keyup to clear.
 */
function installGlobalListeners(): void {
  if (globalListenersInstalled || typeof window === 'undefined') return;
  globalListenersInstalled = true;
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('blur', onWindowBlur);
}

/** Only attached while a popup is up — `scroll` in capture phase is far too hot to keep on always. */
function installDismissListeners(): void {
  if (dismissListenersInstalled || typeof window === 'undefined') return;
  dismissListenersInstalled = true;
  window.addEventListener('scroll', onDismissEvent, true);
  window.addEventListener('mousedown', onDismissEvent, true);
}

function removeDismissListeners(): void {
  if (!dismissListenersInstalled || typeof window === 'undefined') return;
  dismissListenersInstalled = false;
  window.removeEventListener('scroll', onDismissEvent, true);
  window.removeEventListener('mousedown', onDismissEvent, true);
}

/**
 * Row entered. `modifier` is that mouse event's own `ctrlKey || metaKey` — the
 * single source of truth for whether the modifier is down right now, so a
 * missed keyup can never leave previews firing on plain hover.
 */
export function toolPreviewEnter(
  target: ToolPreviewTarget | null,
  element: HTMLElement | null,
  modifier: boolean,
): void {
  if (!enabled) return;
  installGlobalListeners();
  if (!element || !target) return;
  const rect = element.getBoundingClientRect();
  hovered = {
    target,
    anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
  };
  hoveredElement = element;

  if (modifier) {
    activeElement = element;
    setActive(hovered);
    return;
  }
  // Hovering without the modifier: never open anything, and let a popup still
  // on screen fade unless this is the row it belongs to.
  if (active) scheduleHide();
}

export function toolPreviewLeave(): void {
  hovered = null;
  hoveredElement = null;
  scheduleHide();
}

/**
 * Turn the whole gesture on or off (the `toolHoverPreview` setting). Switching
 * it off tears down anything currently on screen, so the popup can't be left
 * stranded by a mid-hover toggle.
 */
export function setToolPreviewEnabled(next: boolean): void {
  if (enabled === next) return;
  enabled = next;
  if (!enabled) {
    hovered = null;
    hoveredElement = null;
    setActive(null);
  }
}

/** Pointer moved onto the popup itself — keep it alive while it is being read. */
export function toolPreviewPopupEnter(): void {
  pointerInPopup = true;
  cancelHide();
}

export function toolPreviewPopupLeave(): void {
  pointerInPopup = false;
  scheduleHide();
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

const getSnapshot = () => active;
const getServerSnapshot = () => null;

export function useToolPreview(): ToolPreviewState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Row-side props. Spread onto the tool row's outer element.
 *
 * Takes a *builder*, not a target: the terminal re-renders tool rows constantly
 * and only one row is ever hovered, so path resolution / diff parsing is
 * deferred to the enter event. Pass `null` for rows with nothing to preview so
 * they get no handlers at all.
 */
export function toolPreviewHandlers(build: (() => ToolPreviewTarget | null) | null) {
  if (!build) return undefined;
  return {
    onMouseEnter: (e: ReactMouseEvent<HTMLElement>) =>
      toolPreviewEnter(build(), e.currentTarget, e.ctrlKey || e.metaKey),
    onMouseLeave: toolPreviewLeave,
  };
}

/**
 * Handlers for a clickable file path (markdown link, path inside a bash command,
 * ListFiles entry). Same Ctrl+hover gesture as a tool row, anchored to the link.
 *
 * A `file.ts:16` reference previews the region around line 16 rather than the
 * top of the file — the line number is the whole reason it was written.
 */
export function filePreviewHandlers(fileRef: string | null | undefined, baseDir?: string) {
  if (!fileRef) return undefined;
  return toolPreviewHandlers(() => {
    const { path, line } = parseFilePathReference(fileRef);
    if (!path) return null;
    return {
      kind: 'file',
      path: resolveAgentFilePath(path, baseDir),
      toolName: 'Read',
      baseDir,
      highlightRange: line ? { offset: line, limit: 1 } : undefined,
    };
  });
}

/** Test seam — resets module state between cases. */
export function __resetToolPreviewForTests(): void {
  cancelHide();
  hovered = null;
  active = null;
  hoveredElement = null;
  activeElement = null;
  pointerInPopup = false;
  removeDismissListeners();
}
