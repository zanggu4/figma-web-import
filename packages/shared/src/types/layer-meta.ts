/**
 * Core data structure representing a design layer that can be converted to Figma
 */

// Paint types for fills and strokes
export type PaintType = 'SOLID' | 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'IMAGE';

export interface SolidPaint {
  type: 'SOLID';
  color: RGBA;
  opacity?: number;
  visible?: boolean;
}

export interface GradientStop {
  position: number;
  color: RGBA;
}

export interface GradientPaint {
  type: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL';
  gradientStops: GradientStop[];
  angle?: number; // CSS angle in degrees (0=to top, 90=to right, 180=to bottom)
  opacity?: number;
  visible?: boolean;
}

export interface ImagePaint {
  type: 'IMAGE';
  imageUrl: string;
  scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE';
  opacity?: number;
  visible?: boolean;
}

export type Paint = SolidPaint | GradientPaint | ImagePaint;

// Color types
export interface RGB {
  r: number; // 0-1
  g: number; // 0-1
  b: number; // 0-1
}

export interface RGBA extends RGB {
  a: number; // 0-1
}

// Stroke configuration
export interface StrokeConfig {
  color: RGBA;
  weight: number;
  position: 'INSIDE' | 'OUTSIDE' | 'CENTER';
  dashPattern?: number[];
  // Individual border side weights (when borders are asymmetric)
  individualWeights?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

// Effect types
export type EffectType = 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR';

export interface ShadowEffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW';
  color: RGBA;
  offset: { x: number; y: number };
  radius: number;
  spread?: number;
  visible?: boolean;
}

export interface BlurEffect {
  type: 'LAYER_BLUR' | 'BACKGROUND_BLUR';
  radius: number;
  visible?: boolean;
}

export type Effect = ShadowEffect | BlurEffect;

// Corner radius
export interface CornerRadius {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

// Rich text segment (inline styled range)
export interface TextSegment {
  text: string;
  start: number;  // character offset
  end: number;    // character offset
  color?: RGBA;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fontSize?: number;
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
}

// Text styling
export interface TextStyle {
  fontFamily: string;
  fontWeight: number;
  fontStyle?: 'normal' | 'italic';
  fontSize: number;
  lineHeight: number | 'AUTO';
  letterSpacing: number;
  textAlign: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  textDecoration: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  textCase: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE';
  color: RGBA;
}

// Auto Layout configuration
export interface AutoLayoutConfig {
  mode: 'HORIZONTAL' | 'VERTICAL';
  primaryAxisAlignItems: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  itemSpacing: number;
  primaryAxisSizingMode: 'FIXED' | 'AUTO';
  counterAxisSizingMode: 'FIXED' | 'AUTO';
  wrap?: boolean;
  // CSS align-items: stretch - children should fill cross-axis
  counterAxisStretch?: boolean;
}

// Layer types
export type LayerType = 'FRAME' | 'TEXT' | 'RECTANGLE' | 'ELLIPSE' | 'GROUP';

/**
 * Main interface representing a captured DOM element as a design layer
 */
export interface LayerMeta {
  // Identity
  type: LayerType;
  name: string;

  // Position & Size
  x: number;
  y: number;
  width: number;
  height: number;

  // Visual Styles
  fills: Paint[];
  strokes: StrokeConfig | null;
  effects: Effect[];
  cornerRadius: number | CornerRadius;
  opacity: number;
  visible: boolean;
  clipsContent: boolean;

  // Text-specific (only for TEXT type)
  characters?: string;
  textStyles?: TextStyle;
  textSegments?: TextSegment[];

  // Layout
  autoLayout?: AutoLayoutConfig;

  // Positioning
  isAbsolutelyPositioned?: boolean;  // position: absolute or fixed
  zIndex?: number;  // for stacking order
  flexGrow?: number;  // flex-grow value for auto-layout sizing
  rotation?: number;  // CSS transform rotation in degrees

  // Children
  children: LayerMeta[];

  // Asset references
  imageUrl?: string;
  svgString?: string;

  // Source metadata (for debugging)
  sourceElement?: {
    tagName: string;
    id?: string;
    className?: string;
  };
}

/**
 * Root structure for clipboard data transfer
 */
export interface CaptureData {
  version: string;
  capturedAt: string;
  sourceUrl: string;
  viewport: {
    width: number;
    height: number;
  };
  root: LayerMeta;
}
