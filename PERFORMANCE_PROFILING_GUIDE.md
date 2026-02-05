# Phase 4: Performance Profiling Guide

## Quick Start Guide for Manual Testing

This guide provides step-by-step instructions for profiling keyboard shortcuts and performance using Chrome DevTools.

## Part 1: Performance Profiling

### Step 1: Open Chrome DevTools

```
1. Press F12 or Ctrl+Shift+I (Cmd+Option+I on Mac)
2. Click "Performance" tab
3. Set throttling to "No throttling" for accurate baseline
```

### Step 2: Profile Dashboard Render (Alt+3)

**Setup:**
1. Load application
2. Ensure 20+ agents and 10+ buildings in store
3. Start in 3D mode (Alt+2)

**Execution:**
```
1. Open DevTools → Performance
2. Click red Record button
3. Press Alt+3 (switch to Dashboard)
4. Wait for full render
5. Click Stop button
6. DevTools now shows performance data
```

**What to Look For:**
- **First Contentful Paint (FCP)** - First content visible
- **Largest Contentful Paint (LCP)** - Main content visible
- **Total Blocking Time (TBT)** - JavaScript execution time
- **Cumulative Layout Shift (CLS)** - Visual stability

**Success Criteria:**
```
✅ LCP < 1000ms (ideally < 500ms)
✅ TBT < 300ms
✅ CLS < 0.1 (no layout shifts)
✅ FCP < 500ms
```

### Step 3: Check Frame Rate

**In Performance recording:**
```
1. Scroll down to "Frames" section
2. Look for frame bars (should be green)
3. Yellow/Red bars indicate frame drops
4. Target: All frames should be ~16.67ms
```

**Interpretation:**
```
✅ Green bar = Frame rendered in time (60fps)
⚠️  Yellow bar = Frame took 16-50ms (still acceptable)
❌ Red bar = Frame took >50ms (jank visible)
```

### Step 4: Analyze Main Thread

**In Performance recording:**
```
1. Look at "Main" section
2. Check JavaScript (yellow)
3. Check Rendering (purple)
4. Check Painting (green)

Each should be proportional:
- JS heavy: Lots of yellow
- Rendering heavy: Lots of purple
- Painting heavy: Lots of green
```

**Dashboard should be:**
- ✅ ~40% JavaScript (data processing)
- ✅ ~30% Rendering (layout calculation)
- ✅ ~20% Painting (drawing to canvas)
- ✅ ~10% Other (idle time)

## Part 2: React DevTools Profiler

### Step 1: Install React DevTools

```
1. Download extension from Chrome Web Store
2. Add to Chrome
3. DevTools now has "React" and "Profiler" tabs
```

### Step 2: Profile Component Renders

**Setup:**
1. Open DevTools
2. Click "Profiler" tab in React DevTools
3. Open Dashboard view

**Execution:**
```
1. Click Record button (circle)
2. Click on an agent card to select it
3. Observe other cards (should NOT re-render)
4. Click Stop button
5. Analyze render times
```

**Success Criteria:**
```
✅ Selected AgentCard: Re-renders (expected)
✅ Other AgentCards: Skip render (memo working!)
✅ Unrelated components: No re-render
✅ Total re-renders: < 10 (before: > 30)
```

### Step 3: Measure Memoization Impact

**Formula:**
```
Improvement % = ((Before - After) / Before) × 100

Example:
Before memo: 50 component renders
After memo: 15 component renders
Improvement: ((50 - 15) / 50) × 100 = 70% ✅
```

**Expected Results:**
```
✅ 40-60% reduction in re-renders
✅ 30-50% reduction in render time
✅ Smoother UI interactions
```

## Part 3: Memory Profiling

### Step 1: Take Baseline Heap Snapshot

```
1. Open DevTools → Memory
2. Click "Take heap snapshot" button
3. Wait for snapshot to complete
4. Note the size (e.g., "12.5 MB")
5. Screenshot the result
```

### Step 2: Perform Mode Switches

