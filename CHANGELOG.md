# Changelog

All notable changes to this project will be documented in this file.

## [0.36.0] - 2026-01-29

### Added
- **Keyboard Shortcuts System** - New keyboard event handling for agent navigation and terminal control
  - Alt+H / Alt+L keyboard shortcuts for agent navigation (previous/next agent)
  - Space bar to open terminal with smart context detection
  - Proper input field detection to prevent shortcuts from triggering in text inputs
  - Exception handling for Alt+H/L in collapsed terminal input
- **Enhanced Terminal Integration** - Keyboard-driven terminal activation
  - Auto-select last active agent when opening terminal with Space
  - Terminal open/close state management via keyboard
  - Backtick or Escape to close terminal (as before)

### Changed
- **Voice Assistant API Calls** - Switched from fetch to authFetch for authenticated requests
  - Voice assistant, STT (Speech-To-Text), and TTS (Text-To-Speech) hooks now use authFetch
  - Ensures proper authentication headers for API endpoints
  - Better security for voice-based operations
- **Scene2DInput Refactoring** - Extended keyboard event handling
  - Added keyboard event listener setup and cleanup
  - Proper document-level keydown event handling
  - Feature flag for double-click camera focus (disabled by default)

### Technical
- New `onKeyDown` event handler in Scene2DInput for keyboard events
- New `getOrderedAgents()` utility method for consistent agent ordering
- Replaced fetch calls with authFetch in useSTT, useTTS, and VoiceAssistant
- Feature flag: `ENABLE_DOUBLE_CLICK_CAMERA_FOCUS` for camera zoom/pan on double-click
- Proper event listener cleanup in Scene2DInput.destroy()

## [0.35.1] - 2026-01-29

### Changed
- **Sidebar Layout** - Improved fixed positioning system
  - Changed sidebar from relative to fixed positioning
  - Fixed z-index positioning for proper layering
  - Agent bar and bottom toolbar now extend to full width
  - Sidebar collapse animation now uses translateX instead of width change
  - Removed unnecessary width transition for better performance
- **App Layout** - Removed unnecessary resize event dispatch
  - Eliminated setTimeout on sidebar collapse that could cause layout jank

### Fixed
- **Sidebar Collapse Animation** - Improved visual smoothness
  - Changed from width-based to transform-based animation (GPU-accelerated)
  - Better performance and smoother visual transitions
  - Proper pointer-events handling during collapse
- **Layout Spacing** - Agent bar and toolbar now properly span full width when sidebar is collapsed

## [0.34.0] - 2026-01-29

### Added
- **Z-Index/Stacking Order Management** - Areas now support layering and z-order control
  - Z-index property for DrawingArea to control stacking order
  - Store actions for z-index management: `getNextZIndex()`, `bringAreaToFront()`, `sendAreaToBack()`, `setAreaZIndex()`
  - Z-order synchronization with server
  - Migration support for existing areas without z-index
- **Water Wave Ripple Effect** - Visual effect for working agents in 2D scene
  - Animated concentric wave rings expanding from agent position
  - Cyan to purple gradient color scheme
  - Fading opacity as waves expand
  - Multiple concurrent waves for continuous animation

### Changed
- **2D Scene Rendering** - Areas now sorted by z-index for proper layering
  - DrawingManager applies z-offset to prevent z-fighting in 3D rendering
  - Scene2D sorts areas by z-index before rendering
  - Z-offset calculations for all area components (fill, border, labels, handles)
- **DrawingArea Type** - Extended with z-index support
  - New `zIndex: number` field in DrawingArea interface
  - Automatic z-index assignment for new areas
- **Area Store** - Enhanced z-index management
  - Z-index migration for legacy areas
  - New z-index management methods
  - Server synchronization for z-order changes

### Technical
- Extended Scene2D and Scene2DRenderer with z-index sorting logic
- New z-index offset calculations in DrawingManager (0.001 per level)
- Water ripple wave effect implementation in Scene2DRenderer
- Area store z-index management methods and migrations

## [0.33.0] - 2026-01-29

### Added
- **CharacterFactory Major Refactoring** - Complete rewrite of character animation and visual system
  - Enhanced animation loading and management
  - Improved model caching and optimization
  - Better support for custom animations
  - Procedural animation fallbacks for static models
  - Extended character configuration options
