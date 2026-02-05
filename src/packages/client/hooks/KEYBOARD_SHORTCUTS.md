# Keyboard Shortcuts Guide

## Overview

Tide Commander supports comprehensive keyboard shortcuts for fast navigation and control. All shortcuts can be customized through the settings.

## View Mode Shortcuts (Phase 3)

### Direct Mode Switching

| Shortcut | Action | Notes |
|----------|--------|-------|
| **Alt+1** | Switch to 2D Mode | Top-down flat view |
| **Alt+2** | Switch to 3D Mode | Isometric 3D view (default) |
| **Alt+3** | Switch to Dashboard Mode | Metrics and overview |
| **Alt+2** (cycle) | Cycle through modes | 3D → 2D → Dashboard → 3D |

**Tips:**
- Alt+1/2/3 directly switch to specific mode
- Alt+2 (existing) cycles through all modes
- Mode preference is saved to localStorage
- Smooth transitions with no data loss

### Example Usage Patterns

```
1. Quick metrics check:
   Alt+3 (open dashboard) → view metrics → Alt+2 (back to 3D)

2. Compare 2D and 3D views:
   Alt+1 (switch to 2D) → analyze → Alt+2 (switch to 3D)

3. Mode workflow:
   Alt+3 → check dashboard → select agent → Alt+2 → focus in 3D
```

## Panel Toggle Shortcuts (Phase 3)

| Shortcut | Action | Notes |
|----------|--------|-------|
| **Alt+S** | Toggle Sidebar | Show/hide left panel |
| **Alt+R** | Toggle Right Panel | Show/hide info panel |

**Benefits:**
- Maximize canvas space by hiding panels
- Quick access without mouse
- Responsive on all screen sizes

## Global Shortcuts

| Shortcut | Action | Context |
|----------|--------|---------|
| **Escape** | Deselect / Close | Clears selection, closes modals |
| **Tab** | Toggle Commander | Open/close Commander View |
| **Ctrl+K** / **Cmd+K** | Toggle Commander | Alternative to Tab |
| **Alt+N** | Spawn Agent | Open new agent modal |
| **Alt+E** | Toggle File Explorer | Open file browser |
| **Alt+P** | Toggle Spotlight | Open global search |
| **Delete** | Delete Selected | Remove agent/building |
| **Backspace** | Delete Selected | Alternative to Delete |

## Agent Selection Shortcuts

| Shortcut | Action | Notes |
|----------|--------|-------|
| **Ctrl+1** | Select Agent 1 | First agent in list |
| **Ctrl+2** | Select Agent 2 | Second agent |
| **Ctrl+3** | Select Agent 3 | Third agent |
| **...** | ... | Continue through... |
| **Ctrl+9** | Select Agent 9 | Ninth agent |

**Usage:**
- Quick agent selection without mouse
- Useful for frequently used agents
- Numbering based on agent order in store

## Navigation Shortcuts (Commander Mode)

| Shortcut | Action | Context |
|----------|--------|---------|
| **Alt+H** | Navigate Left | Move focus left (Vim-style) |
| **Alt+J** | Navigate Down | Move focus down |
| **Alt+K** | Navigate Up | Move focus up |
| **Alt+L** | Navigate Right | Move focus right |
| **Alt+L** | Next Agent | Alternate in terminal |
| **Alt+H** | Previous Agent | Alternate in terminal |

## Terminal Navigation

| Shortcut | Action | Context |
|----------|--------|---------|
| **Alt+J** | Next Message | Navigate in terminal |
| **Alt+K** | Previous Message | Navigate in terminal |
| **Alt+D** | Page Down | Jump 10 messages |
| **Alt+U** | Page Up | Jump 10 messages |
| **Space** | Activate Element | Click interactive items |

## Commander View Shortcuts

