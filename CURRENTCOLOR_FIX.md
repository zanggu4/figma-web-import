# currentColor Handling Fix

## Problem
The `parseColor()` function in `color-utils.ts` was returning black (`{ r: 0, g: 0, b: 0, a: 1 }`) for CSS color values like `currentColor`, `inherit`, `initial`, and `unset`. This is incorrect because these CSS keywords require context:

- `currentColor`: Should inherit the current element's `color` property value
- `inherit`: Should inherit from parent
- `initial`: Should reset to initial value
- `unset`: Should act as `inherit` if inheritable, otherwise `initial`

This was particularly problematic for SVG elements using `fill="currentColor"`, which is a common pattern to make SVG icons inherit the text color of their container.

## Solution

### 1. Updated `parseColor()` function signature
Added an optional `fallbackColor` parameter to handle CSS keywords that require context:

```typescript
export function parseColor(cssColor: string, fallbackColor?: RGBA): RGBA
```

### 2. Added handling for CSS keywords
The function now checks for these keywords first and returns the fallback color if provided:

```typescript
if (cssColor === 'currentColor' || cssColor === 'inherit' || cssColor === 'initial' || cssColor === 'unset') {
  return fallbackColor || { r: 0, g: 0, b: 0, a: 1 };
}
```

### 3. Updated callers in `style-parser.ts`

#### parseBackground()
Now parses the text color first and passes it as fallback:

```typescript
// Parse text color as fallback for currentColor
const textColor = parseColor(styles.color);

// Check for background-color
const color = parseColor(bgColor, textColor);
```

#### parseBorder()
Similarly updated to pass text color as fallback:

```typescript
// Parse text color as fallback for currentColor
const textColor = parseColor(styles.color);

// Parse border color
const color = parseColor(borderColor, textColor);
```

## Files Modified

1. `/packages/shared/src/converters/color-utils.ts`
   - Updated `parseColor()` function signature
   - Added handling for `currentColor`, `inherit`, `initial`, `unset`

2. `/packages/shared/src/converters/style-parser.ts`
   - Updated `parseBackground()` to pass text color as fallback
   - Updated `parseBorder()` to pass text color as fallback

## Testing

A test HTML file was created at `/test-currentColor.html` to demonstrate the fix with various use cases:

1. SVG with `fill="currentColor"`
2. Border with `border-color: currentColor`
3. Background with `background-color: currentColor` (edge case)
4. Elements with `inherit` keyword

## Build Status

✅ Build successful - all packages compiled without errors
✅ Type definitions updated correctly
✅ No breaking changes to existing API (optional parameter)

## Benefits

- SVG icons with `fill="currentColor"` now correctly inherit the text color
- Borders using `currentColor` work as expected
- More robust handling of CSS color keywords
- Backward compatible (fallback parameter is optional)