- **UI Component Enhancements** - Comprehensive visual improvements
  - New `AboutSection` with improved styling and layout
  - New `ConfigSection` for expanded configuration options
  - Enhanced `AgentBar` with better styling and interactions
  - Improved popup components (AgentHoverPopup, action popups)
  - Better responsive design across components
- **Scene Initialization Improvements** - Enhanced hook system
  - Refactored `useSceneSetup` hook with improved initialization logic
  - Better scene lifecycle management
  - Enhanced synchronization mechanisms
  - Improved error handling and fallbacks
- **Visual Effects Expansion** - Extended EffectsManager capabilities
  - Additional visual effect types
  - Better effect layering and composition
  - Improved performance with effect pooling
- **Server Service Enhancements**
  - Extended authentication service capabilities
  - Improved skill service with better skill management
  - Enhanced command handler with better event routing

### Changed
- **Scene Architecture** - Major refactor of scene core and manager
  - Better state management and coordination
  - Improved agent manager with extended styling system
  - Enhanced selection manager with better visual feedback
  - Better scene lifecycle coordination
- **Agent Components** - Improved styling and interactions
  - BossBuildingActionPopup with better layout
  - BuildingActionPopup with improved styling
  - DatabaseBuildingActionPopup enhancements
  - FloatingActionButtons with better positioning
  - SkillEditorModal improvements
  - SpawnModal with better UX
  - ContextMenu refinements
- **Scene Synchronization** - Enhanced useSceneSync hook
  - Better synchronization logic
  - Improved state updates
  - Better error handling
- **Styling System** - SCSS improvements
  - AgentBar styling enhancements
  - AboutSection styling
  - ConfigSection styling
  - Better responsive breakpoints

### Technical
- Major CharacterFactory refactor (536+ lines added)
- Enhanced SceneSetup hook logic (133+ lines added)
- Extended EffectsManager with new capabilities (55+ lines)
- New ConfigSection component with styling
- Improved AboutSection with additional features
- Enhanced AgentBar styling (64+ lines)
- New toolbox styling sections (117+ lines)
- Extended store selectors and types
- Improved server authentication service (8+ lines)
- Enhanced skill-service with better management
- Better websocket command handler

### Fixed
- Improved scene initialization reliability
- Better error handling in character loading
- Enhanced animation fallback system
- Better state synchronization

## [0.32.0] - 2026-01-29

### Added
- **2D Scene Formation Movement** - Agents can now move in coordinated formations
  - Circle formation for small groups (1-6 agents)
  - Grid formation for larger groups
  - Configurable formation spacing (1.2 unit default)
  - Smooth multi-agent positioning with centralized target point
- **Building Drag-Move Support** - Buildings can now be moved in the 2D scene
  - Real-time visual updates during drag operations
  - Building position synchronization
  - Integrated with 2D scene input handler
- **Text Attachment Handling** - Enhanced Claude output panel
  - New `PastedTextChip` component for displaying text attachments
  - Improved attachment rendering and styling
- **Shared FolderInput Component** - New reusable folder/directory input component
  - File/folder selection interface
  - Integrated with BuildingConfigModal and other modals
  - Better UX for directory-based configuration

### Changed
- **2D Scene Input Handler** - Extended with drag support for buildings
  - New `onBuildingDragMove` callback for building drag operations
  - Better event delegation for building interactions
  - Improved input handling for 2D scene objects
- **Scene2D Rendering** - Enhanced visual system
  - Improved building rendering with drag indicators
  - Better entity positioning and updates
  - Optimized renderer performance
- **ClaudeOutputPanel** - Improved input area
  - Better text input handling
  - Enhanced attachment chip styling
  - Improved terminal header organization
- **Server File Routes** - Expanded capabilities
  - New file upload endpoints
  - Enhanced file serving capabilities
  - Better error handling
- **WebSocket Handler** - Extended event routing
  - New handlers for building drag operations
  - Improved event propagation
  - Better client-server synchronization

### Technical
- New `PastedTextChip.tsx` component for attachment rendering
- New `FolderInput.tsx` shared component for directory selection
- Enhanced `Scene2D.ts` with building drag state management
- Extended `Scene2DInput.ts` with drag event handling
- Updated `Scene2DRenderer.ts` with drag visualization
- New file routes in `src/packages/server/routes/files.ts`
- Extended `claude-service.ts` with new capabilities
- Improved WebSocket handler with new event types
- Enhanced SCSS for attachment chips and input areas

