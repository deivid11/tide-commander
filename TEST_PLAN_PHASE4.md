# Phase 4: Keyboard Shortcuts & Performance Testing Plan

## Executive Summary

Comprehensive testing plan for keyboard shortcuts and performance optimization in Tide Commander across multiple browsers and configurations.

## Test Objectives

1. ✅ Verify all keyboard shortcuts work correctly
2. ✅ Confirm no browser conflicts with shortcuts
3. ✅ Validate performance with 20+ agents
4. ✅ Verify React.memo optimization effectiveness
5. ✅ Monitor memory during mode switching
6. ✅ Test keyboard accessibility and focus management
7. ✅ Cross-browser compatibility verification
8. ✅ Document any issues or bottlenecks

## Test Environment

### Hardware Requirements
- Modern development machine (2020+)
- 8GB+ RAM for memory profiling
- Monitor with 1920x1080+ resolution

### Software Requirements
- Chrome 90+ with DevTools
- Firefox 88+ with Developer Tools
- Safari 14+ (macOS/iOS)
- Edge 90+ with DevTools

### Test Data
- 20+ mock agents with various statuses
- 10+ mock buildings with various types
- Mixed hierarchical relationships (bosses/subordinates)

## Test Cases

### 1. Keyboard Shortcuts Testing

#### 1.1 Mode Switching - Alt+1 (2D Mode)

**Preconditions:**
- Application loaded in browser
- Currently in 3D or Dashboard mode
- No input fields focused

**Steps:**
1. Open DevTools Performance tab
2. Press Alt+1
3. Observe mode change to 2D
4. Check DevTools for render time
5. Verify no console errors

**Expected Results:**
- ✅ UI switches to 2D mode immediately
- ✅ Render time <50ms
- ✅ No console errors
- ✅ Sidebar and canvas responsive
- ✅ Dashboard mode accessible

**Pass/Fail:** [ ] Pass [ ] Fail

---

#### 1.2 Mode Switching - Alt+2 (3D Mode)

**Preconditions:**
- Application loaded in browser
- Currently in 2D or Dashboard mode
- No input fields focused

**Steps:**
1. Open DevTools Performance tab
2. Press Alt+2
3. Observe mode change to 3D
4. Check DevTools for render time
5. Verify canvas renders correctly
6. Check for memory allocation

**Expected Results:**
- ✅ UI switches to 3D mode immediately
- ✅ Render time <50ms
- ✅ 3D canvas displays correctly
- ✅ No memory leaks
- ✅ Scene loads smoothly

**Pass/Fail:** [ ] Pass [ ] Fail

---

#### 1.3 Mode Switching - Alt+3 (Dashboard Mode)

**Preconditions:**
- Application loaded in browser
- Currently in 2D or 3D mode
- 20+ agents and 10+ buildings in store

**Steps:**
1. Open DevTools Performance tab
2. Press Alt+3
3. Observe Dashboard renders
4. Verify all cards visible
5. Check render time for each component
6. Verify memory usage reasonable

**Expected Results:**
- ✅ Dashboard loads in <100ms
- ✅ All agent/building cards render
- ✅ Metrics display correctly
- ✅ Timeline shows events
- ✅ <5MB additional memory

**Pass/Fail:** [ ] Pass [ ] Fail

---

#### 1.4 Panel Toggle - Alt+S (Sidebar)

**Preconditions:**
- Application loaded in browser
- Sidebar currently visible
- Any view mode (2D/3D/Dashboard)

**Steps:**
1. Press Alt+S
2. Observe sidebar collapse
3. Verify canvas expands
4. Press Alt+S again
5. Verify sidebar reappears
6. Check no layout shift issues

**Expected Results:**
- ✅ Sidebar toggles visibility smoothly
- ✅ Canvas resizes accordingly
- ✅ No layout shift (CLS < 0.1)
- ✅ State persists correctly
- ✅ Mobile-friendly behavior

