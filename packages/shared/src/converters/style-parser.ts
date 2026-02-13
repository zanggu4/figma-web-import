import type {
  Paint,
  SolidPaint,
  GradientPaint,
  ImagePaint,
  StrokeConfig,
  Effect,
  ShadowEffect,
  CornerRadius,
  TextStyle,
  AutoLayoutConfig,
  RGBA,
} from '../types/layer-meta';
import { parseColor, parseGradient, isTransparent, isTransparentColorString } from './color-utils';

/**
 * Split multiple background-image values, respecting parentheses
 */
function splitBackgroundImages(bgImage: string): string[] {
  const images: string[] = [];
  let current = '';
  let parenDepth = 0;

  for (const char of bgImage) {
    if (char === '(') parenDepth++;
    if (char === ')') parenDepth--;

    if (char === ',' && parenDepth === 0) {
      if (current.trim()) {
        images.push(current.trim());
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    images.push(current.trim());
  }

  return images;
}

/**
 * Parse CSS background to Figma fills
 */
export function parseBackground(styles: CSSStyleDeclaration): Paint[] {
  const fills: Paint[] = [];

  // Parse text color as fallback for currentColor
  const textColor = parseColor(styles.color);

  // Check for background-image first (gradients and images)
  // If background-image exists, it covers background-color, so we skip the color
  const bgImage = styles.backgroundImage;
  let hasBackgroundImage = false;

  if (bgImage && bgImage !== 'none') {
    // Parse multiple background-image values
    // Need to handle comma separation while respecting parentheses (gradients contain commas)
    const bgImages = splitBackgroundImages(bgImage);

    for (const singleBg of bgImages) {
      const trimmedBg = singleBg.trim();
      if (trimmedBg.includes('url(')) {
        const urlMatch = trimmedBg.match(/url\(['"]?([^'")\s]+)['"]?\)/);
        if (urlMatch && urlMatch[1]) {
          hasBackgroundImage = true;
          // Resolve relative URLs to absolute using document.baseURI
          let imageUrl = urlMatch[1];
          try {
            if (typeof document !== 'undefined' && !imageUrl.startsWith('data:')) {
              imageUrl = new URL(imageUrl, document.baseURI || window.location.href).href;
            }
          } catch {
            // Keep original URL if resolution fails
          }
          // Map background-size to scaleMode
          const bgSize = styles.backgroundSize;
          let scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE' = 'FILL';
          if (bgSize === 'contain') {
            scaleMode = 'FIT';
          } else if (bgSize === 'cover') {
            scaleMode = 'FILL';
          }
          fills.push({
            type: 'IMAGE',
            imageUrl,
            scaleMode,
            opacity: 1,
            visible: true,
          } as ImagePaint);
        }
      } else {
        // Try parsing as gradient
        const gradient = parseGradient(trimmedBg);
        if (gradient) {
          hasBackgroundImage = true;
          fills.push({
            type: gradient.type === 'linear' ? 'GRADIENT_LINEAR' : 'GRADIENT_RADIAL',
            gradientStops: gradient.stops,
            angle: gradient.angle,
            opacity: 1,
            visible: true,
          } as GradientPaint);
        }
      }
    }
  }

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

  return fills;
}

/**
 * Parse CSS border to Figma strokes
 */
export function parseBorder(styles: CSSStyleDeclaration): StrokeConfig | null {
  // Parse text color as fallback for currentColor
  const textColor = parseColor(styles.color);

  // Always check individual border sides to correctly detect asymmetric borders
  // (e.g., border-t only). The shorthand borderWidth can be misleading when
  // only some sides have borders.
  const topWidth = parseFloat(styles.borderTopWidth as string) || 0;
  const rightWidth = parseFloat(styles.borderRightWidth as string) || 0;
  const bottomWidth = parseFloat(styles.borderBottomWidth as string) || 0;
  const leftWidth = parseFloat(styles.borderLeftWidth as string) || 0;

  // Check if any side has a border
  const maxWidth = Math.max(topWidth, rightWidth, bottomWidth, leftWidth);
  if (maxWidth > 0) {
    // Get color from any side that has width
    const colorStr = styles.borderTopColor || styles.borderRightColor || styles.borderBottomColor || styles.borderLeftColor;
    const borderStyle = styles.borderTopStyle || styles.borderRightStyle || styles.borderBottomStyle || styles.borderLeftStyle;

    if (colorStr && borderStyle !== 'none') {
      const color = parseColor(colorStr, textColor);
      if (!isTransparent(color)) {
        const allSame = topWidth === rightWidth && rightWidth === bottomWidth && bottomWidth === leftWidth;

        return {
          color,
          weight: maxWidth,
          position: 'INSIDE',
          dashPattern: borderStyle === 'dashed' ? [maxWidth * 2, maxWidth] : undefined,
          individualWeights: allSame ? undefined : {
            top: topWidth,
            right: rightWidth,
            bottom: bottomWidth,
            left: leftWidth,
          },
        };
      }
    }
  }

  return null;
}

/**
 * Parse CSS box-shadow to Figma effects
 */
export function parseBoxShadow(styles: CSSStyleDeclaration): Effect[] {
  const effects: Effect[] = [];
  const boxShadow = styles.boxShadow;

  if (!boxShadow || boxShadow === 'none') {
    return effects;
  }

  // Parse multiple shadows (comma-separated)
  const shadowParts = splitShadows(boxShadow);

  for (const shadowStr of shadowParts) {
    const shadow = parseSingleShadow(shadowStr);
    if (shadow) {
      effects.push(shadow);
    }
  }

  return effects;
}

function splitShadows(boxShadow: string): string[] {
  const shadows: string[] = [];
  let current = '';
  let parenDepth = 0;

  for (const char of boxShadow) {
    if (char === '(') parenDepth++;
    if (char === ')') parenDepth--;

    if (char === ',' && parenDepth === 0) {
      shadows.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    shadows.push(current.trim());
  }

  return shadows;
}

function parseSingleShadow(shadowStr: string): ShadowEffect | null {
  const isInset = shadowStr.includes('inset');
  let cleanShadow = shadowStr.replace('inset', '').trim();

  // Extract color first (rgba, rgb, hex, or named color)
  let color: RGBA = { r: 0, g: 0, b: 0, a: 0.25 };

  // Handle rgba/rgb with spaces inside parentheses
  const rgbaMatch = cleanShadow.match(/rgba?\s*\([^)]+\)/);
  if (rgbaMatch) {
    color = parseColor(rgbaMatch[0]);
    // Remove the color from the string so we don't parse its numbers
    cleanShadow = cleanShadow.replace(rgbaMatch[0], '').trim();
  } else {
    // Check for hex or named color at start or end
    const hexMatch = cleanShadow.match(/#[a-fA-F0-9]{3,8}/);
    if (hexMatch) {
      color = parseColor(hexMatch[0]);
      cleanShadow = cleanShadow.replace(hexMatch[0], '').trim();
    } else {
      // Named color (usually at the end)
      const namedMatch = cleanShadow.match(/\b(transparent|white|black|red|green|blue|gray|grey)\b/i);
      if (namedMatch) {
        color = parseColor(namedMatch[0]);
        cleanShadow = cleanShadow.replace(namedMatch[0], '').trim();
      }
    }
  }

  // Now parse numeric values (x, y, blur, spread) from remaining string
  const numbers: number[] = [];
  const numMatches = cleanShadow.match(/-?\d+(?:\.\d+)?(?:px)?/g);
  if (numMatches) {
    for (const match of numMatches) {
      numbers.push(parseFloat(match));
    }
  }

  if (numbers.length < 2) {
    return null;
  }

  return {
    type: isInset ? 'INNER_SHADOW' : 'DROP_SHADOW',
    color,
    offset: {
      x: numbers[0] || 0,
      y: numbers[1] || 0,
    },
    radius: numbers[2] || 0,
    spread: numbers[3] || 0,
    visible: true,
  };
}

/**
 * Parse CSS text-shadow to Figma effects
 */
export function parseTextShadow(styles: CSSStyleDeclaration): Effect[] {
  const effects: Effect[] = [];
  const textShadow = styles.textShadow;

  if (!textShadow || textShadow === 'none') {
    return effects;
  }

  // Parse multiple shadows (comma-separated)
  const shadowParts = splitShadows(textShadow);

  for (const shadowStr of shadowParts) {
    const shadow = parseSingleTextShadow(shadowStr);
    if (shadow) {
      effects.push(shadow);
    }
  }

  return effects;
}

function parseSingleTextShadow(shadowStr: string): ShadowEffect | null {
  // Text shadow format: h-shadow v-shadow blur-radius color
  // No spread or inset for text-shadow

  let cleanShadow = shadowStr.trim();
  let color: RGBA = { r: 0, g: 0, b: 0, a: 0.25 };

  // Extract color first (rgba, rgb, hex, or named color)
  const rgbaMatch = cleanShadow.match(/rgba?\s*\([^)]+\)/);
  if (rgbaMatch) {
    color = parseColor(rgbaMatch[0]);
    cleanShadow = cleanShadow.replace(rgbaMatch[0], '').trim();
  } else {
    const hexMatch = cleanShadow.match(/#[a-fA-F0-9]{3,8}/);
    if (hexMatch) {
      color = parseColor(hexMatch[0]);
      cleanShadow = cleanShadow.replace(hexMatch[0], '').trim();
    } else {
      const namedMatch = cleanShadow.match(/\b(transparent|white|black|red|green|blue|gray|grey)\b/i);
      if (namedMatch) {
        color = parseColor(namedMatch[0]);
        cleanShadow = cleanShadow.replace(namedMatch[0], '').trim();
      }
    }
  }

  // Parse numeric values from remaining string
  const numbers: number[] = [];
  const numMatches = cleanShadow.match(/-?\d+(?:\.\d+)?(?:px)?/g);
  if (numMatches) {
    for (const match of numMatches) {
      numbers.push(parseFloat(match));
    }
  }

  if (numbers.length < 2) {
    return null;
  }

  return {
    type: 'DROP_SHADOW',
    color,
    offset: {
      x: numbers[0] || 0,
      y: numbers[1] || 0,
    },
    radius: numbers[2] || 0,
    spread: 0, // Text shadows don't have spread
    visible: true,
  };
}

/**
 * Parse CSS border-radius to Figma corner radius
 */
export function parseBorderRadius(styles: CSSStyleDeclaration): number | CornerRadius {
  const topLeft = parseFloat(styles.borderTopLeftRadius) || 0;
  const topRight = parseFloat(styles.borderTopRightRadius) || 0;
  const bottomRight = parseFloat(styles.borderBottomRightRadius) || 0;
  const bottomLeft = parseFloat(styles.borderBottomLeftRadius) || 0;

  // If all corners are equal, return single value
  if (topLeft === topRight && topRight === bottomRight && bottomRight === bottomLeft) {
    return topLeft;
  }

  return {
    topLeft,
    topRight,
    bottomRight,
    bottomLeft,
  };
}

/**
 * Parse CSS text styles to Figma text style
 */
export function parseTextStyle(styles: CSSStyleDeclaration): TextStyle {
  const fontWeight = parseFontWeight(styles.fontWeight);
  const lineHeight = parseLineHeight(styles.lineHeight, styles.fontSize);
  const letterSpacing = parseLetterSpacing(styles.letterSpacing, styles.fontSize);
  const fontStyle = parseFontStyle(styles.fontStyle);

  return {
    fontFamily: parseFontFamily(styles.fontFamily),
    fontWeight,
    fontStyle,
    fontSize: parseFloat(styles.fontSize) || 16,
    lineHeight,
    letterSpacing,
    textAlign: parseTextAlign(styles.textAlign),
    textDecoration: parseTextDecoration(styles.textDecoration),
    textCase: parseTextTransform(styles.textTransform),
    color: parseColor(styles.color),
  };
}

function parseFontFamily(fontFamily: string): string {
  // Extract first font family, removing quotes
  const match = fontFamily.match(/^["']?([^"',]+)["']?/);
  return match ? match[1].trim() : 'Inter';
}

function parseFontWeight(weight: string): number {
  const numWeight = parseInt(weight, 10);
  if (!isNaN(numWeight)) {
    return numWeight;
  }

  const weightMap: Record<string, number> = {
    thin: 100,
    hairline: 100,
    extralight: 200,
    'ultra-light': 200,
    light: 300,
    normal: 400,
    regular: 400,
    medium: 500,
    semibold: 600,
    'semi-bold': 600,
    bold: 700,
    extrabold: 800,
    'extra-bold': 800,
    'ultra-bold': 800,
    black: 900,
    heavy: 900,
  };

  return weightMap[weight.toLowerCase()] || 400;
}

function parseFontStyle(fontStyle: string): 'normal' | 'italic' {
  return fontStyle === 'italic' || fontStyle === 'oblique' ? 'italic' : 'normal';
}

function parseLineHeight(lineHeight: string, fontSize: string): number | 'AUTO' {
  if (lineHeight === 'normal') {
    // 'normal' is typically 1.2x font size in browsers
    // Using explicit pixel value ensures consistent layout in Figma
    const fs = parseFloat(fontSize) || 16;
    return Math.round(fs * 1.2 * 100) / 100;
  }

  const lh = parseFloat(lineHeight);
  if (isNaN(lh)) {
    return 'AUTO';
  }

  // If lineHeight is in px, return it directly
  if (lineHeight.includes('px')) {
    return lh;
  }

  // If it's a ratio, multiply by font size
  const fs = parseFloat(fontSize) || 16;
  return lh * fs;
}

function parseLetterSpacing(letterSpacing: string, fontSize: string): number {
  if (letterSpacing === 'normal') {
    return 0;
  }

  const ls = parseFloat(letterSpacing);
  if (isNaN(ls)) {
    return 0;
  }

  // If in em, convert to px
  if (letterSpacing.includes('em')) {
    const fs = parseFloat(fontSize) || 16;
    return ls * fs;
  }

  return ls;
}

function parseTextAlign(textAlign: string): 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED' {
  switch (textAlign) {
    case 'center':
      return 'CENTER';
    case 'right':
    case 'end':
      return 'RIGHT';
    case 'justify':
      return 'JUSTIFIED';
    default:
      return 'LEFT';
  }
}

function parseTextDecoration(textDecoration: string): 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH' {
  if (textDecoration.includes('underline')) {
    return 'UNDERLINE';
  }
  if (textDecoration.includes('line-through')) {
    return 'STRIKETHROUGH';
  }
  return 'NONE';
}

function parseTextTransform(textTransform: string): 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE' {
  switch (textTransform) {
    case 'uppercase':
      return 'UPPER';
    case 'lowercase':
      return 'LOWER';
    case 'capitalize':
      return 'TITLE';
    default:
      return 'ORIGINAL';
  }
}

