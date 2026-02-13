# Overlay Transparency Fix

## Problem
The `bg-black/50` Tailwind CSS class (which generates `rgba(0,0,0,0.5)`) was not rendering correctly in Figma when used in certain scenarios. The hero section overlay should have a semi-transparent dark overlay over the background image.

## Root Cause
The issue was in the `parseBackground` function in `/packages/shared/src/converters/style-parser.ts`. The function had logic that would skip parsing `background-color` if a `background-image` was present on the same element:

```typescript
// OLD CODE (INCORRECT)
if (!hasBackgroundImage) {
  const bgColor = styles.backgroundColor;
  // Only parse background-color if NO background-image
  ...
}
```

This caused problems in the following scenario:
```html
<div class="bg-image bg-black/50">
  <!-- Both background-image and background-color on same element -->
</div>
```

In this case, the `background-color` (the overlay) was completely ignored, resulting in no semi-transparent overlay being rendered in Figma.

## Solution
Modified the `parseBackground` function to **always** parse both `background-image` and `background-color` when present, regardless of whether they coexist on the same element:

```typescript
// NEW CODE (CORRECT)
// Add background-color
// In CSS, background-color shows behind background-image, so we parse both
// In Figma, fills array is ordered with the last fill rendering on bottom
const bgColor = styles.backgroundColor;
if (bgColor && !isTransparentColorString(bgColor)) {
  const color = parseColor(bgColor, textColor);
  if (!isTransparent(color)) {
    fills.push({
      type: 'SOLID',
      color,
      opacity: 1,
      visible: true,
    } as SolidPaint);
  }
}
```

## How It Works

### CSS Background Layering
In CSS, when you have both `background-image` and `background-color`:
- `background-image` renders **on top** (frontmost)
- `background-color` renders **below** (backmost)

### Figma Fill Ordering
In Figma, the fills array is ordered where:
- `fills[0]` renders **on top** (frontmost)
- `fills[1]` renders **below** (backmost)

### Our Implementation
The code now correctly:
1. Parses `background-image` first and adds to `fills[0]` (on top)
2. Parses `background-color` second and adds to `fills[1]` (below)

This matches CSS behavior!

### Opacity Handling
The complete flow for `rgba(0, 0, 0, 0.5)`:
1. `parseColor('rgba(0, 0, 0, 0.5)')` → `{r: 0, g: 0, b: 0, a: 0.5}`
2. Creates fill: `{type: 'SOLID', color: {r:0, g:0, b:0, a:0.5}, opacity: 1}`
3. `convertFills` computes final opacity: `0.5 * 1 = 0.5`
4. Final Figma paint: `{type: 'SOLID', color: {r:0, g:0, b:0}, opacity: 0.5}`

## Test Cases

### Scenario 1: Overlay as Separate Element (Works Before & After)
```html
<div class="bg-image">
  <div class="bg-black/50">
    <!-- Overlay -->
  </div>
</div>
```
- Before fix: ✓ Works (no background-image on overlay element)
- After fix: ✓ Works (no change)

### Scenario 2: Overlay on Same Element (Fixed)
```html
<div class="bg-image bg-black/50">
  <!-- Both on same element -->
</div>
```
- Before fix: ✗ Broken (background-color ignored)
- After fix: ✓ Works (both fills parsed)

### Scenario 3: Different Opacity Levels
```html
<div class="bg-black/25">25% overlay</div>
<div class="bg-black/50">50% overlay</div>
<div class="bg-black/75">75% overlay</div>
```
- Before fix: ✓ Works
- After fix: ✓ Works

## Files Modified
- `/packages/shared/src/converters/style-parser.ts` - Fixed parseBackground function

## Verification
All tests pass:
- ✓ Semi-transparent overlay parsing
- ✓ Element with both background-image and background-color
- ✓ Different opacity levels (25%, 50%, 75%)
- ✓ Modern CSS syntax (space-separated)
- ✓ Fully transparent backgrounds filtered out
- ✓ Figma paint conversion with correct opacity
- ✓ RGB values preserved, alpha separated to opacity

## Build Status
✓ All packages build successfully
✓ No compilation errors
✓ All type checks pass
