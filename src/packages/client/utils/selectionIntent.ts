/**
 * Why the current agent selection happened, for consumers that react to it.
 *
 * Tab / Shift+Tab cycle through working agents. Selecting an agent normally
 * autofocuses the chat input on desktop, which would swallow the NEXT Tab
 * (focus navigation inside the input) and end the cycle after one step. The
 * cycle marks its selections here; the input's autofocus effect consumes the
 * mark and stays put.
 *
 * Module state rather than a store field: no new Store method (which needs a
 * STORE_VERSION bump to survive HMR) for a one-shot, short-lived hint.
 */

const KEYBOARD_CYCLE_WINDOW_MS = 1500;
let keyboardCycleAt = 0;

/** Called right before a keyboard-cycle selection. */
export function markKeyboardCycleSelection(now: number = Date.now()): void {
  keyboardCycleAt = now;
}

/** True (once) when the latest selection came from the keyboard cycle. */
export function consumeKeyboardCycleSelection(now: number = Date.now()): boolean {
  const recent = keyboardCycleAt !== 0 && now - keyboardCycleAt <= KEYBOARD_CYCLE_WINDOW_MS;
  keyboardCycleAt = 0;
  return recent;
}