| Shortcut | Action | Context |
|----------|--------|---------|
| **Tab** | Next Tab | Switch area tabs |
| **Shift+Tab** | Previous Tab | Switch areas backward |
| **Alt+O** | Expand/Collapse | Toggle agent expansion |
| **Alt+N** | New Agent | Open spawn form |
| **Escape** | Close Commander | Exit Commander View |

## Shortcut Modifier Keys

### On Windows/Linux
- **Ctrl** = Control key
- **Alt** = Alt key
- **Shift** = Shift key

### On macOS
- **Cmd** = Command key (⌘)
- **Alt** = Option key (⌥)
- **Shift** = Shift key (⇧)

**Note:** Ctrl shortcuts on Windows are automatically converted to Cmd on macOS

## Conflict Detection

The application automatically detects shortcut conflicts:

1. **Warnings:** Console logs conflicting shortcuts
2. **Resolution:** Earlier shortcuts take precedence
3. **Customization:** Disabled shortcuts don't trigger conflicts

## Customizing Shortcuts

### Via Settings

```
1. Open Commander (Tab)
2. Navigate to Settings
3. Find "Keyboard Shortcuts"
4. Click shortcut to edit
5. Press new key combination
6. Save (auto-saves)
```

### Programmatically

```tsx
// Add custom shortcut
store.addShortcut({
  id: 'my-custom-action',
  name: 'My Action',
  description: 'Does something',
  key: 'a',
  modifiers: { alt: true, shift: true },
  enabled: true,
  context: 'global'
});
```

## Best Practices

### Ergonomic Shortcuts

- ✅ Use Alt+letter for easy access
- ✅ Use Vim-style (HJKL) for navigation
- ✅ Keep related shortcuts near each other
- ✅ Avoid multiple modifier keys for frequent actions

### Avoid Conflicts

- ✅ Check existing shortcuts before adding
- ✅ Use Alt+letter (not Ctrl+letter) for new features
- ✅ Reserve Ctrl for standard edit shortcuts (C/V/X)
- ✅ Document all new shortcuts

### Accessibility

- ✅ Provide mouse alternatives for all actions
- ✅ Show shortcut hints in UI (tooltips)
- ✅ Allow disabling shortcuts if needed
- ✅ Test with keyboard-only users

## Common Workflows

### Fast Mode Switching

```
Goal: Check dashboard metrics quickly

1. Alt+3     → Open dashboard
2. View metrics and status
3. Alt+2     → Back to 3D mode
4. Continue work

Total time: <5 seconds
```

### Agent Focus & Control

```
Goal: Focus on specific agent

1. Ctrl+2      → Select agent 2
2. Tab         → Open Commander
3. Alt+H       → Navigate to agent details
4. Space       → Interact with element
5. Escape      → Close Commander

```

### Terminal Workflow

```
Goal: Monitor agent in terminal

1. Ctrl+3      → Select agent 3
2. Space       → Open terminal
3. Alt+J/K     → Navigate messages
4. Alt+D/U     → Jump messages
5. Escape      → Close terminal
```

### Maximize Canvas

```
Goal: Get maximum screen space

1. Alt+S       → Hide sidebar
2. Alt+R       → Hide right panel
3. Alt+P       → Close any modals
4. Canvas now spans full window

Press Alt+S or Alt+R to restore panels
```

## Troubleshooting

### Shortcut Not Working

**Possible causes:**
1. Shortcut is disabled in settings
2. Input field has focus (blocks most shortcuts)
3. Browser/OS intercepted shortcut
4. Shortcut conflicts with existing binding

**Solutions:**
```
1. Check Settings → Keyboard Shortcuts
2. Verify shortcut is enabled
3. Try different key combo
4. Check browser extensions
5. Restart application
```

### Shortcut Conflicts

**Finding conflicts:**
```
1. Open DevTools → Console
2. Look for shortcut conflict warnings
3. Check which shortcuts share keys
4. Modify one in settings
```

**Example conflict log:**
```
⚠️  Shortcut conflict detected:
- Alt+P (Toggle Spotlight)
- Alt+P (Custom Action)
Choose Tools → Settings to resolve
```

