# Tide Commander v0.27.0 Release

**Released:** January 27, 2026

## Summary
Major release featuring a complete secrets management system for secure handling of sensitive data, plus improved keyboard navigation with vim-style scrolling in the file viewer. Agents can now reference secrets in prompts using `{{KEY}}` placeholder syntax.

## Key Features

### Secrets Management System
- **Toolbox Secrets Panel** - Full UI for managing secrets
  - Add, edit, delete secrets with name, key, value, description
  - Click to copy `{{KEY}}` placeholder syntax
  - Collapsible section with storage persistence
  - Server-side persistence with real-time sync

### Secret References
- **Placeholder Syntax** - Use `{{SECRET_KEY}}` in prompts
- **Security** - Secrets stored server-side, not exposed to client
- **Easy Integration** - Click to copy placeholder code
- **Dynamic Injection** - Secrets injected at runtime

### File Viewer Enhancements
- **Vim-style Navigation**
  - Press `j` to scroll down 100px
  - Press `k` to scroll up 100px
  - Works with diff view (both panels)
- **Improved Keyboard**
  - Escape to close modal
  - Focus management for keyboard capture
  - Event propagation control
  - No interference with message navigation

### Message Navigation Integration
- **Input Ref Tracking** - Seamless typing mode
- **Auto-focus on Type** - Start typing to focus input
- **Smart Input Detection** - Works with input and textarea
- **Preserve State** - Navigation state cleared when typing

## Technical Implementation

### New Components
- `SecretsSection` - React component for UI
- `secrets.ts` - Client-side store
- `secrets-service.ts` - Server persistence
- `secrets-handler.ts` - WebSocket communication

### Infrastructure
- Secret interface with id, name, key, value, description
- Client store with selectors and array hooks
- Server data module with JSON persistence
- WebSocket routes for create/read/update/delete
- Real-time client-server synchronization

### Keyboard Events
- Global event listener with capture phase
- Smart event propagation control
- Input field detection and focus management
- Vim-style scrolling with smooth animation

## Files

- `tide-commander-v0.27.0.apk` - Android APK build (4.3 MB)
- `tide-commander-v0.26.0.apk` - Previous release
- `CHANGELOG.md` - Full changelog history
- `RELEASE_v0.26.0.md` - Previous release notes

## Installation

Extract and install the APK on Android devices:
```bash
adb install tide-commander-v0.27.0.apk
```

## Usage

### Managing Secrets
1. Open Toolbox
2. Expand "Secrets" section
3. Click "Add Secret"
4. Enter name, key, value, description
5. Save and use in prompts

### Using Secrets in Prompts
```
Use this API key: {{API_KEY}}
Database password: {{DB_PASSWORD}}
```

### File Viewer Navigation
- Press `j` - Scroll down
- Press `k` - Scroll up
- Press `Escape` - Close file viewer

## Build Information

- Version: 0.27.0
- Build Date: 2026-01-27
- Build Type: Release
- Commits: 24 files changed, 1575 insertions(+)
- Git Tag: v0.27.0
- Modules Added: secrets.ts, secrets-service.ts, secrets-handler.ts

## Security Notes

- Secrets stored on server, not in browser
- Client never logs secret values
- WebSocket communication for updates
- Secrets injected at runtime into agent prompts
- No secrets in localStorage or URL params

## Performance

- Efficient WebSocket updates
- Real-time synchronization
- Client-side caching with selectors
- Smooth scrolling with 60fps animation