/**
 * Parse CSS flexbox to Figma auto layout
 */
export function parseAutoLayout(styles: CSSStyleDeclaration): AutoLayoutConfig | undefined {
  const display = styles.display;
  const flexDirection = styles.flexDirection;
  const position = styles.position;

  // Don't apply auto layout to absolutely positioned elements
  if (position === 'absolute' || position === 'fixed') {
    return undefined;
  }

  // Check for CSS Grid and convert to nested auto-layout
  if (display === 'grid' || display === 'inline-grid') {
    return parseGridAsAutoLayout(styles);
  }

  // Common padding values for all layout types
  const paddingTop = parseFloat(styles.paddingTop) || 0;
  const paddingRight = parseFloat(styles.paddingRight) || 0;
  const paddingBottom = parseFloat(styles.paddingBottom) || 0;
  const paddingLeft = parseFloat(styles.paddingLeft) || 0;

  // Flex containers
  if (display === 'flex' || display === 'inline-flex') {
    const isVertical = flexDirection === 'column' || flexDirection === 'column-reverse';
    const alignItems = styles.alignItems;
    const isStretch = alignItems === 'stretch';

    return {
      mode: isVertical ? 'VERTICAL' : 'HORIZONTAL',
      primaryAxisAlignItems: parseJustifyContent(styles.justifyContent),
      counterAxisAlignItems: parseAlignItems(alignItems),
      paddingTop,
      paddingRight,
      paddingBottom,
      paddingLeft,
      itemSpacing: parseGap(styles.gap),
      primaryAxisSizingMode: 'AUTO',
      counterAxisSizingMode: 'AUTO',
      wrap: styles.flexWrap === 'wrap',
      counterAxisStretch: isStretch || undefined,
    };
  }

  // Block-level elements → VERTICAL auto-layout (children stack top-to-bottom)
  if (display === 'block' || display === 'list-item' || display === 'flow-root' ||
      display === 'table' || display === 'table-row-group' || display === 'table-row') {
    // text-align: center on block containers → center cross-axis alignment in Figma
    // This handles CSS patterns like text-center, mx-auto children
    const textAlign = styles.textAlign;
    const counterAlign = textAlign === 'center' ? 'CENTER' : 'MIN';
    return {
      mode: 'VERTICAL',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: counterAlign,
      paddingTop,
      paddingRight,
      paddingBottom,
      paddingLeft,
      itemSpacing: 0, // Will be overridden by actual child gap calculation in dom-to-layer
      primaryAxisSizingMode: 'AUTO',
      counterAxisSizingMode: 'AUTO',
    };
  }

  // Inline-block / inline elements with children → HORIZONTAL auto-layout
  if (display === 'inline-block' || display === 'inline' || display === 'table-cell') {
    return {
      mode: 'HORIZONTAL',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'CENTER',
      paddingTop,
      paddingRight,
      paddingBottom,
      paddingLeft,
      itemSpacing: 0,
      primaryAxisSizingMode: 'AUTO',
      counterAxisSizingMode: 'AUTO',
    };
  }

  return undefined;
}

