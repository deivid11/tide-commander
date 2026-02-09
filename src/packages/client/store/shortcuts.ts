// Keyboard shortcut configuration types and defaults

export interface ShortcutModifiers {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean; // Cmd on Mac
}

export interface ShortcutConfig {
  id: string;
  name: string;
  description: string;
  key: string;
  modifiers: ShortcutModifiers;
  enabled: boolean;
  // Context where the shortcut is active
  context: 'global' | 'commander' | 'toolbox';
}

// Helper to create shortcut config
function shortcut(
  id: string,
  name: string,
  description: string,
  key: string,
  modifiers: ShortcutModifiers = {},
  context: ShortcutConfig['context'] = 'global'
): ShortcutConfig {
  return { id, name, description, key, modifiers, enabled: true, context };
}

// Default shortcuts configuration
export const DEFAULT_SHORTCUTS: ShortcutConfig[] = [
  // Global shortcuts
  shortcut('toggle-commander', 'Toggle Commander', 'Open/close Commander View', 'k', { ctrl: true }),
  shortcut('toggle-commander-tab', 'Toggle Commander (Tab)', 'Open/close Commander View with Tab', 'Tab', {}),
  shortcut('spawn-agent', 'Spawn Agent', 'Open new agent spawn modal', 'n', { alt: true }),
  shortcut('select-agent-1', 'Select Agent 1', 'Select first agent', '1', { ctrl: true }),
  shortcut('select-agent-2', 'Select Agent 2', 'Select second agent', '2', { ctrl: true }),
  shortcut('select-agent-3', 'Select Agent 3', 'Select third agent', '3', { ctrl: true }),
  shortcut('select-agent-4', 'Select Agent 4', 'Select fourth agent', '4', { ctrl: true }),
  shortcut('select-agent-5', 'Select Agent 5', 'Select fifth agent', '5', { ctrl: true }),
  shortcut('select-agent-6', 'Select Agent 6', 'Select sixth agent', '6', { ctrl: true }),
  shortcut('select-agent-7', 'Select Agent 7', 'Select seventh agent', '7', { ctrl: true }),
  shortcut('select-agent-8', 'Select Agent 8', 'Select eighth agent', '8', { ctrl: true }),
  shortcut('select-agent-9', 'Select Agent 9', 'Select ninth agent', '9', { ctrl: true }),
  shortcut('delete-selected', 'Delete Selected', 'Remove selected agents', 'Delete', {}),
  shortcut('delete-selected-backspace', 'Delete Selected (Backspace)', 'Remove selected agents', 'Backspace', {}),
  shortcut('deselect-all', 'Deselect All', 'Clear agent selection', 'Escape', {}),
  shortcut('open-terminal', 'Open Terminal', 'Open terminal for selected agent', 'Space', {}),
  shortcut('dashboard-selector-toggle', 'Dashboard Selector', 'Enable dashboard card selector', ',', {}),
  shortcut('dashboard-vim-left', 'Dashboard Left', 'Move dashboard selector left', 'h', {}),
  shortcut('dashboard-vim-down', 'Dashboard Down', 'Move dashboard selector down', 'j', {}),
  shortcut('dashboard-vim-up', 'Dashboard Up', 'Move dashboard selector up', 'k', {}),
  shortcut('dashboard-vim-right', 'Dashboard Right', 'Move dashboard selector right', 'l', {}),
  shortcut('next-agent', 'Next Agent', 'Select next agent on battlefield', 'l', { alt: true }),
  shortcut('prev-agent', 'Previous Agent', 'Select previous agent on battlefield', 'h', { alt: true }),
  shortcut('next-working-agent', 'Next Working Agent', 'Select next working agent on battlefield', 'l', { alt: true, shift: true }),
  shortcut('prev-working-agent', 'Previous Working Agent', 'Select previous working agent on battlefield', 'h', { alt: true, shift: true }),
  shortcut('next-message', 'Next Message', 'Navigate to next message in terminal', 'j', { alt: true }),
  shortcut('prev-message', 'Previous Message', 'Navigate to previous message in terminal', 'k', { alt: true }),
  shortcut('page-down-messages', 'Page Down Messages', 'Jump down 10 messages in terminal', 'd', { alt: true }),
  shortcut('page-up-messages', 'Page Up Messages', 'Jump up 10 messages in terminal', 'u', { alt: true }),
  shortcut('next-agent-terminal', 'Next Agent (Terminal)', 'Switch to next agent in terminal', 'l', { alt: true }),
  shortcut('prev-agent-terminal', 'Previous Agent (Terminal)', 'Switch to previous agent in terminal', 'h', { alt: true }),
  shortcut('activate-message', 'Activate Message', 'Click on interactive element in selected message', 'Space', {}),
  shortcut('toggle-file-explorer', 'Toggle File Explorer', 'Open/close file explorer', 'e', { alt: true }),
  shortcut('file-explorer-close-tab', 'Close File Tab', 'Close active file tab in explorer', 'w', { alt: true }),
  shortcut('toggle-spotlight', 'Toggle Spotlight', 'Open/close global search', 'p', { alt: true }),
  shortcut('toggle-2d-view', 'Cycle View Mode', 'Cycle between 3D, 2D, and Dashboard views', '2', { alt: true }),

  // Commander context shortcuts
  shortcut('commander-close', 'Close Commander', 'Close Commander View', 'Escape', {}, 'commander'),
  shortcut('commander-vim-left', 'Navigate Left', 'Move focus left (Vim H)', 'h', { alt: true }, 'commander'),
  shortcut('commander-vim-down', 'Navigate Down', 'Move focus down (Vim J)', 'j', { alt: true }, 'commander'),
  shortcut('commander-vim-up', 'Navigate Up', 'Move focus up (Vim K)', 'k', { alt: true }, 'commander'),
  shortcut('commander-vim-right', 'Navigate Right', 'Move focus right (Vim L)', 'l', { alt: true }, 'commander'),
  shortcut('commander-expand', 'Expand/Collapse', 'Toggle agent expansion', 'o', { alt: true }, 'commander'),
  shortcut('commander-new-agent', 'New Agent', 'Open spawn form in commander', 'n', { alt: true }, 'commander'),
  shortcut('commander-next-tab', 'Next Tab', 'Switch to next area tab', 'Tab', {}, 'commander'),
  shortcut('commander-prev-tab', 'Previous Tab', 'Switch to previous area tab', 'Tab', { shift: true }, 'commander'),

  // Toolbox context shortcuts
  shortcut('toolbox-close', 'Close Toolbox', 'Close Settings panel', 'Escape', {}, 'toolbox'),
];