```
1. Perform 5 rapid mode switches:
   - Alt+1 (2D)
   - Alt+3 (Dashboard)
   - Alt+2 (3D)
   - Alt+1 (2D)
   - Alt+3 (Dashboard)
2. Wait 2 seconds after each switch
3. Perform actions in each mode
```

### Step 3: Take Final Heap Snapshot

```
1. Click "Take heap snapshot" again
2. Wait for completion
3. Note the size
4. Calculate difference: Final - Baseline
```

**Success Criteria:**
```
✅ Delta < 5MB (acceptable variance)
✅ Baseline: ~12-15 MB
✅ After switches: ~14-18 MB
✅ After GC: Returns near baseline
```

### Step 4: Check for Memory Leaks

**Detached DOM Nodes:**
```
1. In heap snapshot, search for "detached"
2. Should see minimal detached DOM nodes
3. Expected: < 10 detached elements

If > 50 detached elements, possible leak!
```

**Event Listeners:**
```
1. Search for "event" in heap snapshot
2. Count event listeners
3. Should be < 50 active listeners

Too many = possible leak
```

### Step 5: Run Garbage Collection

```
1. Click trash icon to force GC
2. Take another heap snapshot
3. Memory should drop back to baseline
4. If not, possible memory leak
```

## Part 4: Timeline Analysis

### Create a Custom Timeline

```
1. In Performance recording, mark custom events:
   - console.time('Dashboard Render')
   - [perform action]
   - console.timeEnd('Dashboard Render')

2. Custom marks appear in timeline
3. Easy to identify bottlenecks
```

### Example Code:

```javascript
// In DashboardView.tsx
useEffect(() => {
  console.time('Dashboard:Render');
  return () => {
    console.timeEnd('Dashboard:Render');
  };
}, []);

// Result in DevTools:
// "Dashboard:Render: 45.23 ms"
```

## Part 5: Network Profiling

### Check Resource Loading

```
1. Open DevTools → Network tab
2. Switch modes
3. Check if any network requests
4. Expected: 0 requests on mode switch (no API calls)
```

**If network requests seen:**
```
❌ Mode switch shouldn't need network calls
✅ Only initial Dashboard load makes requests
```

## Part 6: Coverage Analysis

### Check Code Coverage

```
1. DevTools → More Tools → Coverage
2. Click Record button
3. Switch to Dashboard
4. Perform various actions
5. Click Stop button
```

**Results:**
```
✅ JS Coverage > 80% (most code used)
✅ CSS Coverage > 70% (most styles used)
❌ Coverage < 50% indicates unused code
```

## Interpretation Cheat Sheet

### Render Time Interpretation

```
< 16ms      = ✅ Perfect (60fps)
16-50ms     = ⚠️  Acceptable (frame drop but not bad)
50-100ms    = ⚠️  Noticeable (some jank)
> 100ms     = ❌ Bad (visible lag)

Dashboard target: < 50ms
```

### Memory Interpretation

```
< 10MB      = ✅ Excellent (minimal footprint)
10-20MB     = ✅ Good (normal for web app)
20-50MB     = ⚠️  Acceptable (larger app)
> 50MB      = ❌ Investigate (possible leak)

Target: < 20MB for Dashboard
```

### FCP/LCP Interpretation

```
< 500ms     = ✅ Excellent
500-1500ms  = ✅ Good
1500-2500ms = ⚠️  Acceptable
> 2500ms    = ❌ Poor

Dashboard FCP target: < 500ms
Dashboard LCP target: < 1000ms
```

## Common Issues and Solutions

### Issue 1: High JavaScript Time

**Symptoms:**
- Yellow bars dominate Performance timeline
- Slow interaction response

**Causes:**
- Heavy filtering/sorting operations
- Unoptimized calculations
- Missing useMemo/useCallback

**Solutions:**
```
1. Check if calculations are memoized
2. Verify useCallback on handlers
3. Profile with React DevTools to find slow component
4. Check browser console for warnings
```

