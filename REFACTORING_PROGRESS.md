# Frontend Refactoring Progress

**Started:** 2026-01-20
**Status:** In Progress - Phase 2.1, 3.1 & 4.2 Complete (Store, ClaudeOutputPanel & BuildingManager)

---

## Overview

This document tracks the progress of frontend codebase refactoring for `/src/packages/client`.

### Key Metrics (Before)
- Largest file: `ClaudeOutputPanel.tsx` (2,891 lines)
- Store file: `store/index.ts` (2,433 lines)
- Files over 1,000 lines: 6
- Files over 300 lines: 18
- Duplicated utility functions: Multiple instances of `getClassConfig`, `normalizeColor`
- Color definitions: Scattered across 5+ files
- localStorage calls: 45+ scattered across 12 files

### Improvements Made
- Created centralized `utils/classConfig.ts` - eliminated 3 duplicate implementations
- Created centralized `utils/colors.ts` - consolidated 8+ scattered color definitions
- Created `utils/storage.ts` - typed localStorage wrapper for 30+ storage operations
- Created `hooks/useModalState.ts` - reusable modal state hook
- Created `hooks/useFormState.ts` - reusable form state hook
- **Migrated all 45+ localStorage calls** to use centralized storage.ts wrapper
- **Refactored App.tsx modal state** - replaced 12 useState calls with useModalState hooks

---

## Phase 1: Foundation - COMPLETE

### 1.1 Extract classConfig utilities
- **Status:** COMPLETE
- **Files Created:**
  - [x] `utils/classConfig.ts` - `getClassConfig()`, `normalizeColor()`
- **Files Modified:**
  - [x] `components/ClaudeOutputPanel.tsx` - removed duplicate, now imports
  - [x] `components/UnitPanel.tsx` - removed duplicate, now imports
  - [x] `components/AgentBar.tsx` - removed duplicate, now imports
- **Description:** Extracted duplicated `getClassConfig()` and `normalizeColor()` functions

### 1.2 Create centralized colors.ts
- **Status:** COMPLETE
- **Files Created:**
  - [x] `utils/colors.ts` - all color constants and utilities
- **Files Modified:**
  - [x] `components/UnitPanel.tsx` - now uses `PROGRESS_COLORS`, `AGENT_STATUS_COLORS`, `getIdleTimerColor`
  - [x] `components/BottomToolbar.tsx` - now uses `AGENT_STATUS_COLORS`
  - [x] `components/BuildingConfigModal.tsx` - now uses `BUILDING_STATUS_COLORS`
  - [x] `components/Toolbox.tsx` - now uses `AREA_COLORS`, `BUILDING_STATUS_COLORS`
  - [x] `components/ClaudeOutputPanel.tsx` - now uses `getIdleTimerColor`, `getAgentStatusColor`
  - [x] `components/AgentBar.tsx` - now uses `getIdleTimerColor`, `getAgentStatusColor`
  - [x] `components/ActivityFeed.tsx` - now uses `TOOL_ICONS` from outputRendering
  - [x] `scene/animation/EffectsManager.ts` - now uses `TOOL_ICONS` from outputRendering
  - [x] `utils/formatting.ts` - re-exports `getIdleTimerColor` for backwards compatibility
  - [x] `utils/outputRendering.ts` - re-exports `getAgentStatusColor` as `getStatusColor` (deprecated)
- **Description:** Centralized all color definitions with both string and hex number variants

### 1.3 Create storage.ts wrapper
- **Status:** COMPLETE
- **Files Created:**
  - [x] `utils/storage.ts` - typed localStorage wrapper with:
    - `STORAGE_KEYS` - centralized key constants
    - `getStorage<T>()` - generic typed getter with JSON parsing
    - `getStorageString()` - string getter
    - `getStorageBoolean()` - boolean getter
    - `getStorageNumber()` - numeric getter
    - `setStorage<T>()` - generic typed setter
    - `setStorageString()`, `setStorageBoolean()`, `setStorageNumber()` - type-specific setters
    - `removeStorage()` - removal helper
    - `hasStorage()` - existence check
    - `clearAllStorage()` - clear all app-related storage
- **Description:** Created wrapper for localStorage operations with type safety and error handling