**Pass/Fail:** [ ] Pass [ ] Fail

---

#### 1.5 Panel Toggle - Alt+R (Right Panel)

**Preconditions:**
- Application loaded in browser
- Right panel currently visible
- Any view mode

**Steps:**
1. Press Alt+R
2. Observe right panel collapse
3. Verify canvas expands
4. Press Alt+R again
5. Verify right panel reappears
6. Check focus management

**Expected Results:**
- ✅ Right panel toggles visibility
- ✅ Canvas adjusts layout
- ✅ No layout shift
- ✅ Focus remains on canvas
- ✅ Responsive on all sizes

**Pass/Fail:** [ ] Pass [ ] Fail

---

### 2. Browser Conflict Testing

#### 2.1 Chrome Browser

**Shortcuts to test:**
- Alt+1, Alt+2, Alt+3 (mode switching)
- Alt+S, Alt+R (panel toggles)
- Alt+E (file explorer - existing)
- Alt+P (spotlight - existing)

**Steps:**
1. Open Chrome DevTools Console
2. Test each shortcut
3. Verify no browser shortcuts triggered
4. Check console for warnings
5. Test with DevTools open and closed

**Expected Results:**
- ✅ All shortcuts work
- ✅ No Chrome shortcuts conflict (Alt+1-9 safe in Chrome)
- ✅ No console warnings
- ✅ Consistent behavior with/without DevTools

**Pass/Fail:** [ ] Pass [ ] Fail

**Notes:**
_________________________________

---

#### 2.2 Firefox Browser

**Shortcuts to test:**
- Same as Chrome
- Alt+1-3, Alt+S, Alt+R, Alt+E, Alt+P