function parseJustifyContent(
  justify: string
): 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' {
  switch (justify) {
    case 'center':
      return 'CENTER';
    case 'flex-end':
    case 'end':
      return 'MAX';
    case 'space-between':
    case 'space-around':
    case 'space-evenly':
      return 'SPACE_BETWEEN';
    case 'flex-start':
    case 'start':
      return 'MIN';
    default:
      // Default CSS value is 'flex-start'
      return 'MIN';
  }
}

function parseAlignItems(align: string): 'MIN' | 'CENTER' | 'MAX' | 'BASELINE' {
  switch (align) {
    case 'center':
      return 'CENTER';
    case 'flex-end':
    case 'end':
      return 'MAX';
    case 'baseline':
      return 'BASELINE';
    case 'stretch':
    case 'normal':
      // When stretch, children fill the cross-axis (handled by counterAxisStretch)
      // Alignment defaults to MIN (flex-start) as fallback
      return 'MIN';
    case 'flex-start':
    case 'start':
      return 'MIN';
    default:
      return 'MIN';
  }
}

function parseGap(gap: string): number {
  if (!gap || gap === 'normal') {
    return 0;
  }

  // Handle single value (row/column gap same)
  const values = gap.split(/\s+/);
  return parseFloat(values[0]) || 0;
}