### 1.4 Create useModalState hook
- **Status:** COMPLETE
- **Files Created:**
  - [x] `hooks/useModalState.ts` - modal state management hook with:
    - `useModalState<T>()` - generic modal state with optional data
    - `useModalStateWithId()` - ID-based modal state for edit modals
- **Description:** Reusable hook for modal state management

### 1.5 Create useFormState hook
- **Status:** COMPLETE
- **Files Created:**
  - [x] `hooks/useFormState.ts` - form state management hook with:
    - `useFormState<T>()` - form state with field management and reset
    - `useSyncedFormState<TData, TForm>()` - form state synced with external data
    - `getInputProps()`, `getCheckboxProps()` - helpers for input binding
  - [x] `hooks/index.ts` - barrel export for all hooks
- **Description:** Reusable hook for form state with reset capabilities

### 1.6 Migrate localStorage calls to storage.ts
- **Status:** COMPLETE
- **Files Modified:**
  - [x] `App.tsx` - config, FPS settings now use storage wrapper
  - [x] `store/index.ts` - settings, shortcuts now use storage wrapper
  - [x] `utils/camera.ts` - camera state now uses storage wrapper
  - [x] `components/ClaudeOutputPanel.tsx` - view mode, terminal height, input text, pasted texts
  - [x] `components/CommanderView.tsx` - active tab, cwd
  - [x] `components/UnitPanel.tsx` - supervisor collapsed state
  - [x] `components/SpawnModal.tsx` - cwd
  - [x] `components/BossSpawnModal.tsx` - cwd
  - [x] `components/BuildingConfigModal.tsx` - cwd
  - [x] `components/ToolHistory.tsx` - collapsed states
- **Description:** Migrated all 45+ localStorage calls to use centralized `STORAGE_KEYS` and typed helpers

### 1.7 Refactor App.tsx modal state with useModalState hook
- **Status:** COMPLETE
- **Files Modified:**
  - [x] `App.tsx` - replaced 12 individual useState calls with useModalState/useModalStateWithId hooks
- **Before:**
  ```tsx
  const [isSpawnModalOpen, setIsSpawnModalOpen] = useState(false);
  const [isBossSpawnModalOpen, setIsBossSpawnModalOpen] = useState(false);
  const [isSubordinateModalOpen, setIsSubordinateModalOpen] = useState(false);
  const [editingBossId, setEditingBossId] = useState<string | null>(null);
  const [isToolboxOpen, setIsToolboxOpen] = useState(false);
  const [isCommanderViewOpen, setIsCommanderViewOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isSupervisorOpen, setIsSupervisorOpen] = useState(false);
  const [isSpotlightOpen, setIsSpotlightOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isBuildingModalOpen, setIsBuildingModalOpen] = useState(false);
  const [isSkillsPanelOpen, setIsSkillsPanelOpen] = useState(false);
  const [editingBuildingId, setEditingBuildingId] = useState<string | null>(null);
  const [explorerAreaId, setExplorerAreaId] = useState<string | null>(null);
  ```
- **After:**
  ```tsx
  const spawnModal = useModalState();
  const bossSpawnModal = useModalState();
  const subordinateModal = useModalState<string>(); // data = bossId
  const toolboxModal = useModalState();
  const commanderModal = useModalState();
  const deleteConfirmModal = useModalState();
  const supervisorModal = useModalState();
  const spotlightModal = useModalState();
  const shortcutsModal = useModalState();
  const skillsModal = useModalState();
  const buildingModal = useModalState<string | null>(); // data = editingBuildingId
  const explorerModal = useModalStateWithId(); // has .id for areaId
  ```
- **Benefits:**
  - Consistent modal state management across the app
  - Cleaner component code with `.open()`, `.close()`, `.toggle()` methods
  - Type-safe data passing for modals that need associated data
  - Reduced boilerplate code

---

## Phase 2: Store Decomposition (Complete)