## [0.31.0] - 2026-01-28

### Added
- **Database Building Action Popup** - New action popup for database building interactions
- **Database Service** - Backend service for database operations
- **Database WebSocket Handler** - Real-time database synchronization
- **Database Store** - Client-side state management for database features
- **Tooltip Component** - Reusable tooltip component for UI hints
- **Modal Close Hook** - useModalClose hook for improved modal management

### Changed
- **Modal System** - Enhanced modal styling and interactions
  - Refined modal layout and spacing
  - Improved modal header and content organization
  - Better modal backdrop and overlay handling
- **Spotlight Search** - Additional refinements and improvements
  - Better search result presentation
  - Improved type definitions
- **Terminal Header** - Enhanced terminal control UI
  - Better button organization
  - Improved responsive layout
- **Scene Setup** - Improved initialization and synchronization
  - Better state management
  - Enhanced hook organization
- **Skill Editor** - UI and interaction improvements
- **Agent Edit Modal** - Enhanced styling and layout
- **Building Config Modal** - Layout refinements

### Technical
- New `DatabaseBuildingActionPopup` component
- New `database-service.ts` for server-side database operations
- New `database-handler.ts` for WebSocket communication
- New `Tooltip` component with styling
- New `useModalClose` hook for modal management
- New `database.ts` store module for state management
- Enhanced store selectors and types
- Improved modal styling with SCSS refinements
- Updated websocket handler with database routes

## [0.30.0] - 2026-01-27

### Added
- **IframeModal Component** - New modal component for embedding iframe content
  - Flexible iframe container for displaying external content
  - Modal styling and positioning
- **PM2 Logs Skill** - Built-in skill for monitoring PM2 process logs
  - Server-side skill definition for process log streaming
  - Integration with PM2 service for process monitoring

### Changed
- **Spotlight Search** - Enhanced search functionality and utilities
  - Improved search algorithm and matching
  - Better result filtering and ranking
- **UI Components** - Multiple component refinements
  - BuildingActionPopup interactions
  - BossBuildingActionPopup enhancements
  - PM2LogsModal and BossLogsModal styling
  - AppModals integration improvements
- **Building Configuration** - Layout and styling updates
  - Refined building config SCSS
  - Improved layout components

### Technical
- New `IframeModal.tsx` component and styling
- New `pm2-logs.ts` skill definition
- Enhanced Spotlight search utilities
- Updated builtin skills index with PM2 logs skill
- Refined component interactions and styling

## [0.29.0] - 2026-01-27

### Added
- **Building Interactions System** - Interactive building management in scene
  - BuildingActionPopup component for context-aware building actions
  - BossBuildingActionPopup for boss-specific building interactions
  - Building configuration modal with advanced settings
  - Building state management in Redux store with selectors
- **Building WebSocket Handler** - Real-time synchronization of building operations
  - Building action execution via WebSocket
  - Building state updates and synchronization
  - Integration with client and server building services
- **PM2 Process Monitoring** - Monitor and view application processes
  - PM2LogsModal component for viewing process logs
  - BossLogsModal for boss-specific logs
  - PM2Service for process management
  - ANSI to HTML conversion for log rendering
- **Building Configuration Routes** - Server-side API for building management
  - Configuration endpoint for building settings
  - Building service enhancements
- **Bitbucket PR Skill** - Integration with Bitbucket pull request workflow
  - bitbucket-pr skill definition for agents
- **Enhanced Scene Interactions**
  - Building styles system with command center style
  - Improved InputEventHandlers for building interactions
  - CharacterLoader enhancements for character positioning

### Changed
- **Building Manager** - Extended with building action handling
  - New action execution methods
  - Building state tracking
  - Label utilities for building labels
- **Toolbox Component** - Enhanced with building config options
  - New building configuration section
  - Expanded styling options
  - Better component organization
- **Store Architecture** - Building state management
  - New buildings reducer
  - Building selectors and hooks
  - Building-related type definitions
- **WebSocket Handler** - Extended with building operations
  - Building event handlers
  - Building state synchronization
  - Building action routing
- **Scene Setup Hook** - Enhanced with building initialization
  - Better building lifecycle management
  - Improved scene synchronization

