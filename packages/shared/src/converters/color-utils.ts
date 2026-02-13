import type { RGB, RGBA, GradientStop } from '../types/layer-meta';

/**
 * Convert HSL to RGB
 */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: r + m, g: g + m, b: b + m };
}

/**
 * Common CSS named colors
 */
const namedColors: Record<string, RGBA> = {
  white: { r: 1, g: 1, b: 1, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  red: { r: 1, g: 0, b: 0, a: 1 },
  green: { r: 0, g: 0.502, b: 0, a: 1 },
  blue: { r: 0, g: 0, b: 1, a: 1 },
  gray: { r: 0.502, g: 0.502, b: 0.502, a: 1 },
  grey: { r: 0.502, g: 0.502, b: 0.502, a: 1 },
  yellow: { r: 1, g: 1, b: 0, a: 1 },
  orange: { r: 1, g: 0.647, b: 0, a: 1 },
  purple: { r: 0.502, g: 0, b: 0.502, a: 1 },
  pink: { r: 1, g: 0.753, b: 0.796, a: 1 },
  cyan: { r: 0, g: 1, b: 1, a: 1 },
  magenta: { r: 1, g: 0, b: 1, a: 1 },
  brown: { r: 0.647, g: 0.165, b: 0.165, a: 1 },
  navy: { r: 0, g: 0, b: 0.502, a: 1 },
  teal: { r: 0, g: 0.502, b: 0.502, a: 1 },
  silver: { r: 0.753, g: 0.753, b: 0.753, a: 1 },
  maroon: { r: 0.502, g: 0, b: 0, a: 1 },
  olive: { r: 0.502, g: 0.502, b: 0, a: 1 },
  lime: { r: 0, g: 1, b: 0, a: 1 },
  aqua: { r: 0, g: 1, b: 1, a: 1 },
  fuchsia: { r: 1, g: 0, b: 1, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
};

/**
 * Clamp a value between 0 and 1
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Parse CSS color string to RGBA
 */
export function parseColor(cssColor: string, fallbackColor?: RGBA): RGBA {
  // Handle CSS keywords that require context
  // 'currentColor' - inherits from parent's color property
  // 'inherit' - inherits from parent
  // 'initial' - resets to initial value (typically black for most color properties)
  // 'unset' - acts as inherit if inheritable, initial otherwise
  if (cssColor === 'currentColor' || cssColor === 'inherit' || cssColor === 'initial' || cssColor === 'unset') {
    return fallbackColor || { r: 0, g: 0, b: 0, a: 1 };
  }

  // Handle transparent
  if (cssColor === 'transparent' || cssColor === 'rgba(0, 0, 0, 0)') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  // Handle rgb/rgba - support both comma-separated and space-separated modern syntax
  // Traditional: rgb(255, 255, 255) or rgba(255, 255, 255, 1) or rgba(255, 255, 255, 100%)
  // Modern: rgb(255 255 255) or rgb(255 255 255 / 1) or rgb(255 255 255 / 100%)
  const rgbaCommaMatch = cssColor.match(
    /rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d+(?:\.\d+)?)(%?))?\s*\)/
  );
  if (rgbaCommaMatch) {
    let alpha = 1;
    if (rgbaCommaMatch[4] !== undefined) {
      alpha = parseFloat(rgbaCommaMatch[4]);
      // If percentage (has % sign), convert from 0-100 to 0-1
      if (rgbaCommaMatch[5] === '%') {
        alpha = alpha / 100;
      }
    }
    return {
      r: clamp01(parseFloat(rgbaCommaMatch[1]) / 255),
      g: clamp01(parseFloat(rgbaCommaMatch[2]) / 255),
      b: clamp01(parseFloat(rgbaCommaMatch[3]) / 255),
      a: clamp01(alpha),
    };
  }

  // Modern space-separated syntax: rgb(255 255 255) or rgb(255 255 255 / 0.5) or rgb(255 255 255 / 50%)
  const rgbaSpaceMatch = cssColor.match(
    /rgba?\(\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?)(%?))?\s*\)/
  );
  if (rgbaSpaceMatch) {
    let alpha = 1;
    if (rgbaSpaceMatch[4] !== undefined) {
      alpha = parseFloat(rgbaSpaceMatch[4]);
      // If percentage (has % sign), convert from 0-100 to 0-1
      if (rgbaSpaceMatch[5] === '%') {
        alpha = alpha / 100;
      }
    }
    return {
      r: clamp01(parseFloat(rgbaSpaceMatch[1]) / 255),
      g: clamp01(parseFloat(rgbaSpaceMatch[2]) / 255),
      b: clamp01(parseFloat(rgbaSpaceMatch[3]) / 255),
      a: clamp01(alpha),
    };
  }

  // Handle hsl/hsla
  const hslMatch = cssColor.match(/hsla?\((\d+),\s*(\d+)%,\s*(\d+)%(?:,\s*([\d.]+))?\)/);
  if (hslMatch) {
    const rgb = hslToRgb(parseFloat(hslMatch[1]), parseFloat(hslMatch[2]), parseFloat(hslMatch[3]));
    return { ...rgb, a: hslMatch[4] !== undefined ? parseFloat(hslMatch[4]) : 1 };
  }

  // Handle hex colors
  const hexMatch = cssColor.match(/^#([a-fA-F0-9]{3,8})$/);
  if (hexMatch) {
    return parseHexColor(hexMatch[1]);
  }

  // Handle named colors
  const lowerColor = cssColor.toLowerCase();
  if (lowerColor in namedColors) {
    return namedColors[lowerColor];
  }

  // Default to black
  return { r: 0, g: 0, b: 0, a: 1 };
}