### 2.1 Domain Store Extraction
- **Status:** COMPLETE
- **Original File:** `store/index.ts` (2,415 lines)
- **New Structure:**
  - [x] `store/types.ts` - All interfaces, types, and constants
  - [x] `store/agents.ts` - Agent CRUD, selection, commands, activity tracking
  - [x] `store/outputs.ts` - Claude output management
  - [x] `store/supervisor.ts` - Supervisor state, reports, narratives
  - [x] `store/areas.ts` - Drawing areas management
  - [x] `store/buildings.ts` - Buildings CRUD, selection, commands, logs
  - [x] `store/permissions.ts` - Permission requests handling
  - [x] `store/delegation.ts` - Boss agent delegation logic
  - [x] `store/skills.ts` - Skills and custom agent classes management
  - [x] `store/selectors.ts` - All React hooks (useAgents, useOutputs, etc.)
  - [x] `store/index.ts` - Main entry point with composition
- **Benefits:**
  - Reduced complexity: 2,415 lines → 11 focused modules
  - Better separation of concerns by domain
  - Easier to understand and maintain individual features
  - All exports maintained for backwards compatibility

---

## Phase 3: Component Decomposition (In Progress)

### 3.1 Split ClaudeOutputPanel
- **Status:** COMPLETE
- **Original File:** `ClaudeOutputPanel.tsx` (2,891 lines)
- **New Structure:**
  - [x] `components/ClaudeOutputPanel/index.tsx` - Main component (~700 lines)
  - [x] `components/ClaudeOutputPanel/types.ts` - Types, constants, interfaces
  - [x] `components/ClaudeOutputPanel/MarkdownComponents.tsx` - Custom markdown components with Dracula theme
  - [x] `components/ClaudeOutputPanel/viewFilters.ts` - View mode filter helpers (simple/chat/advanced)
  - [x] `components/ClaudeOutputPanel/BossContext.tsx` - Boss context & delegation block components
  - [x] `components/ClaudeOutputPanel/ToolRenderers.tsx` - Edit/Read/TodoWrite tool renderers with diff view
  - [x] `components/ClaudeOutputPanel/contentRendering.tsx` - Content rendering utilities (highlight, images)
  - [x] `components/ClaudeOutputPanel/HistoryLine.tsx` - Memoized history line component
  - [x] `components/ClaudeOutputPanel/OutputLine.tsx` - Memoized streaming output component
  - [x] `components/ClaudeOutputPanel/GuakeAgentLink.tsx` - Agent indicator in bottom bar
  - [x] `components/ClaudeOutputPanel/PermissionRequest.tsx` - Permission request card/inline components
  - [x] `components/ClaudeOutputPanel/useTerminalInput.ts` - Terminal input state management hook
- **Benefits:**
  - Reduced complexity: 2,891 lines → 12 focused files
  - Better separation of concerns
  - Memoized components for performance
  - Reusable hooks for state management
  - Easier to maintain and test individual components

### 3.2 Extract UnitPanel sub-components
- **Status:** PLANNED
- **Target Structure:**
  - [ ] `components/UnitPanel/index.tsx`
  - [ ] `components/UnitPanel/AgentsList.tsx`
  - [ ] `components/UnitPanel/SingleAgentPanel.tsx`
  - [ ] `components/UnitPanel/MultiAgentPanel.tsx`

### 3.3-3.5 Other Component Splits
- **Status:** PLANNED

---

## Phase 4: Architecture Polish (Planned)

### 4.1 Modal Manager Context
- **Status:** PLANNED

### 4.2 Scene Directory Reorganization - BuildingManager
- **Status:** COMPLETE
- **Original File:** `scene/buildings/BuildingManager.ts` (2,202 lines)
- **New Structure:**
  - [x] `scene/buildings/types.ts` - Types, interfaces, color palettes (94 lines)
  - [x] `scene/buildings/labelUtils.ts` - Label creation and update utilities (82 lines)
  - [x] `scene/buildings/styleCreators.ts` - 9 building style mesh creators (1,321 lines)
  - [x] `scene/buildings/animations.ts` - Idle and running animations by style (524 lines)
  - [x] `scene/buildings/BuildingManager.ts` - Main manager class (328 lines)
  - [x] `scene/buildings/index.ts` - Barrel exports (37 lines)
- **Benefits:**
  - Reduced main manager from 2,202 to 328 lines
  - Animations separated from mesh creation logic
  - Style creators can be reused or extended independently
  - All exports maintained for backwards compatibility

