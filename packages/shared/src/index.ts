// Types
export type {
  LayerMeta,
  LayerType,
  CaptureData,
  Paint,
  PaintType,
  SolidPaint,
  GradientPaint,
  ImagePaint,
  GradientStop,
  RGB,
  RGBA,
  StrokeConfig,
  Effect,
  EffectType,
  ShadowEffect,
  BlurEffect,
  CornerRadius,
  TextStyle,
  TextSegment,
  AutoLayoutConfig,
} from './types/layer-meta';

// Color utilities
export {
  parseColor,
  rgbaToCSS,
  rgbaToHex,
  parseGradient,
  isTransparent,
  blendColors,
} from './converters/color-utils';

// Style parser
export {
  parseBackground,
  parseBorder,
  parseBoxShadow,
  parseTextShadow,
  parseBorderRadius,
  parseTextStyle,
  parseAutoLayout,
  parseOpacity,
  isVisible,
  isAbsolutelyPositioned,
} from './converters/style-parser';

// DOM to Layer converter
export {
  domToLayer,
  captureDocument,
  captureElement,
  type ConversionOptions,
} from './converters/dom-to-layer';

// Version constant
export const VERSION = '0.0.1';
