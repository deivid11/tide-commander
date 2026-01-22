# Changelog

All notable changes to this project will be documented in this file.

## [0.7.1] - 2026-01-22

### Added
- **Agent Notification System** - Agents can now send toast notifications to users
  - New `AgentNotificationToast` component with styled popups
  - REST API endpoint `/api/notify` for agents to send notifications via HTTP
  - WebSocket support for real-time notification delivery
  - Click notification to focus the sending agent
  - Auto-dismiss after 8 seconds with manual close option
- New `send-notification.md` skill for agents to send notifications

### Changed
- Moved version display from fixed position to agent bar (cleaner UI)
- Added `AgentNotification` types to shared types
- Enhanced WebSocket handler with notification broadcast support

## [0.7.0] - 2026-01-22

### Added
- Version display component showing app version in UI
- Agent cloning functionality (duplicate agents with same config)
- Enhanced CharacterFactory with sprite caching and preloading
- Vite environment variable support for version injection

### Changed
- Improved SceneManager with better character management
- Enhanced AgentEditModal styling
- Updated agent-handler with clone support
- Improved command-handler with better error handling

## [0.6.5] - 2026-01-22

### Added
- Live skill injection for running agents (skills are injected on next command without restart)
- Pending skill update tracking in skill-service
- Skill update notification builder for seamless skill additions

### Changed
- Command handler now injects skill updates when skills are assigned to running agents

## [0.6.4] - 2026-01-22

### Changed
- Boss agents can now use tools directly while preferring delegation to subordinates
- Updated trackpad gesture handler comments to be browser-agnostic (not Safari-specific)
- Updated controls modal text to be platform-agnostic (removed Mac-specific wording)

## [0.6.3] - 2026-01-22

### Removed
- Removed unused components (ActivityFeed, BottomToolbar, CommandInput, KeyboardShortcutsModal, MouseControlsModal, Spotlight)
- Removed unused useFormState hook
- Removed legacy process output file helpers from data module

## [0.6.2] - 2026-01-22

### Added
- Server logs skill for debugging
- Enhanced debug logging system with structured log entries
- Log streaming via WebSocket for real-time debugging

### Changed
- Improved ClaudeOutputPanel with history line enhancements
- Enhanced output filtering with additional output types
- Updated guake terminal styling with expanded features
- Improved session-loader with better error handling
- Enhanced backend event parsing

### Fixed
- Various TypeScript type improvements

## [0.6.1] - 2026-01-21

### Changed
- Refactored agent edit modal with improved styling and layout
- Converted class selection to compact chip buttons
- Improved form field organization with responsive rows
- Enhanced skills section with compact chip display
- Migrated inline styles to SCSS classes for better maintainability

### Fixed
- TypeScript errors in AgentDebugPanel and backend
- Fixed parseEvent return type to match interface
- Added type assertion for log.data in debug panel

## [0.6.0] - 2026-01-21

### Changed
- Redesigned BossSpawnModal with improved layout and UX
- Revamped SpawnModal with streamlined interface
- Enhanced modal styling with better visual hierarchy
- Updated boss spawn styling with improved form layout
- Refined forms styling for better consistency
- Minor guake terminal styling adjustments

## [0.5.1] - 2026-01-21

### Changed
- Refactored ControlsModal with simplified configuration
- Streamlined TrackpadGestureHandler for better performance
- Cleaned up InputHandler event handling
- Simplified mouse controls store

## [0.5.0] - 2026-01-21

### Added
- `TrackpadGestureHandler` for trackpad gesture support (pinch-to-zoom, two-finger pan)
- Enhanced controls modal with trackpad gesture settings
- Additional mouse control bindings and customization options

### Changed
- Improved CameraController with better zoom and pan handling
- Enhanced InputHandler with trackpad gesture integration
- Expanded MouseControlHandler with more action types
- Updated store with trackpad sensitivity settings
- Refined shortcuts modal styling with better organization

## [0.4.0] - 2026-01-21

### Added
- Mouse controls modal component for configuring mouse interactions
- Controls modal component for unified settings management
- `MouseControlHandler` for advanced mouse input handling
- Mouse controls store with configurable bindings
- Customizable keyboard shortcuts modal with improved layout
- Enhanced guake terminal styling with better visual hierarchy

### Changed
- Refactored App component with improved modal management
- Enhanced ClaudeOutputPanel with better layout and functionality
- Improved InputHandler with extended mouse event support
- Updated store with mouse controls state management
- Refined file explorer styling with better spacing
- Overhauled shortcuts modal with categorized sections
- Improved toolbox styling

## [0.3.0] - 2026-01-21

### Added
- File tabs component for multi-file editing support
- Content search results component with file content searching
- Unified search results combining file tree and content search
- `useFileExplorerStorage` hook for persisting explorer state
- Server-side file content search API endpoint (`/api/files/search`)
- Enhanced syntax highlighting with more language support
- File viewer image preview and binary file detection
- Line numbers in file viewer
- Copy file path functionality

### Changed
- Completely revamped file explorer UI with tabs and search integration
- Enhanced file content hook with caching and better error handling
- Improved file tree with search filtering and better performance
- Updated TreeNodeItem with refined styling and interactions
- Expanded syntax highlighting constants for more file types
- Improved guake terminal styling

## [0.2.0] - 2026-01-21

### Added
- Context menu component with right-click support for scene interactions
- `useContextMenu` hook for managing context menu state
- Direct folder path access in file explorer via `useExplorerFolderPath` store hook
- Enhanced file tree with expand/collapse all, refresh, and home navigation
- Bottom toolbar styling component
- Agent bar scroll buttons for horizontal navigation
- Building config modal backdrop blur styling
- New input handler interaction types (`rightClick`, `areaRightClick`)
- Scene manager `getWorldPositionFromScreen` method for coordinate conversion

### Changed
- File explorer panel now supports opening directly to a folder path
- Improved file tree hook with better state management and navigation
- Updated App component to integrate context menu and folder path features
- Enhanced input handler with right-click detection and modifier key support
- Refactored spawn modal and boss spawn modal prop types

### Removed
- Removed `openAreaExplorer` from toolbox (moved to context menu)

## [0.1.0] - Initial Release

- Initial release of Tide Commander
- RTS/MOBA-style interface for Claude Code agents
- Real-time agent visualization and management
- WebSocket-based communication
- File explorer integration
- Skills panel for agent configuration
