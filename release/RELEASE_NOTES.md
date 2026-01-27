# Tide Commander v0.24.1 Release

**Released:** January 27, 2026

## Summary
Patch release fixing agent order synchronization between SwipeNavigation and AgentBar components to ensure consistent navigation experience.

## Changes

### Fixed
- **Agent Order Synchronization** - Fixed inconsistent agent ordering between SwipeNavigation and AgentBar
  - Both components now use unified `useAgentOrder` hook for consistent navigation order
  - Added custom event broadcasting for order changes across component instances
  - Improved agent grouping while preserving custom order within area groups

- **SwipeNavigation Hook Refactor** - Simplified and improved agent ordering logic
  - Removed dependency on `useAreas` hook
  - Use base agent list sorted by creation time as foundation
  - Apply custom ordering from `useAgentOrder` for consistent navigation

## Files

- `tide-commander-v0.24.1.apk` - Android APK build (4.3 MB)
- `CHANGELOG.md` - Full changelog history
- `RELEASE_NOTES.md` - This file

## Installation

Extract and install the APK on Android devices:
```bash
adb install tide-commander-v0.24.1.apk
```

## Build Information

- Version: 0.24.1
- Build Date: 2026-01-27
- Build Type: Release
- Commits: 1 change
- Git Tag: v0.24.1