### Issue 2: Layout Shift (High CLS)

**Symptoms:**
- Content moves during load
- Visual instability

**Causes:**
- Images without dimensions
- Dynamic content insertion
- CSS changes during load

**Solutions:**
```
1. Verify card grid has fixed sizes
2. Check CSS for responsive issues
3. Ensure text content doesn't change size
4. Use CSS containment property
```

### Issue 3: Memory Leak

**Symptoms:**
- Memory keeps growing
- Doesn't return to baseline after GC
- > 50 detached DOM nodes

**Causes:**
- Event listeners not removed
- Circular references
- Modal/overlay not cleaned up

**Solutions:**
```
1. Check useEffect cleanup functions
2. Verify event listeners are removed
3. Look for detached DOM in heap snapshot
4. Review modal close handlers
```

### Issue 4: Jank During Mode Switch

**Symptoms:**
- Frame rate drops when pressing Alt+1/2/3
- Visible stutter
- > 50ms frame time

**Causes:**
- Too much rendering
- JavaScript blocking
- CSS animation issues

**Solutions:**
```
1. Check if animation is GPU-accelerated
2. Verify no heavy operations in render path
3. Use requestAnimationFrame for animations
4. Check CSS @keyframes for performance
```

## Performance Optimization Checklist

After profiling, check these items:

```
Render Performance:
- [ ] LCP < 1000ms
- [ ] TBT < 300ms
- [ ] CLS < 0.1
- [ ] FCP < 500ms
- [ ] No frame drops (red bars)

Memory:
- [ ] Baseline < 15MB
- [ ] After actions < 20MB
- [ ] No detached DOM > 10
- [ ] Memory returns after GC
- [ ] < 5 event listeners per component

Memoization:
- [ ] React.memo on list items
- [ ] useCallback on handlers
- [ ] useMemo on calculations
- [ ] Proper dependencies
- [ ] 40-60% re-render reduction

Keyboard:
- [ ] All 5 shortcuts work
- [ ] No browser conflicts
- [ ] Focus managed correctly
- [ ] Accessible keyboard navigation
- [ ] Cross-browser compatible
```

## Reports Template

### Performance Report

```markdown
## Dashboard Performance Report
Date: [Date]
Browser: [Browser]
Agents: [Count] | Buildings: [Count]

### Metrics
- FCP: [X]ms (Target: <500ms) ✅/❌
- LCP: [X]ms (Target: <1000ms) ✅/❌
- TBT: [X]ms (Target: <300ms) ✅/❌
- CLS: [X] (Target: <0.1) ✅/❌

### Memory
- Baseline: [X]MB
- Peak: [X]MB
- Delta: [X]MB (Target: <5MB) ✅/❌

### Issues Found
- [Issue 1]
- [Issue 2]

### Recommendations
- [Recommendation 1]
- [Recommendation 2]
```

## Quick Testing Checklist

Use this for rapid testing:

```
Performance (Alt+3 on Dashboard):
- [ ] Render < 100ms
- [ ] Memory delta < 5MB
- [ ] No jank (60fps)
- [ ] All cards visible

Shortcuts:
- [ ] Alt+1 → 2D works
- [ ] Alt+2 → 3D works
- [ ] Alt+3 → Dashboard works
- [ ] Alt+S → Sidebar toggle works
- [ ] Alt+R → Right panel toggle works

Browser Compatibility:
- [ ] Chrome works
- [ ] Firefox works
- [ ] Safari works
- [ ] Edge works
- [ ] No conflicts detected

Accessibility:
- [ ] Tab navigation works
- [ ] Focus visible
- [ ] Keyboard shortcuts work
- [ ] Screen reader compatible
```

## Next Steps

After profiling:

1. **Document Results** - Create performance report
2. **Identify Issues** - List any found problems
3. **Create Action Items** - Plan fixes needed
4. **Re-profile** - After fixes, measure improvement
5. **Archive Baseline** - Keep baseline metrics for comparison