/**
 * Parse CSS Grid as auto-layout with wrap
 * Multi-column grids become HORIZONTAL with WRAP
 */
function parseGridAsAutoLayout(styles: CSSStyleDeclaration): AutoLayoutConfig | undefined {
  // Detect if grid has multiple columns
  const gridTemplateColumns = styles.gridTemplateColumns;
  const columnCount = gridTemplateColumns && gridTemplateColumns !== 'none'
    ? gridTemplateColumns.split(/\s+/).filter(v => v && v !== 'none').length
    : 1;
  const hasMultipleColumns = columnCount > 1;

  // Multi-column grids use HORIZONTAL with WRAP
  // Single column or row-based grids use VERTICAL
  const isHorizontal = hasMultipleColumns;

  // Parse gap (column-gap for horizontal, row-gap for vertical)
  const columnGap = parseFloat(styles.columnGap) || 0;
  const rowGap = parseFloat(styles.rowGap) || 0;
  const gap = parseFloat(styles.gap) || 0;
  const itemSpacing = isHorizontal ? (columnGap || gap) : (rowGap || gap);

  return {
    mode: isHorizontal ? 'HORIZONTAL' : 'VERTICAL',
    primaryAxisAlignItems: parseGridJustifyContent(styles.justifyContent || styles.justifyItems),
    counterAxisAlignItems: parseGridAlignItems(
      (styles.alignContent && styles.alignContent !== 'normal' && styles.alignContent !== 'stretch')
        ? styles.alignContent : styles.alignItems
    ),
    paddingTop: parseFloat(styles.paddingTop) || 0,
    paddingRight: parseFloat(styles.paddingRight) || 0,
    paddingBottom: parseFloat(styles.paddingBottom) || 0,
    paddingLeft: parseFloat(styles.paddingLeft) || 0,
    itemSpacing,
    primaryAxisSizingMode: 'AUTO',
    counterAxisSizingMode: 'AUTO',
    wrap: isHorizontal, // Enable wrap for horizontal grids
  };
}