/**
 * Parse hex color to RGBA
 */
function parseHexColor(hex: string): RGBA {
  let r: number, g: number, b: number, a: number = 1;

  if (hex.length === 3) {
    // #RGB
    r = parseInt(hex[0] + hex[0], 16) / 255;
    g = parseInt(hex[1] + hex[1], 16) / 255;
    b = parseInt(hex[2] + hex[2], 16) / 255;
  } else if (hex.length === 4) {
    // #RGBA
    r = parseInt(hex[0] + hex[0], 16) / 255;
    g = parseInt(hex[1] + hex[1], 16) / 255;
    b = parseInt(hex[2] + hex[2], 16) / 255;
    a = parseInt(hex[3] + hex[3], 16) / 255;
  } else if (hex.length === 6) {
    // #RRGGBB
    r = parseInt(hex.substring(0, 2), 16) / 255;
    g = parseInt(hex.substring(2, 4), 16) / 255;
    b = parseInt(hex.substring(4, 6), 16) / 255;
  } else if (hex.length === 8) {
    // #RRGGBBAA
    r = parseInt(hex.substring(0, 2), 16) / 255;
    g = parseInt(hex.substring(2, 4), 16) / 255;
    b = parseInt(hex.substring(4, 6), 16) / 255;
    a = parseInt(hex.substring(6, 8), 16) / 255;
  } else {
    return { r: 0, g: 0, b: 0, a: 1 };
  }

  return { r, g, b, a };
}

/**
 * Convert RGBA to CSS rgb/rgba string
 */
export function rgbaToCSS(color: RGBA): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);

  if (color.a === 1) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${color.a})`;
}

/**
 * Convert RGBA to hex string
 */
export function rgbaToHex(color: RGBA, includeAlpha = false): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');

  if (includeAlpha && color.a < 1) {
    const a = Math.round(color.a * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}${a}`;
  }
  return `#${r}${g}${b}`;
}

/**
 * Extract content between balanced parentheses
 */
function extractBalancedParens(str: string, startIndex: number): string {
  let depth = 1;
  let i = startIndex;
  while (i < str.length && depth > 0) {
    if (str[i] === '(') depth++;
    if (str[i] === ')') depth--;
    i++;
  }
  return str.substring(startIndex, i - 1);
}

/**
 * Parse CSS gradient to gradient stops
 */
export function parseGradient(
  cssGradient: string
): { type: 'linear' | 'radial'; stops: GradientStop[]; angle?: number } | null {
  // Linear gradient
  const linearStart = cssGradient.indexOf('linear-gradient(');
  if (linearStart !== -1) {
    const content = extractBalancedParens(cssGradient, linearStart + 16);
    return {
      type: 'linear',
      stops: parseGradientStops(content),
      angle: parseGradientAngle(content),
    };
  }

  // Radial gradient
  const radialStart = cssGradient.indexOf('radial-gradient(');
  if (radialStart !== -1) {
    const content = extractBalancedParens(cssGradient, radialStart + 16);
    return {
      type: 'radial',
      stops: parseGradientStops(content),
    };
  }

  return null;
}

function parseGradientAngle(content: string): number {
  const angleMatch = content.match(/(\d+)deg/);
  if (angleMatch) {
    return parseInt(angleMatch[1], 10);
  }

  // Handle direction keywords
  if (content.includes('to right')) return 90;
  if (content.includes('to left')) return 270;
  if (content.includes('to bottom')) return 180;
  if (content.includes('to top')) return 0;

  return 180; // Default: top to bottom
}