### Technical
- New `BuildingActionPopup` component for building interactions
- New `BossBuildingActionPopup` component for boss buildings
- New `PM2LogsModal` and `BossLogsModal` components
- New `ansiToHtml.ts` utility for log formatting
- New `bitbucket-pr.ts` skill definition
- New `config.ts` routes for building configuration
- New `pm2-service.ts` for process management
- Extended BuildingManager with interaction methods
- New building styles (commandCenter)
- Building store module with selectors
- Enhanced WebSocket building handler
- Improved scene synchronization

## [0.28.0] - 2026-01-27

### Added
- **Environment-based port configuration** - Backend and frontend ports can now be configured via a `.env` file using `PORT` and `VITE_PORT` variables
- **`.env.example`** - Documents all available environment variables (`PORT`, `VITE_PORT`, `LISTEN_ALL_INTERFACES`)
- **`dotenv` support** - Both the server and Vite config load `.env` automatically via `dotenv/config`

### Changed
- **WebSocket default port** - Client now uses the `PORT` env variable (injected at build time as `__SERVER_PORT__`) instead of hardcoded `5174` for backend discovery
- **Connection error message** - Toast notification now shows the actual configured port instead of hardcoded `5174`

## [0.27.1] - 2026-01-27

### Fixed
- **Custom model idle animation** - Agents with custom models no longer animate when idle animation is set to "None"; they freeze in their static pose instead of playing the first animation from the model file
- **Custom model walk animation** - Walking animation now correctly uses the custom animation mapping instead of hardcoded animation names that don't exist in custom models
- **Model preview in class editor** - Preview now respects the selected idle animation mapping; shows static pose when idle is set to "None"

### Changed
- **Z offset range** - Increased model position Z (height) offset range from ±1 to ±3 to accommodate models that sit below ground when static
- **setIdleAnimation/setWorkingAnimation** - Now route through `updateStatusAnimation` for consistent animation resolution across custom and built-in models

## [0.27.0] - 2026-01-27

### Added
- **Secrets Management System** - Store and inject sensitive data securely
  - `SecretsSection` component in Toolbox for managing secrets
  - Add, edit, delete secrets with name, key, value, description
  - Reference secrets in prompts using `{{KEY}}` placeholder syntax
  - Click to copy placeholder code for easy integration
  - Server-side secrets storage with WebSocket sync
- **Secrets Store & Service** - Backend infrastructure for secret management
  - Client-side secrets store with selectors and array hooks
  - `SecretsService` for server-side secret persistence
  - `SecretsHandler` for WebSocket communication
  - Type definitions for Secret interface
  - Real-time synchronization between client and server
- **File Viewer Modal Enhancements** - Improved keyboard navigation
  - Vim-style scrolling: j/k for up/down (100px per scroll)
  - Focus management for overlay keyboard capture
  - Escape key to close modal
  - Smooth scrolling animation support
  - Diff panel support with dual-panel scrolling
  - Event propagation control to avoid interference with message navigation

### Changed
- **Toolbox Component** - Added Secrets section
  - New collapsible "Secrets" section with storage persistence
  - `useSecretsArray()` hook for secrets list management
  - Form-based UI for adding/editing secrets
  - Improved section organization
- **FileViewerModal** - Keyboard event handling refactored
  - Global keyboard listener with capture phase
  - Better input field detection for text inputs
  - Event stopPropagation to prevent conflicts with other handlers
  - Focus management improvements
  - Ref-based scrolling container tracking
- **Message Navigation Hook** - Keyboard integration improvements
  - `inputRef` and `textareaRef` props for input focus management
  - `useTextarea` option for choosing input type
  - Auto-focus on input when typing during navigation
  - Smart input type detection for textarea vs input
  - Prevents character loss when switching to typing mode
- **App Component** - Secrets provider integration
  - Secrets state propagation through component tree
  - WebSocket handler updates for secrets sync

### Technical
- New `src/packages/client/store/secrets.ts` - Client secrets store
- New `src/packages/server/services/secrets-service.ts` - Server service
- New `src/packages/server/websocket/handlers/secrets-handler.ts` - Handler
- Extended WebSocket handler with secrets route
- Server data module updates for secret persistence
- Type definitions: `Secret`, `SecretsState` added to shared types
- Store selectors: `useSecrets()`, `useSecretsArray()`
- Improved keyboard event handling in FileViewerModal
- Message navigation hook enhancements for input handling