**Steps:**
1. Open Firefox Developer Tools Console
2. Test each shortcut
3. Check for accessibility shortcuts
4. Verify no conflicts with Firefox defaults
5. Test menu access (Alt+F doesn't trigger)

**Expected Results:**
- ✅ All shortcuts work in Firefox
- ✅ Alt+S/R don't trigger Firefox menu
- ✅ No conflicts with Firefox shortcuts
- ✅ Console clear

**Pass/Fail:** [ ] Pass [ ] Fail

**Notes:**
_________________________________

---

#### 2.3 Safari Browser

**Shortcuts to test:**
- Alt+1-3 (⌥+1-3 on Mac)
- Alt+S/R (⌥+S/R on Mac)

**Steps:**
1. Open Safari Web Inspector
2. Test shortcuts with ⌥ key
3. Check for OS conflicts
4. Verify input handling
5. Test on both Intel and Apple Silicon

**Expected Results:**
- ✅ Shortcuts respond to ⌥+key
- ✅ No macOS conflicts
- ✅ Web Inspector shows no errors
- ✅ Works on both Mac architectures

**Pass/Fail:** [ ] Pass [ ] Fail

**Notes:**
_________________________________

---

#### 2.4 Edge Browser

**Shortcuts to test:**
- Same as Chrome (Chromium-based)
- Alt+1-3, Alt+S, Alt+R

**Steps:**
1. Open Edge DevTools
2. Test all shortcuts
3. Check Edge-specific conflicts
4. Verify Chromium shortcuts don't interfere
5. Test in both Windows and Mac

**Expected Results:**
- ✅ All shortcuts work in Edge
- ✅ No conflicts with Edge keyboard shortcuts
- ✅ Consistent with Chrome behavior
- ✅ Works on Windows and Mac

**Pass/Fail:** [ ] Pass [ ] Fail

**Notes:**
_________________________________

---

### 3. Performance Testing

#### 3.1 Dashboard Performance (20+ Agents)

**Test Configuration:**
- 25 agents (mix of classes and statuses)
- 15 buildings (mix of types and statuses)
- Dashboard view mode

**Steps:**
1. Open Chrome DevTools Performance tab
2. Start recording
3. Switch to Dashboard (Alt+3)
4. Let Dashboard fully render
5. Stop recording
6. Analyze metrics

**Expected Metrics:**
- **Initial Paint (FP):** <1000ms
- **Largest Contentful Paint (LCP):** <1500ms
- **Total Blocking Time (TBT):** <300ms
- **Cumulative Layout Shift (CLS):** <0.1
- **Frame rate:** 60fps (16.67ms per frame)

**Performance Data:**
```
Recording Duration: ___ ms
Initial Render: ___ ms
Agent Cards Render: ___ ms
Building Cards Render: ___ ms
Timeline Render: ___ ms
Total Time: ___ ms
```

**Pass/Fail:** [ ] Pass [ ] Fail

**Analysis:**
_________________________________

---

#### 3.2 React.memo Effectiveness

**Test Configuration:**
- 25 agents in Dashboard
- Monitor re-renders with React DevTools Profiler

**Steps:**
1. Install React DevTools Profiler
2. Open Profiler tab
3. Record interaction: Select an agent
4. Check component re-renders
5. Verify memoized components skip re-render
6. Document render times

**Expected Results:**
- ✅ AgentCard memoization prevents re-render
- ✅ BuildingCard skips re-render on other selections
- ✅ Unselected cards maintain previous state
- ✅ No unnecessary renders
- ✅ Improvement: 40-60% fewer re-renders

**Profiler Data:**
```
Component Render Times (ms):
- AgentCard (selected): ___ ms
- AgentCard (unselected): ___ ms (should skip)
- BuildingCard (selected): ___ ms
- BuildingCard (unselected): ___ ms (should skip)

Total Renders:
- Without optimization: ___ renders
- With optimization: ___ renders
- Improvement: ____ %
```

**Pass/Fail:** [ ] Pass [ ] Fail

---

#### 3.3 Memory Usage During Mode Switching

**Test Configuration:**
- Chrome DevTools Memory tab
- 25 agents, 15 buildings

**Steps:**
1. Open Memory tab in DevTools
2. Take heap snapshot (baseline)
3. Switch modes 5 times: 3D → 2D → Dashboard → 3D → 2D
4. Take heap snapshot after switching
5. Compare snapshots
6. Check for retained objects

**Expected Results:**
- **Initial Heap:** ~10-15MB
- **After Switching:** ~12-17MB (acceptable variance)
- **Memory Leak:** None detected
- **GC Cleanup:** Memory returns to baseline after GC

**Memory Data:**
```
Baseline Heap Size: ___ MB
After Mode Switch #1: ___ MB
After Mode Switch #2: ___ MB
After Mode Switch #3: ___ MB
After Mode Switch #4: ___ MB
After Mode Switch #5: ___ MB
Final Heap Size: ___ MB
GC Triggered Heap: ___ MB

Retained Objects:
- Detached DOM nodes: ___
- Event listeners: ___
- Circular references: ___
```

**Pass/Fail:** [ ] Pass [ ] Fail

**Leaks Found:** [ ] Yes [ ] No

**Details:**
_________________________________

---

#### 3.4 Mode Switching Performance

**Test Configuration:**
- Chrome DevTools Performance tab
- Measure switch time: 3D → 2D, 2D → Dashboard, Dashboard → 3D

**Steps:**
1. Record Performance
2. Press Alt+1 (3D to 2D)
3. Stop recording, note time
4. Record Performance
5. Press Alt+3 (2D to Dashboard)
6. Stop recording, note time
7. Record Performance
8. Press Alt+2 (Dashboard to 3D)
9. Stop recording, note time

**Expected Results:**
- **3D to 2D:** <100ms
- **2D to Dashboard:** <100ms
- **Dashboard to 3D:** <100ms
- **Consistent Performance:** No degradation

**Mode Switch Times:**
```
3D → 2D: ___ ms
2D → Dashboard: ___ ms
Dashboard → 3D: ___ ms
3D → 2D (repeat): ___ ms

Average: ___ ms
Max: ___ ms
Min: ___ ms
Jank (>16ms frames): [ ] Yes [ ] No
```

**Pass/Fail:** [ ] Pass [ ] Fail

---

### 4. Accessibility Testing

#### 4.1 Keyboard Navigation

**Test Configuration:**
- All browsers
- Keyboard only (no mouse)

**Steps:**
1. Start with 3D mode
2. Test Tab to navigate to interactive elements
3. Test Shift+Tab to navigate backwards
4. Press Alt+1, verify focus management
5. Use arrow keys where applicable
6. Verify focus visible (outline visible)

**Expected Results:**
- ✅ All controls reachable via Tab
- ✅ Focus indicators visible (not hidden)
- ✅ Logical tab order
- ✅ No focus traps
- ✅ Keyboard shortcuts work without mouse

**Issues Found:**
_________________________________

**Pass/Fail:** [ ] Pass [ ] Fail

---

#### 4.2 Screen Reader Testing

**Test Configuration:**
- NVDA (Windows) or JAWS
- VoiceOver (macOS/iOS)

**Steps:**
1. Enable screen reader
2. Navigate to Dashboard
3. Listen for labels on agent cards
4. Check building card descriptions
5. Verify timeline event descriptions
6. Test Alt+3 announcement

**Expected Results:**
- ✅ All interactive elements have labels
- ✅ Card purpose announced
- ✅ Status indicators described
- ✅ Navigation menu visible
- ✅ Logical reading order

**Issues Found:**
_________________________________

**Pass/Fail:** [ ] Pass [ ] Fail

---

#### 4.3 Focus Management

**Test Configuration:**
- 25 agents Dashboard view
- Focus tracking

**Steps:**
1. Start in 3D mode
2. Press Alt+3 (Dashboard)
3. Observe where focus goes
4. Press Tab multiple times
5. Press Alt+R (hide right panel)
6. Verify focus management
7. Press Alt+S (hide sidebar)
8. Check focus not lost

**Expected Results:**
- ✅ Focus moves to main content area
- ✅ Focus never lost after mode switch
- ✅ Focus not trapped
- ✅ Tab order makes sense
- ✅ Focus visible at all times

**Issues Found:**
_________________________________

**Pass/Fail:** [ ] Pass [ ] Fail

---

### 5. Responsive Design Testing

#### 5.1 Desktop (1920x1080)

**Configuration:**
- Chrome DevTools Device Emulation
- 1920x1080 viewport

**Steps:**
1. Open all three modes (2D, 3D, Dashboard)
2. Verify layout looks correct
3. Check card grid responsiveness
4. Test sidebar collapse/expand
5. Test right panel collapse/expand

**Results:**
- Dashboard Grid: ✅ Pass ✅ Fail
- Card Layout: ✅ Pass ✅ Fail
- Panel Resize: ✅ Pass ✅ Fail

**Notes:**
_________________________________

---

#### 5.2 Tablet (768x1024 - iPad)

**Configuration:**
- Chrome DevTools Tablet Mode
- 768x1024 viewport

**Steps:**
1. Open Dashboard
2. Verify single-column layout
3. Test card responsiveness
4. Check touch-friendly sizing
5. Verify panels accessible

**Results:**
- Single Column: ✅ Pass ✅ Fail
- Touch Targets: ✅ Pass ✅ Fail
- Readability: ✅ Pass ✅ Fail

**Notes:**
_________________________________

---

#### 5.3 Mobile (375x667 - iPhone)

**Configuration:**
- Chrome DevTools Mobile Mode
- 375x667 viewport

**Steps:**
1. Open Dashboard
2. Verify stacked layout
3. Check card full-width
4. Test font sizes readable
5. Verify no horizontal scroll

**Results:**
- Stacked Layout: ✅ Pass ✅ Fail
- No Overflow: ✅ Pass ✅ Fail
- Readable: ✅ Pass ✅ Fail

**Notes:**
_________________________________

---

## Test Results Summary

### Overall Results

| Category | Passed | Failed | Notes |
|----------|--------|--------|-------|
| Keyboard Shortcuts | _/5 | _/5 | |
| Browser Compatibility | _/4 | _/4 | |
| Performance Metrics | _/4 | _/4 | |
| Accessibility | _/3 | _/3 | |
| Responsive Design | _/3 | _/3 | |
| **TOTAL** | **_/19** | **_/19** | |

### Performance Summary

```
Metric                  | Target    | Actual    | Status
========================|===========|===========|========
Mode Switch Time        | <100ms    | ___ ms    | [ ]✅[ ]❌
Dashboard Render        | <100ms    | ___ ms    | [ ]✅[ ]❌
Agent Card Render       | <50ms     | ___ ms    | [ ]✅[ ]❌
React.memo Improvement  | 40-60%    | ___%      | [ ]✅[ ]❌
Memory Stable           | <5MB delta| ___ MB    | [ ]✅[ ]❌
No Memory Leaks         | 0         | ___ leaks | [ ]✅[ ]❌
Frame Rate              | 60fps     | ___ fps   | [ ]✅[ ]❌
Layout Shift (CLS)      | <0.1      | ___ CLS   | [ ]✅[ ]❌
```

### Browser Compatibility Summary

```
Browser  | Alt+1 | Alt+2 | Alt+3 | Alt+S | Alt+R | Conflicts | Status
=========|=======|=======|=======|=======|=======|===========|========
Chrome   | [ ]   | [ ]   | [ ]   | [ ]   | [ ]   | [ ] Yes   | [ ]✅
Firefox  | [ ]   | [ ]   | [ ]   | [ ]   | [ ]   | [ ] Yes   | [ ]✅
Safari   | [ ]   | [ ]   | [ ]   | [ ]   | [ ]   | [ ] Yes   | [ ]✅
Edge     | [ ]   | [ ]   | [ ]   | [ ]   | [ ]   | [ ] Yes   | [ ]✅
```

### Issues Found

**Critical Issues:** ___ found

1. Issue: _________________________________________________
   Severity: [ ] Critical [ ] High [ ] Medium [ ] Low
   Fix: ____________________________________________________

**High Priority Issues:** ___ found

**Medium Priority Issues:** ___ found

**Low Priority Issues:** ___ found

### Recommendations

1. _________________________________________________
2. _________________________________________________
3. _________________________________________________

## Sign-Off

**Tested By:** _________________________ **Date:** _________

**Reviewed By:** ________________________ **Date:** _________

**Status:** [ ] All Tests Passed - Ready for Production
           [ ] Issues Found - Requires Fixes
           [ ] Conditional - Acceptable Performance

---

## Appendix: DevTools Profiling Guide

### Chrome DevTools Performance Tab

1. Open DevTools (F12)
2. Go to Performance tab
3. Click Record button (red circle)
4. Perform action (Alt+3 for Dashboard)
5. Click Stop button
6. Analyze:
   - FCP (First Contentful Paint)
   - LCP (Largest Contentful Paint)
   - TBT (Total Blocking Time)
   - CLS (Cumulative Layout Shift)

### React DevTools Profiler

1. Install React DevTools extension
2. Open React DevTools
3. Go to Profiler tab
4. Click Record button
5. Perform action
6. Stop recording
7. Check:
   - Component render times
   - Memoization effectiveness
   - Unnecessary re-renders

### Chrome DevTools Memory

1. Open DevTools
2. Go to Memory tab
3. Click "Take heap snapshot"
4. Note size (baseline)
5. Perform action
6. Click "Take heap snapshot"
7. Compare snapshots
8. Check for retained objects
