# Snapshot Star Button - Wiring Fix

## Issue
The star (⭐) button in the TerminalHeader was not visible because the `onSaveSnapshot` callback was not being passed from the App component down to the TerminalHeader component.

## Root Cause
The TerminalHeader component expected an optional `onSaveSnapshot` prop to render the star button (line 166):
```tsx
{!isSnapshotView && onSaveSnapshot && outputsLength > 0 && (
  <button className="guake-snapshot-btn" onClick={onSaveSnapshot}>
    ⭐
  </button>
)}
```

However, the callback was not being passed through the component hierarchy:
- App.tsx had `saveSnapshotModal.open()` available but wasn't passing it
- ClaudeOutputPanel wasn't accepting any props
- ClaudeOutputPanel wasn't passing props to TerminalHeader

## Solution

### 1. Updated App.tsx (line 646)
**Before:**
```tsx
<ClaudeOutputPanel />
```

**After:**
```tsx
<ClaudeOutputPanel onSaveSnapshot={() => saveSnapshotModal.open()} />
```

### 2. Updated ClaudeOutputPanel (lines 73-80)
**Added:**
- Interface definition for ClaudeOutputPanelProps with onSaveSnapshot callback
- Destructured onSaveSnapshot from props

**Before:**
```tsx
export function ClaudeOutputPanel() {
  // Store selectors
  const agents = useAgents();
```

**After:**
```tsx
export interface ClaudeOutputPanelProps {
  /** Callback when user clicks star button to save snapshot */
  onSaveSnapshot?: () => void;
}

export function ClaudeOutputPanel({ onSaveSnapshot }: ClaudeOutputPanelProps = {}) {
  // Store selectors
  const agents = useAgents();
```

### 3. Updated ClaudeOutputPanel TerminalHeader call (line 579)
**Added:** `onSaveSnapshot={onSaveSnapshot}` prop

**Before:**
```tsx
<TerminalHeader
  selectedAgent={selectedAgent}
  selectedAgentId={selectedAgentId}
  // ... other props
  headerRef={swipe.headerRef}
/>
```

**After:**
```tsx
<TerminalHeader
  selectedAgent={selectedAgent}
  selectedAgentId={selectedAgentId}
  // ... other props
  headerRef={swipe.headerRef}
  onSaveSnapshot={onSaveSnapshot}
/>
```

## Expected Behavior
- Star button (⭐) now visible in TerminalHeader when:
  - Viewing live agent conversation (not in snapshot view)
  - Agent has outputs/messages (outputsLength > 0)
- Clicking star button opens SaveSnapshotModal
- User can then create a snapshot with title and description

## Files Modified
- `src/packages/client/App.tsx` - Pass onSaveSnapshot callback
- `src/packages/client/components/ClaudeOutputPanel/index.tsx` - Accept and forward callback

## Build Status
✅ Build successful - No TypeScript or compilation errors

## Testing
The star button visibility depends on:
1. Active agent conversation (not snapshot view)
2. Agent has outputs
3. Callback is properly wired

All three conditions are now met with this fix.