function parseGridJustifyContent(justify: string): 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' {
  switch (justify) {
    case 'center':
      return 'CENTER';
    case 'end':
    case 'flex-end':
      return 'MAX';
    case 'space-between':
      return 'SPACE_BETWEEN';
    default:
      return 'MIN';
  }
}

function parseGridAlignItems(align: string): 'MIN' | 'CENTER' | 'MAX' | 'BASELINE' {
  switch (align) {
    case 'center':
      return 'CENTER';
    case 'end':
    case 'flex-end':
      return 'MAX';
    case 'baseline':
      return 'BASELINE';
    default:
      return 'MIN';
  }
}

function parseGridGap(gap: string): number {
  if (!gap || gap === 'normal') {
    return 0;
  }
  return parseFloat(gap) || 0;
}

/**
 * Parse CSS opacity
 */
export function parseOpacity(styles: CSSStyleDeclaration): number {
  const opacity = parseFloat(styles.opacity);
  return isNaN(opacity) ? 1 : opacity;
}

/**
 * Check if element is visible
 */
export function isVisible(styles: CSSStyleDeclaration): boolean {
  return (
    styles.display !== 'none' &&
    styles.visibility !== 'hidden' &&
    parseOpacity(styles) > 0
  );
}

/**
 * Check if element is absolutely positioned
 */