---

## [0.26.2] - 2026-01-27

### Fixed
- **Class editor modal overflow** - The "Create Agent Class" modal was taller than the screen with no scroll, making it impossible to use. Added max-height constraint and scrollable body.

---

## [0.26.1] - 2026-01-27

### Fixed
- **Skills and Controls floating buttons** - Fixed buttons that would blink but never open their panels. The useEffect that closes these modals when the terminal closes was re-triggering on modal state changes due to dependency array including modal objects, immediately closing them.

---

## [0.26.0] - 2026-01-27

### Added
- **Post-Processing Effects** - New PostProcessing system for scene effects
  - Color correction shader with saturation, contrast, and brightness controls
  - Composable effect rendering pipeline with Three.js
  - Foundation for advanced visual effects
- **Agent Model Styling System** - Advanced visual customization for agent models
  - Color mode options: Normal, B&W, Sepia, Cool, Warm, Neon
  - Saturation control (0-2 range: grayscale to vivid)
  - Material properties override: roughness, metalness, emissive boost
  - Wireframe rendering mode for debugging
  - Environment map intensity control
  - Per-material shader injection for color effects
  - Real-time shader uniforms for dynamic updates
- **Toolbox Model Style Panel** - New UI section for agent model styling
  - Color mode selector with emoji icons
  - Sliders for saturation, roughness, metalness, emissive boost, env map intensity
  - Wireframe toggle
  - CollapsibleSection integration for organized settings
- **Enhanced Terrain Configuration** - Additional visual controls
  - Sky color customization
  - Better integration with post-processing system

### Changed
- **AgentManager Refactoring** - Major expansion with styling system
  - New `setModelStyle()` and `getModelStyle()` methods
  - Unified `applyStyleToMesh()` method replacing individual style applications
  - Color shader injection into materials with dynamic uniforms
  - Support for 6 distinct color modes with shader code injection
  - Material property override system
- **Toolbox Component** - Reorganized and expanded
  - New ModelStyleConfig interface
  - COLOR_MODE_OPTIONS constant
  - updateModelStyle function for state management
  - Better section organization with collapsible UI
- **SceneCore** - Enhanced with post-processing support
  - Better scene effect composition
- **BossSpawnModal & AgentEditModal** - Minor UI improvements
- **Boss Handler** - Improved message routing

### Technical
- New PostProcessing.ts module with shader composition
- ColorCorrectionShader with GLSL color correction
- Material userData.hasColorShader tracking for injected shaders
- Shader uniform updates via material.onBeforeCompile
- New sceneConfig.modelStyle property
- Extended Toolbox configuration interface
- ColorMode type definition in Toolbox

## [0.25.0] - 2026-01-27

### Added
- **Message Navigation in Terminal** - Navigate through terminal messages with keyboard shortcuts
  - Alt+K / Alt+J for message-by-message navigation (up/down)
  - Alt+U / Alt+D for page-up/page-down (10 messages at a time)
  - Smooth animated scrolling to selected messages
  - Space bar to activate selected message (click links, buttons, bash output)
  - Escape to clear selection and exit navigation mode
  - Selected messages highlighted and auto-scroll into view
- **Enhanced Terminal Input State** - New hooks and store updates for better input handling
  - `useMessageNavigation` hook for managing message selection and scrolling
  - Integration with OutputLine component for message indexing
- **Agent Navigation Improvements** - Keyboard shortcuts for scene agent selection
  - Alt+H / Alt+L to navigate agents when terminal is closed
  - Consistent agent ordering with SwipeNavigation and AgentBar
  - Selection updates propagated through store