// Check if a keyboard event matches a shortcut config
export function matchesShortcut(event: KeyboardEvent, shortcut: ShortcutConfig | undefined): boolean {
  if (!shortcut || !shortcut.enabled) return false;

  // Check modifiers first
  const { ctrl, alt, shift } = shortcut.modifiers;

  // For ctrl, also accept meta on Mac (Cmd key)
  const ctrlMatch = ctrl ? (event.ctrlKey || event.metaKey) : (!event.ctrlKey && !event.metaKey);
  const altMatch = alt ? event.altKey : !event.altKey;
  const shiftMatch = shift ? event.shiftKey : !event.shiftKey;

  // Special case: if ctrl is required, we accept either ctrl or meta
  let modifiersMatch: boolean;
  if (ctrl) {
    modifiersMatch = (event.ctrlKey || event.metaKey) && altMatch && shiftMatch;
  } else {
    modifiersMatch = ctrlMatch && altMatch && shiftMatch;
  }

  if (!modifiersMatch) return false;

  // Check key - use event.code for single letter keys when alt is pressed
  // (Alt can modify the character on some systems, e.g., Alt+N = ñ on Mac)
  const shortcutKey = shortcut.key;

  // For single letter keys, compare using event.code (e.g., "KeyN" for "n")
  if (shortcutKey.length === 1 && /^[a-zA-Z]$/.test(shortcutKey)) {
    const expectedCode = `Key${shortcutKey.toUpperCase()}`;
    return event.code === expectedCode;
  }

  // For number keys
  if (shortcutKey.length === 1 && /^[0-9]$/.test(shortcutKey)) {
    const expectedCode = `Digit${shortcutKey}`;
    return event.code === expectedCode;
  }

  // For Space key, compare using event.code since event.key is ' '
  if (shortcutKey === 'Space' || shortcutKey === ' ') {
    return event.code === 'Space';
  }

  // For special keys, compare event.key directly
  const eventKey = event.key;
  return eventKey === shortcutKey;
}

// Format shortcut for display
export function formatShortcut(shortcut: ShortcutConfig): string {
  const parts: string[] = [];

  if (shortcut.modifiers.ctrl) {
    // Show Cmd on Mac, Ctrl on others
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    parts.push(isMac ? '⌘' : 'Ctrl');
  }
  if (shortcut.modifiers.alt) {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    parts.push(isMac ? '⌥' : 'Alt');
  }
  if (shortcut.modifiers.shift) {
    parts.push('Shift');
  }
  if (shortcut.modifiers.meta) {
    parts.push('⌘');
  }

  // Format the key nicely
  let keyDisplay = shortcut.key;
  if (keyDisplay === ' ') keyDisplay = 'Space';
  else if (keyDisplay.length === 1) keyDisplay = keyDisplay.toUpperCase();

  parts.push(keyDisplay);

  return parts.join('+');
}

// Parse a keyboard event into shortcut config format
export function parseKeyboardEvent(event: KeyboardEvent): { key: string; modifiers: ShortcutModifiers } {
  return {
    key: event.key,
    modifiers: {
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
    },
  };
}

// Check for shortcut conflicts
export function findConflictingShortcuts(
  shortcuts: ShortcutConfig[],
  newShortcut: { key: string; modifiers: ShortcutModifiers },
  excludeId?: string,
  context?: ShortcutConfig['context']
): ShortcutConfig[] {
  return shortcuts.filter(s => {
    if (s.id === excludeId) return false;
    if (!s.enabled) return false;

    // Check context compatibility - global conflicts with everything
    if (context && s.context !== 'global' && s.context !== context) return false;

    // Check if keys match (normalize Space key: ' ' and 'Space' are equivalent)
    const normalizeKey = (k: string) => (k === ' ' || k === 'Space') ? 'Space' : (k.length === 1 ? k.toLowerCase() : k);
    const sKey = normalizeKey(s.key);
    const nKey = normalizeKey(newShortcut.key);
    if (sKey !== nKey) return false;

    // Check if modifiers match
    const sm = s.modifiers;
    const nm = newShortcut.modifiers;
    return (
      (sm.ctrl || false) === (nm.ctrl || false) &&
      (sm.alt || false) === (nm.alt || false) &&
      (sm.shift || false) === (nm.shift || false) &&
      (sm.meta || false) === (nm.meta || false)
    );
  });
}
