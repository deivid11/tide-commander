# Snapshots Button - Visibility Debug

## Issue
Snapshots button not visible on desktop view.

## Investigation Results

### ✅ Code is Correct
1. **React Component** (`FloatingActionButtons.tsx:57-64`)
   - Button is defined with correct className: `snapshots-toggle-btn`
   - onClick handler wired to `onOpenSnapshots` callback
   - Icon: 📸

2. **CSS** (`_snapshots.scss:979-1002`)
   - Position: `fixed`
   - Bottom: `280px` (stacked above Skills button at 238px)
   - Left: `16px` (aligned with other buttons)
   - Width/Height: `36px`
   - Display: `flex`
   - Z-index: `100`
   - Hover effects: Cyan color on hover

3. **CSS Import** (`main.scss:38`)
   - `@use 'components/snapshots'` is present

4. **Built CSS** (verified in dist/)
   - Minified CSS in dist/assets/main-*.css contains:
     - `snapshots-toggle-btn{position:fixed;bottom:280px;left:16px;...}`

### Mobile Responsiveness
- On mobile (≤768px): Button is hidden with `display: none !important`
- On desktop (>1024px): Button should be visible

## Likely Cause
**Browser Cache**: The old CSS might be cached in your browser.

## Solution
Hard refresh your browser to clear the cache:
- **Chrome/Firefox/Edge**: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
- **Safari**: `Cmd+Option+R`

## If Still Not Visible

1. **Check viewport width**: The button is positioned on the left side. Make sure your browser window is wider than 768px (desktop breakpoint).

2. **Check browser console** for any errors:
   - Open DevTools (F12)
   - Go to Console tab
   - Look for any error messages

3. **Inspect the element**:
   - Right-click in browser
   - Select "Inspect"
   - Look for `.snapshots-toggle-btn` element
   - Check if it has CSS applied

## Button Stack (Left Side)
The snapshots button is in a vertical stack of buttons on the left side:

```
Bottom 70px   → Settings ⚙️
Bottom 112px  → Commander 🎖️
Bottom 154px  → Supervisor 🎖️
Bottom 196px  → Shortcuts ⌨️
Bottom 238px  → Skills ⭐
Bottom 280px  → Snapshots 📸  ← NEW
```

## Files Modified
- `src/packages/client/components/FloatingActionButtons.tsx` - Added snapshots button to component
- `src/packages/client/styles/components/_snapshots.scss` - Updated CSS positioning

## Build Status
✅ Build successful
✅ CSS minified and included in dist/

## Next Steps
1. Hard refresh browser (`Ctrl+Shift+R`)
2. Check if button is now visible on the left sidebar
3. If still not visible, check browser console for errors
4. Verify viewport width is > 768px
