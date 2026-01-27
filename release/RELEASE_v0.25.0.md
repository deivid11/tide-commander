# Tide Commander v0.25.0 Release

**Released:** January 27, 2026

## Summary
Major feature release adding comprehensive terminal message navigation with keyboard shortcuts and improved terminal activation. Users can now navigate through terminal messages with smooth scrolling and interact with elements using the keyboard.

## Key Features

### Message Navigation
- **Alt+K** - Previous message (up)
- **Alt+J** - Next message (down)
- **Alt+U** - Page up (10 messages)
- **Alt+D** - Page down (10 messages)
- **Space** - Activate selected message (click links, buttons, etc.)
- **Escape** - Clear selection and exit navigation mode

### Agent Navigation & Terminal Control
- **Alt+H** - Previous agent (when terminal closed)
- **Alt+L** - Next agent (when terminal closed)
- **Space Bar** - Open terminal (auto-selects last active agent if needed)

### Improvements
- Smooth animated scrolling with easing
- Selected messages auto-scroll into viewport
- Message highlighting and visual feedback
- Better terminal input state management
- Enhanced terminal output styling with improved colors
- Keyboard shortcut integration with input field awareness

## Files

- `tide-commander-v0.25.0.apk` - Android APK build (4.3 MB)
- `tide-commander-v0.24.1.apk` - Previous release (kept for reference)
- `CHANGELOG.md` - Full changelog history
- `RELEASE_NOTES.md` - Previous release notes

## Installation

Extract and install the APK on Android devices:
```bash
adb install tide-commander-v0.25.0.apk
```

## Build Information

- Version: 0.25.0
- Build Date: 2026-01-27
- Build Type: Release
- Commits: 25 files changed, 1443 insertions(+)
- Git Tag: v0.25.0

## Technical Highlights

- New `useMessageNavigation` hook for message selection and scrolling
- Enhanced InputHandler with Space and Alt+H/L keyboard support
- Agent ordering utility in InputHandler matching UI components
- OutputLine component with data-message-index for navigation
- Store enhancements for lastSelectedAgentId tracking
- Improved terminal activation logic with auto-selection