export function isAbsolutelyPositioned(styles: CSSStyleDeclaration): boolean {
  const position = styles.position;
  return position === 'absolute' || position === 'fixed';
}

/**
 * Parse CSS filter and backdrop-filter to Figma effects
 */
export function parseFilters(styles: CSSStyleDeclaration): Effect[] {
  const effects: Effect[] = [];

  // Parse filter: blur()
  const filter = styles.filter;
  if (filter && filter !== 'none') {
    const blurMatch = filter.match(/blur\((\d+(?:\.\d+)?)(px)?\)/);
    if (blurMatch) {
      effects.push({
        type: 'LAYER_BLUR',
        radius: parseFloat(blurMatch[1]),
        visible: true,
      });
    }

    // Parse filter: drop-shadow(x y blur color)
    const dropShadowMatch = filter.match(/drop-shadow\(([^)]+)\)/);
    if (dropShadowMatch) {
      const shadowStr = dropShadowMatch[1].trim();
      const parts = shadowStr.split(/\s+/);

      // Extract numeric values (x, y, blur)
      const numbers: number[] = [];
      let colorStr = '';

      for (const part of parts) {
        const num = parseFloat(part);
        if (!isNaN(num)) {
          numbers.push(num);
        } else if (part.startsWith('rgb') || part.startsWith('#') || /^[a-z]+$/i.test(part)) {
          colorStr += part;
        }
      }

      // Handle rgba() that got split
      const rgbaMatch = shadowStr.match(/rgba?\([^)]+\)/);
      let color: RGBA = { r: 0, g: 0, b: 0, a: 0.25 };
      if (rgbaMatch) {
        color = parseColor(rgbaMatch[0]);
      } else if (colorStr) {
        color = parseColor(colorStr);
      }

      if (numbers.length >= 2) {
        effects.push({
          type: 'DROP_SHADOW',
          color,
          offset: {
            x: numbers[0] || 0,
            y: numbers[1] || 0,
          },
          radius: numbers[2] || 0,
          spread: 0, // drop-shadow doesn't support spread
          visible: true,
        });
      }
    }
  }

  // Parse backdrop-filter: blur()
  const backdropFilter = styles.backdropFilter || (styles as any).webkitBackdropFilter;
  if (backdropFilter && backdropFilter !== 'none') {
    const blurMatch = backdropFilter.match(/blur\((\d+(?:\.\d+)?)(px)?\)/);
    if (blurMatch) {
      effects.push({
        type: 'BACKGROUND_BLUR',
        radius: parseFloat(blurMatch[1]),
        visible: true,
      });
    }
  }

  return effects;
}
