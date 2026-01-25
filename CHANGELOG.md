# Changelog

All notable changes to this project will be documented in this file.

## [0.13.0] - 2026-01-25

### Added
- **Power Saving Toggle** - New setting in Toolbox config to enable/disable idle throttling
  - Disabled by default to preserve current behavior
  - Prevents idle mode when any agent is actively working
- **WebGL Context Loss Handling** - Graceful recovery from GPU context loss
  - Stop animation loop on context loss
  - Automatically restart on context restore
- **Compact Toggle Switches** - Prettier toggle UI for boolean settings
  - Replace checkbox inputs with styled toggle switches
  - Smooth transitions and hover states

### Changed
- **Cached Boss-Subordinate Connections** - Only rebuild line mapping on selection change
  - Skip line updates when no agents are moving
- **Optimized Animation Mixer Updates** - Only update mixers for agents with active animations
  - Track animating agents in a Set for O(1) lookups
- **Delta Time Capping** - Cap frame delta at 100ms to prevent animation jumps after throttling
- **Controls Update During Skip** - Update OrbitControls even when skipping render frames
  - Maintains smooth damping during FPS limiting

### Fixed
- **Procedural Bodies Cache Invalidation** - Properly invalidate cache when agents added/removed

### Technical
- `setPowerSaving(enabled: boolean)` public method on SceneManager
- `hasWorkingAgents()` private method to check agent status
- `powerSaving` setting in store with default `false`
- `stopAnimation(agentId)` method on MovementAnimator
- Cached `proceduralBodiesCache` with dirty flag pattern

## [0.12.0] - 2026-01-25

### Added
- **Idle Detection & Power Saving** - Automatic FPS throttling when scene is inactive
  - Throttle to 10 FPS after 2 seconds of inactivity
  - Wake on user interaction (mouse, wheel, keyboard)
  - Wake automatically when agents are moving
- **Line Object Pooling** - Reuse boss-subordinate connection lines
  - No more geometry allocation/disposal on selection change
  - Update positions in-place via BufferAttribute

### Changed
- **Hash-based Change Detection** - Replace JSON.stringify with efficient hashing
  - Agent change detection uses position/status hash codes
  - Area and building sync uses size + hash comparison
  - Dramatically reduces GC pressure from string allocations
- **Throttled Hover Detection** - Reduce raycasting frequency to 20Hz
- **Batched Indicator Scale Updates** - Only recalculate when camera moves or every 100ms
  - Avoids per-agent per-frame store access

### Technical
- `MovementAnimator.hasActiveMovements()` method for idle detection
- `InputHandler.onActivity` callback for user interaction tracking
- `SceneManager.markActivity()` public method for external activity signals

## [0.11.0] - 2026-01-24

### Added
- **DOM Stats Tab** - New tab in Performance Monitor for DOM diagnostics
  - Node count, canvas count, image count, video count tracking
  - Color-coded thresholds (green/yellow/red) for node counts
- **Texture Memory Estimation** - Approximate GPU/VRAM usage tracking
  - Texture count from Three.js renderer
  - Estimated VRAM in megabytes
- **Memory Breakdown Panel** - Unified view of memory sources
  - JS Heap, GPU/Textures, and DOM memory estimates
  - Estimated total memory usage
  - Displayed in both Memory and DOM tabs

### Changed
- Performance Monitor tabs renamed: "Three.js" → "3D" for brevity
- Copy Stats now includes DOM and estimated memory data

### Technical
- Use refs for memoryHistory and threeJsStats to avoid interval recreation
- Reduced useEffect dependency array to prevent unnecessary re-renders

## [0.10.2] - 2026-01-24

### Fixed
- **Unmount State Update Prevention** - Prevent React state updates after component unmount
  - Added mount state ref tracking in ClaudeOutputPanel
  - Guard all async state updates in history loading with mount check
- **Agent Output Memory Leak** - Clean up agentOutputs map when removing agents
  - Prevents orphaned output data from accumulating in store

## [0.10.1] - 2026-01-24

### Fixed
- **Completion Indicator Timer Leak** - Fixed memory leak in ClaudeOutputPanel
  - Proper timer cleanup when agent status changes
  - Clear existing timer before creating new one
  - Cancel completion state immediately when agent starts working again
  - Cleanup timer on component unmount

## [0.10.0] - 2026-01-24

### Added
- **Agent Response Modal** - View Claude responses as formatted markdown in a modal
  - Click the 📄 button on any Claude message to open the modal
  - Full markdown rendering with syntax highlighting
  - Keyboard shortcut (Escape) to close
- **Performance Monitor** - Enhanced FPS meter with memory and Three.js diagnostics
  - Memory usage tracking with heap size and limit
  - Three.js resource counts (geometries, textures, programs)
  - Memory history graph for detecting leaks
  - Growth rate indicator
  - Tabbed interface: FPS / Memory / Three.js
- **Landing Page Scaffold** - New landing page directory structure
  - `dev:landing` script for developing the landing page

### Fixed
- **Memory Leak Prevention** - Comprehensive WebGL context cleanup
  - Proper disposal on page unload (beforeunload, unload, pagehide events)
  - bfcache detection and forced cleanup on restore
  - StrictMode compatibility (no duplicate scene creation on remount)
  - Session storage tracking for detecting unclean shutdowns
  - Canvas removal and WebGL context loss on cleanup
  - WebSocket disconnect and callback cleanup before scene disposal