## Performance Tips

### Keyboard Input Performance

- ✅ Shortcuts use capture phase for responsiveness
- ✅ Handlers are memoized to prevent jank
- ✅ Mode switches are <100ms on modern hardware
- ✅ No delay between key press and action

### Input Field Behavior

When an input (text field, search box) has focus:
- ❌ Global shortcuts are disabled (except Escape)
- ❌ Canvas shortcuts won't work
- ✅ Text editing shortcuts work normally

**Workaround:** Press Escape to blur input and enable global shortcuts

## Advanced: Event Binding Details

### Event Capture vs Bubble

The keyboard shortcut system uses **capture phase**:

```tsx
document.addEventListener('keydown', handler, true); // capture phase
```

**Why capture phase?**
- Works even if another element has focus
- Triggers before bubbling handlers
- Ensures canvas shortcuts always work

### Modifier Key Detection

```tsx
// How modifiers are detected
const ctrlMatch = ctrl
  ? (event.ctrlKey || event.metaKey)  // Ctrl or Cmd
  : (!event.ctrlKey && !event.metaKey);

const altMatch = alt ? event.altKey : !event.altKey;
const shiftMatch = shift ? event.shiftKey : !event.shiftKey;
```

### Special Cases

Some shortcuts have special handling:

```tsx
// Alt+P falls back if not customized
if (matchesShortcut(e, spotlightShortcut) ||
    (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyP')) {
  spotlightModal.toggle();
}
```

## Testing Shortcuts

### Manual Testing Checklist

- [ ] Alt+1 switches to 2D mode
- [ ] Alt+2 switches to 3D mode
- [ ] Alt+3 switches to Dashboard
- [ ] Alt+S toggles sidebar
- [ ] Alt+R toggles right panel
- [ ] Ctrl+1-9 select agents
- [ ] Tab/Ctrl+K opens Commander
- [ ] Escape closes everything
- [ ] No conflicts with browser shortcuts
- [ ] Works on Windows, Mac, Linux

### Automated Testing

```tsx
describe('Keyboard Shortcuts', () => {
  test('Alt+1 switches to 2D mode', () => {
    const event = new KeyboardEvent('keydown', {
      key: '1',
      altKey: true,
      code: 'Digit1'
    });
    document.dispatchEvent(event);
    expect(store.getState().viewMode).toBe('2d');
  });

  test('Alt+S toggles sidebar', () => {
    const event = new KeyboardEvent('keydown', {
      key: 's',
      altKey: true,
      code: 'KeyS'
    });
    document.dispatchEvent(event);
    // Sidebar toggle handler should be called
  });
});
```

## Accessibility

### Screen Reader Compatible

All shortcuts are logged to console for debugging:

```
KeyboardShortcuts: Alt+1 triggered (view-mode-2d)
KeyboardShortcuts: Alt+S triggered (toggle-sidebar)
```

### Keyboard-Only Navigation

Full support for keyboard-only users:
- ✅ All actions available via keyboard
- ✅ Focus visible states
- ✅ Tab order logical
- ✅ Skip links implemented

### Mobile Considerations

- 📱 Most desktop shortcuts work on mobile when keyboard attached
- 📱 Mobile keyboard apps send proper key events
- 📱 Touch gestures are separate from keyboard shortcuts
- 📱 No conflicts between touch and keyboard

## References

### Related Documentation
- [Performance Guide](./PERFORMANCE_GUIDE.md) - Mode switching performance
- [DashboardView README](./DashboardView/README.md) - Dashboard features
- [SidebarTreeView README](./SidebarTreeView/README.md) - Sidebar features

### External Resources
- [MDN: KeyboardEvent](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent)
- [Vim Cheat Sheet](https://vim.rtorr.com/) - Vim-style navigation reference
- [WCAG Keyboard Accessibility](https://www.w3.org/WAI/WCAG21/Understanding/keyboard) - Accessibility standards