/**
 * Extract a color value with balanced parentheses from a position in the string
 */
function extractColorValue(str: string, startPos: number): string {
  let i = startPos;

  // Skip whitespace
  while (i < str.length && /\s/.test(str[i])) {
    i++;
  }

  // Check if it's a function (rgba, rgb, hsla, hsl)
  if (str.substring(i).match(/^(rgba?|hsla?)\(/)) {
    const funcMatch = str.substring(i).match(/^(rgba?|hsla?)\(/);
    if (funcMatch) {
      const funcStart = i + funcMatch[0].length;
      let depth = 1;
      let j = funcStart;
      while (j < str.length && depth > 0) {
        if (str[j] === '(') depth++;
        if (str[j] === ')') depth--;
        j++;
      }
      return str.substring(i, j);
    }
  }

  // Otherwise, match hex color or named color
  const match = str.substring(i).match(/^(#[a-fA-F0-9]+|\w+)/);
  return match ? match[1] : '';
}

function parseGradientStops(content: string): GradientStop[] {
  const stops: GradientStop[] = [];

  // Remove angle/direction part
  const colorPart = content.replace(/^[^,]+,\s*/, '');

  let i = 0;
  while (i < colorPart.length) {
    // Skip whitespace and commas
    while (i < colorPart.length && /[\s,]/.test(colorPart[i])) {
      i++;
    }

    if (i >= colorPart.length) break;

    // Extract color value
    const colorValue = extractColorValue(colorPart, i);
    if (!colorValue) break;

    i += colorValue.length;

    // Skip whitespace
    while (i < colorPart.length && /\s/.test(colorPart[i])) {
      i++;
    }

    // Check for position (e.g., "50%", "0.5")
    let position: number | null = null;
    const posMatch = colorPart.substring(i).match(/^(\d+(?:\.\d+)?%?)/);
    if (posMatch) {
      const posStr = posMatch[1];
      position = posStr.endsWith('%')
        ? parseFloat(posStr) / 100
        : parseFloat(posStr);
      i += posMatch[0].length;
    }

    const color = parseColor(colorValue);
    const autoPosition = stops.length;
    stops.push({
      position: position ?? -1, // Use -1 to mark auto-generated positions
      color,
    });

    // Store whether this was auto-generated for normalization
    if (position === null) {
      (stops[stops.length - 1] as any)._autoGenerated = true;
      (stops[stops.length - 1] as any)._autoIndex = autoPosition;
    }
  }

  // Normalize auto-generated positions
  if (stops.length > 1) {
    const autoGenerated = stops.filter((s: any) => s._autoGenerated);
    if (autoGenerated.length > 0) {
      stops.forEach((stop: any, idx) => {
        if (stop._autoGenerated) {
          stop.position = idx / (stops.length - 1);
          delete stop._autoGenerated;
          delete stop._autoIndex;
        }
      });
    }
  }

  return stops;
}

/**
 * Check if color is effectively transparent
 */
export function isTransparent(color: RGBA): boolean {
  // Alpha 0 means fully transparent
  return color.a <= 0;
}

/**
 * Check if a CSS color string represents a transparent color
 */
export function isTransparentColorString(cssColor: string): boolean {
  if (!cssColor) return true;

  const normalized = cssColor.toLowerCase().replace(/\s+/g, '');

  // Explicit transparent keyword
  if (normalized === 'transparent') return true;

  // rgba with alpha 0: rgba(r,g,b,0) or rgba(r g b / 0)
  // Match any rgba/rgb with alpha 0 or 0%
  const rgbaMatch = normalized.match(/rgba?\([\d.]+[,\s/]+[\d.]+[,\s/]+[\d.]+[,\s/]+(0|0?\.0+|0%)\)/);
  if (rgbaMatch) return true;

  // Modern syntax: rgb(r g b / 0) or rgb(r g b / 0%)
  if (normalized.match(/rgba?\([^)]+\/\s*(0|0?\.0+|0%)\)/)) return true;

  // Check for specific transparent rgba values
  if (normalized === 'rgba(0,0,0,0)') return true;
  if (normalized.startsWith('rgba(') && normalized.endsWith(',0)')) return true;

  return false;
}

/**
 * Blend two colors with given opacity
 */
export function blendColors(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a + bottom.a * (1 - top.a);

  if (a === 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  return {
    r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a,
    g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a,
    b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a,
    a,
  };
}