- **Selection Visual Performance** - Reduced geometry churn from boss-subordinate lines
  - Only refresh visuals when selection or agent positions actually change
  - Prevents massive geometry recreation on every store update

### Changed
- API calls now use `apiUrl()` helper for proper base URL handling
  - History fetch, file upload, search all use dynamic base URL
  - Custom model URLs use `apiUrl()` for correct paths
  - Image URLs properly prefixed with API base URL
- FPSMeter renamed to Performance Monitor internally
- Scene manager exposed on `window.__tideScene` in dev mode for debugging

### Technical
- New `AgentResponseModal` component for markdown viewing
- New `disconnect()` and `clearCallbacks()` exports from websocket module
- `cleanupScene()` function centralizes all disposal logic
- `WEBGL_SESSION_KEY` for tracking active WebGL contexts across sessions
- `getApiBaseUrl()` utility for dynamic API base URL
- `apiUrl()` helper for constructing full API URLs

## [0.9.0] - 2026-01-23

### Added
- **Custom 3D Model Support** - Upload custom `.glb` models for agent classes
  - GLB file upload with validation and animation parsing
  - Automatic animation detection and mapping (idle, walk, working)
  - Custom animation mapping UI for mapping model animations to agent states
  - Model scale and position offset controls for fine-tuning placement
  - Live 3D preview with drag-to-rotate interaction
  - Server-side model storage and streaming API (`/api/custom-models`)
- **Procedural Animation System** - Models without animations get procedural idle effects
  - Gentle bobbing and swaying for static models
  - Automatic fallback when no animations detected
- **Enhanced Model Preview** - Interactive 3D preview in class editor
  - Drag-to-rotate functionality (click and drag to rotate model)
  - Support for custom model files, URLs, and built-in models
  - Procedural animation for models without built-in animations
- **GLB Parser Utility** - Client-side GLB parsing for animation extraction
  - Validates GLB magic bytes and structure
  - Extracts animation names without full model load
  - File size formatting helper

### Changed
- SkillsPanel now supports custom model upload with full configuration UI
- ModelPreview component accepts custom model files and URLs
- CharacterFactory and CharacterLoader support custom models from server
- SceneManager integrates ProceduralAnimator for animation-less models
- Custom classes can now have per-class animation mappings
- MovementAnimator supports custom walk animations per agent class

### Technical
- New `ProceduralAnimator` class for procedural animation state management
- New `glbParser.ts` utility for client-side GLB file parsing
- New `/api/custom-models` routes for model upload, retrieval, and deletion
- Extended `CustomAgentClass` type with model customization fields
- Added `AnimationMapping` type for per-class animation configuration

## [0.8.2] - 2026-01-22

> ⚠️ **EXPERIMENTAL RELEASE** - This version includes new features that require testing:
> - The stdin watchdog auto-respawn feature may cause unexpected behavior in some edge cases
> - History loading may occasionally fail when switching to an agent - refresh if this occurs

### Added
- **Stdin Activity Watchdog** (EXPERIMENTAL) - Detects stuck processes and auto-respawns them
  - 10 second timeout after sending stdin message
  - If no activity received, process is killed and respawned with same command
  - Activity callbacks system in ClaudeRunner to track process responsiveness

### Fixed
- History loading flicker when sending command to idle agent (session establishment)
- "No output yet" message showing briefly while agent is working
- Track session establishment separately from agent switches to avoid unnecessary loading states

### Changed
- ClaudeOutputPanel now tracks both agentId and sessionId changes separately
- Added `lastActivityTime` tracking to ActiveProcess for watchdog feature

## [0.8.1] - 2026-01-22

### Added
- Terminal resizing state in store to coordinate with battlefield interactions
- Visibility change listener to cancel drag states when document becomes hidden
- `useTerminalResizing` selector for components needing resize state

### Fixed
- Selection box appearing when dragging external windows (like Guake) over canvas
- Drag selection not canceling when window loses focus or visibility
- Selection box persisting during terminal resize operations

### Changed
- InputHandler now tracks if pointer down originated on canvas to prevent false drag events
- Added `cancelAllDragStates()` method to centralize cleanup of all drag/selection states

## [0.8.0] - 2026-01-22

### Added
- **Skill Hot-Reload** - When a skill's content is updated, all agents using that skill are automatically hot-restarted with preserved context
- Window blur event handler to clear hover state when switching apps (e.g., to Guake terminal)

### Changed
- Agent skill changes now trigger hot-restart to apply new skills in system prompt
- Refactored hover state clearing into reusable `clearHoverState()` method
- Skills are now properly applied on agent restart via `--resume` flag

### Fixed
- Hover tooltip persists when switching to another application window

## [0.7.3] - 2026-01-22

### Changed
- Improved version indicator visibility in agent bar (better contrast with rgba colors)

## [0.7.2] - 2026-01-22

### Fixed
- Fixed tooltip on hover agent appearing too fast (increased delay from 200ms to 400ms)
- Fixed hover state persisting when mouse leaves canvas (added pointerleave handler)

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