### 4.3 Scene Directory Reorganization - Other
- **Status:** PLANNED

### 4.3 Naming Conventions Documentation
- **Status:** PLANNED

---

## Completed Items

| Date | Item | Notes |
|------|------|-------|
| 2026-01-20 | Phase 1.1 - classConfig utilities | Consolidated 3 duplicate implementations |
| 2026-01-20 | Phase 1.2 - colors.ts | Consolidated 8+ color definitions, updated 10 files |
| 2026-01-20 | Phase 1.3 - storage.ts | Created typed localStorage wrapper |
| 2026-01-20 | Phase 1.4 - useModalState hook | Created with generic data support |
| 2026-01-20 | Phase 1.5 - useFormState hook | Created with sync and input binding helpers |
| 2026-01-20 | Phase 1.6 - localStorage migration | Migrated 45+ calls across 10 files |
| 2026-01-20 | Phase 1.7 - App.tsx modal state | Replaced 12 useState calls with useModalState hooks |
| 2026-01-20 | Phase 3.1 - ClaudeOutputPanel split | Decomposed 2,891-line file into 12 focused modules |
| 2026-01-20 | Phase 2.1 - Store split | Decomposed 2,415-line store into 11 domain modules |
| 2026-01-20 | Phase 4.2 - BuildingManager split | Decomposed 2,202-line file into 6 focused modules |

---

## Files Created in Phase 1

```
src/packages/client/
├── hooks/
│   ├── index.ts              # Barrel export
│   ├── useModalState.ts      # Modal state hook
│   └── useFormState.ts       # Form state hook
└── utils/
    ├── classConfig.ts        # Agent class config utilities
    ├── colors.ts             # Centralized color constants
    └── storage.ts            # localStorage wrapper
```

## Files Created in Phase 2

```
src/packages/client/store/
├── index.ts                  # Main entry point (composition)
├── types.ts                  # All interfaces and types
├── agents.ts                 # Agent management actions
├── outputs.ts                # Claude output management
├── supervisor.ts             # Supervisor state and actions
├── areas.ts                  # Drawing areas management
├── buildings.ts              # Buildings management
├── permissions.ts            # Permission requests
├── delegation.ts             # Boss delegation logic
├── skills.ts                 # Skills & custom classes
└── selectors.ts              # React hooks/selectors
```

## Files Created in Phase 3

```
src/packages/client/components/ClaudeOutputPanel/
├── index.tsx                 # Main component (exports ClaudeOutputPanel)
├── types.ts                  # Types, constants, interfaces
├── MarkdownComponents.tsx    # Custom markdown components
├── viewFilters.ts            # View mode filter helpers
├── BossContext.tsx           # Boss context & delegation components
├── ToolRenderers.tsx         # Edit/Read/TodoWrite renderers
├── contentRendering.tsx      # Content rendering utilities
├── HistoryLine.tsx           # History line component (memoized)
├── OutputLine.tsx            # Streaming output component (memoized)
├── GuakeAgentLink.tsx        # Agent indicator component
├── PermissionRequest.tsx     # Permission request components
└── useTerminalInput.ts       # Input state management hook
```

## Files Created in Phase 4

```
src/packages/client/scene/buildings/
├── index.ts                  # Barrel exports
├── types.ts                  # Types, interfaces, color palettes
├── labelUtils.ts             # Label creation and update
├── styleCreators.ts          # 9 building style mesh creators
├── animations.ts             # Idle and running animations
└── BuildingManager.ts        # Main manager (reduced from 2,202 to 328 lines)
```

---

## Next Steps (Priority Order)

1. **Split Battlefield.ts** - Extract terrain, grid, and environment rendering (1,923 lines)
2. **Split UnitPanel.tsx** - Extract agent list and panel sub-components (1,367 lines)
3. **Apply useFormState hook** - Refactor form-heavy components to use the hook

---

## Notes

- All changes maintain backwards compatibility via re-exports
- No breaking changes to existing component interfaces
- All localStorage calls now go through typed storage wrapper
- Hooks are ready for use in new/refactored components
- Run `npm run build` to verify no type errors introduced