- **Terminal Activation with Space Bar** - Press Space to open terminal
  - Only opens terminal (Backtick or Escape to close)
  - Auto-selects last active agent if none selected
  - Respects input field context (doesn't trigger in text inputs)

### Changed
- **Terminal Output Display** - Enhanced output line styling and interactions
  - Added data-message-index attributes for navigation
  - Better visual feedback for interactive elements
  - Improved Bash output highlighting with additional color scheme
  - Enhanced guake-terminal styling with better output formatting
- **InputHandler Refactoring** - Extended keyboard event handling
  - Unified keyboard event processing for Space and Alt+H/L
  - Added agent ordering logic matching UI components
  - Better event delegation and input field detection
- **Character Loader** - Minor optimizations for character asset loading
- **WebSocket Handler** - Improved message handling robustness

### Technical
- New `useMessageNavigation` hook in ClaudeOutputPanel
- Extended OutputLine component with message indexing
- Store enhancements: lastSelectedAgentId tracking, terminal state management
- Keyboard event listener in InputHandler for Space and Alt+H/L
- Agent ordering utility in InputHandler matching AgentBar logic

## [0.24.1] - 2026-01-27

### Fixed
- **Agent Order Synchronization** - Fix inconsistent agent ordering between SwipeNavigation and AgentBar
  - Use unified `useAgentOrder` hook in both components for consistent navigation order
  - Add custom event broadcasting for order changes across component instances
  - Improve agent grouping by preserving custom order within area groups
- **SwipeNavigation Hook Refactor** - Simplified and improved agent ordering logic
  - Remove dependency on `useAreas` hook
  - Use base agent list sorted by creation time as foundation
  - Apply custom ordering from `useAgentOrder` for navigation consistency

## [0.24.0] - 2026-01-27

### Added
- **Theme Selector Keyboard Navigation** - Full keyboard support for theme switching
  - Arrow keys (Up/Down/Left/Right) cycle through themes
  - Enter/Space to open dropdown or select highlighted theme
  - Highlighted state for dropdown items with mouse hover support
- **Theme Selector Focus Management** - Improved accessibility
  - Focus styles on trigger button with cyan accent
  - Focus restoration after selection
  - Tooltip hints for keyboard shortcuts

### Changed
- **Theme Selector Styling** - Enhanced visual feedback
  - Active and highlighted states with distinct colors
  - Smooth transitions for all state changes
  - Cyan accent for focus states

### Fixed
- **Builtin Skill Assignment Restoration** - Preserve skill assignments on app restart
  - Restore agent assignments to builtin skills instead of discarding them
  - Preserve enabled state for previously configured skills
  - Merge persisted assignments with fresh builtin definitions

## [0.17.0] - 2026-01-26

### Added
- **Agent Delegation System** - Agents can now delegate tasks to other agents via a delegation request dialog
  - Click the delegation icon to send a task to another agent
  - Automatic skill injection and context management for delegated tasks
- **Boss Message Handling** - Bosses can now send formatted messages to subordinate agents
  - Message response modal with proper formatting and history
  - WebSocket communication for real-time agent-to-boss messaging
- **Agent Progress Indicator** - Visual progress tracking UI for delegated and autonomous tasks
  - Shows agent status and current operation
  - Integrated into Claude output panel
- **Built-in Skills Registry** - Server-side skill definitions for common operations
  - Git Captain skill for version control operations
  - Full Notifications skill for comprehensive notification system
  - Server Logs skill for debugging
  - Send Message to Agent skill for inter-agent communication
- **Skill Editor Enhancements** - Improved modal for managing agent skills
  - Better organization and styling
  - Enhanced skill selection interface

### Changed
- **WebSocket Handler** - Extended with agent delegation message support
- **Agent Service** - Added delegation request handling
- **Boss Message Service** - New service for formatting and routing boss messages
- **Store Structure** - Added delegation state and selectors
- **Modal Styling** - Enhanced modal system with improved layouts

### Technical
- New `delegation.ts` store module for delegation state management
- New `boss-response-handler.ts` for processing boss messages
- New `AgentProgressIndicator` component for progress tracking
- New `builtin-skills.ts` data module with skill definitions
- Extended WebSocket handlers for agent communication protocols
- Added delegation-related types to shared types module

## [0.16.1] - 2026-01-26

### Fixed
- **HMR (Hot Module Replacement) Issues** - Fix black screen and crashes during development reloads
  - Add app initialization flag to detect HMR vs full page load
  - Skip stale context cleanup during HMR
  - Implement proper canvas reattachment with animation frame management
  - Prevent rendering during scene transition
  - Use container dimensions as priority for canvas sizing
- **FPS Meter Position** - Move FPS meter to bottom-right to avoid UI conflicts
- **Canvas Dimension Handling** - Improved dimension priority during HMR
  - Use parent container as primary source (most reliable)
  - Fallback to canvas CSS, then canvas attributes, then window
- **InputHandler Touch Events** - Enhanced touch event handling

### Technical
- Add `isReattaching` flag to prevent renders during HMR transition
- Check `canvas.isConnected` to ensure DOM attachment before rendering
- Proper animation frame cleanup and restart in reattach method
- Window flag `__tideAppInitialized` for HMR detection

## [0.16.0] - 2026-01-26

### Added
- **Working Directory Support** - Agents can now have a configurable working directory
  - Add working directory field to agent edit modal
  - Directory changes trigger new session notification
  - Updates propagated via WebSocket handler
- **Emoji Picker Component** - New reusable emoji picker for UI
  - Standalone component for emoji selection
- **Boss Spawn Class Search** - Search and filter classes when spawning bosses
  - Filter custom classes by name, description, or ID
  - Filter built-in classes with same criteria
  - Improved class selection UX
- **Boss Name Prefix Customization** - Automatic name prefixing based on class
  - Boss class uses "Boss " prefix
  - Custom classes use their name as prefix
  - Dynamic prefix updates when changing class

### Changed
- **Skills Panel** - Enhanced styling and layout
- **Spawn Modals** - Improved UI for agent and boss spawning
- **Movement Animation** - Updated animation handling
- **Agent Store** - Added workdir field support

### Technical
- Modal component style enhancements
- Skills panel responsive improvements
- Server handler updates for workdir persistence

## [0.15.0] - 2026-01-26

### Added
- **Android/Capacitor Support** - Native Android app build
  - Capacitor configuration and Android project
  - Makefile with build commands (`make android-build`, `make android-run`)
  - Debug APK generation
- **Native Notifications** - Push notifications via Capacitor
  - `notifications.ts` utility for cross-platform notifications
  - Agent notification toast enhancements
- **Context Menu Improvements** - Enhanced right-click menu
  - Better styling and positioning
  - Mobile touch support
- **Modal Stack Enhancements** - Improved modal management
  - Better escape key handling
  - Stack depth tracking

### Changed
- **File Explorer Mobile** - Improved touch interactions
  - Better tree node touch targets
  - Enhanced file viewer mobile layout
- **Skills Panel** - Mobile responsive styles
- **WebSocket Reconnection** - Improved connection handling
- **Input Handler** - Better touch/mouse event handling
- **Storage Utils** - Additional storage helpers

### Fixed
- **File Content Loading** - Better error handling and caching
- **Server File Routes** - Improved file serving

### Technical
- Capacitor 7 with Android platform
- New Makefile for build automation
- `useModalStack` depth tracking additions

## [0.14.1] - 2026-01-25

### Added
- **Agent Navigation Shortcuts** - Keyboard shortcuts for switching agents
  - Alt+J to go to next agent (like swipe left)
  - Alt+K to go to previous agent (like swipe right)

### Fixed
- **Mobile Back Navigation** - Fix iOS Safari edge swipe breaking navigation
  - Push two history entries instead of one for buffer
  - Mobile back gestures can complete before popstate fires
  - Track history depth to properly calculate go-back amount

## [0.14.0] - 2026-01-25

### Added
- **PWA Support** - Install Tide Commander as a standalone app
  - Web app manifest with icons (192x192, 512x512)
  - Service worker for offline caching
  - PWA install banner with dismiss/install options
  - Standalone display mode support
- **Modal Stack System** - Proper modal layering and keyboard handling
  - `useModalStack` hook for z-index management
  - Escape key closes topmost modal only
  - Prevents body scroll when modals open
- **Swipe Gesture Hook** - Touch gesture detection for mobile
  - `useSwipeGesture` hook with configurable thresholds
  - Support for swipe direction detection

### Changed
- **Responsive Styles Reorganization** - Major refactor of mobile styles
  - Expanded responsive breakpoints and utilities
  - Better mobile panel layouts
  - Improved touch targets for mobile
- **File Explorer Styles** - Split into modular directory structure
  - `file-explorer/_index.scss` with partials
- **Guake Terminal Styles** - Split into modular directory structure
  - `guake-terminal/_index.scss` with partials
- **Agent Bar Mobile** - Enhanced mobile responsiveness
- **Git Changes Panel** - Improved mobile layout and interactions
- **Double Click Detection** - Better touch device handling

### Technical
- New `PWAInstallBanner` component
- `useModalStack`, `useSwipeGesture` hooks exported from hooks/index
- Touch event handling improvements in InputHandler
- Scene manager touch gesture support

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
