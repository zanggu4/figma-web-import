import type { LayerMeta, CornerRadius, Paint as SharedPaint, RGBA } from '@figma-web-import/shared';

/**
 * Creates Figma nodes from LayerMeta structure
 */

export interface NodeFactoryOptions {
  /** Base X offset for positioning */
  offsetX?: number;
  /** Base Y offset for positioning */
  offsetY?: number;
  /** Parent frame to add nodes to */
  parent?: FrameNode | GroupNode | PageNode;
}

/**
 * Create a Figma node from LayerMeta with styles applied
 */
export async function createNodeWithStyles(
  layer: LayerMeta,
  options: NodeFactoryOptions = {}
): Promise<SceneNode> {
  const { offsetX = 0, offsetY = 0 } = options;

  // Handle SVG elements - create vector node from SVG string
  if (layer.svgString) {
    try {
      const svgNode = figma.createNodeFromSvg(layer.svgString);
      // Position the SVG node
      svgNode.x = layer.x + offsetX;
      svgNode.y = layer.y + offsetY;
      // Resize if needed
      if (layer.width > 0 && layer.height > 0) {
        svgNode.resize(layer.width, layer.height);
      }
      // Apply opacity
      if (layer.opacity !== undefined && layer.opacity < 1) {
        svgNode.opacity = layer.opacity;
      }
      return svgNode;
    } catch (err) {
      console.warn('Failed to create SVG node, falling back to frame:', err);
      // Fall through to normal frame creation
    }
  }

  let node: SceneNode;

  switch (layer.type) {
    case 'TEXT':
      node = await createTextNode(layer);
      break;
    case 'ELLIPSE':
      node = createEllipseNode(layer);
      break;
    case 'RECTANGLE':
      node = createRectangleNode(layer);
      break;
    case 'GROUP':
      node = await createGroupNode(layer, options);
      break;
    case 'FRAME':
    default:
      node = await createFrameNode(layer, options);
      break;
  }

  // Set position
  node.x = layer.x + offsetX;
  node.y = layer.y + offsetY;

  // Set common properties
  node.name = layer.name;
  node.visible = layer.visible;
  // Ensure opacity is in valid range 0-1
  node.opacity = Math.max(0, Math.min(1, layer.opacity));

  // Apply rotation from CSS transform
  if (layer.rotation !== undefined && layer.rotation !== 0) {
    node.rotation = layer.rotation;
  }

  // Check if this is an image element (has IMAGE fill)
  const hasImageFill = layer.fills.some(fill => fill.type === 'IMAGE');

  // Apply fills to nodes that support them
  // Skip TEXT nodes - their fills (text color) are set in createTextNode
  if ('fills' in node && layer.type !== 'TEXT') {
    if (layer.fills.length > 0) {
      node.fills = await convertFills(layer.fills);
    } else {
      // Explicitly set empty fills to remove Figma's default white background
      node.fills = [];
    }
  }

  // Apply strokes
  if ('strokes' in node && layer.strokes) {
    applyStrokes(node as GeometryMixin & MinimalStrokesMixin, layer.strokes);
  }

  // Apply effects
  if ('effects' in node && layer.effects.length > 0) {
    node.effects = convertEffects(layer.effects);
  }

  return node;
}

/**
 * Create a Frame node
 */
async function createFrameNode(layer: LayerMeta, options: NodeFactoryOptions): Promise<FrameNode> {
  const frame = figma.createFrame();

  // Set size
  frame.resize(Math.max(1, layer.width), Math.max(1, layer.height));

  // Set corner radius
  applyCornerRadius(frame, layer.cornerRadius);

  // Apply auto layout if present
  const hasAutoLayout = !!layer.autoLayout;
  if (hasAutoLayout) {
    applyAutoLayout(frame, layer.autoLayout);
  }

  // Set clipping - only clip if overflow is hidden and not using auto-layout
  // Auto-layout handles its own sizing, so clipsContent can interfere
  frame.clipsContent = layer.clipsContent;

  // Check if flex-grow values are uniform across non-absolute siblings
  const flexGrowValues = (layer.children || [])
    .filter(c => !c.isAbsolutelyPositioned && c.flexGrow && c.flexGrow > 0)
    .map(c => c.flexGrow!);
  const hasUniformFlexGrow = flexGrowValues.length > 0 &&
    flexGrowValues.every(v => Math.abs(v - flexGrowValues[0]) < 0.01);

  // Create children with styles - children coordinates are relative to parent frame
  for (const childMeta of layer.children) {
    // Absolutely positioned children should keep their positions
    // Only reset positions for non-absolute children in auto-layout frames
    const isAbsolute = childMeta.isAbsolutelyPositioned;
    const adjustedChild = (hasAutoLayout && !isAbsolute) ? resetChildPosition(childMeta) : childMeta;

    const childNode = await createNodeWithStyles(adjustedChild, {
      offsetX: 0,
      offsetY: 0,
      parent: frame,
    });
    frame.appendChild(childNode);

    // Handle auto-layout child properties
    if (hasAutoLayout && 'layoutSizingHorizontal' in childNode) {
      if (isAbsolute) {
        // Absolutely positioned elements are excluded from auto-layout flow
        (childNode as FrameNode).layoutPositioning = 'ABSOLUTE';
        // Re-set position after layoutPositioning change
        // Figma auto-layout overrides x/y when child is first appended
        childNode.x = childMeta.x;
        childNode.y = childMeta.y;
        // Set constraints for proper positioning
        if ('constraints' in childNode) {
          const isFullWidth = childMeta.width >= (layer.width * 0.9);
          (childNode as FrameNode).constraints = {
            horizontal: isFullWidth ? 'STRETCH' : 'MIN',
            vertical: 'MIN',
          };
        }
      } else {
        const hasFlexGrow = childMeta.flexGrow && childMeta.flexGrow > 0;
        const layoutMode = layer.autoLayout?.mode;
        const shouldStretchCrossAxis = layer.autoLayout?.counterAxisStretch;

        // For block (VERTICAL) layouts, children that are nearly full-width should FILL
        const parentContentWidth = layer.width -
          (layer.autoLayout?.paddingLeft || 0) - (layer.autoLayout?.paddingRight || 0);
        const childFillsWidth = parentContentWidth > 0 &&
          childMeta.width > parentContentWidth * 0.9;

        if (layoutMode === 'HORIZONTAL') {
          // Check if all flex-grow siblings have the same value
          // If different flex-grow values, use FIXED to preserve computed widths
          const useFlexFill = hasFlexGrow && hasUniformFlexGrow;
          // Single-line TEXT nodes should use HUG to maintain textAutoResize compatibility
          const isHugText = childNode.type === 'TEXT' &&
            (childNode as TextNode).textAutoResize === 'WIDTH_AND_HEIGHT';
          (childNode as FrameNode | TextNode).layoutSizingHorizontal = useFlexFill ? 'FILL' : (isHugText ? 'HUG' : 'FIXED');
          (childNode as FrameNode | TextNode).layoutSizingVertical = shouldStretchCrossAxis ? 'FILL' : (isHugText ? 'HUG' : 'FIXED');
        } else if (layoutMode === 'VERTICAL') {
          const isHugText = childNode.type === 'TEXT' &&
            (childNode as TextNode).textAutoResize === 'WIDTH_AND_HEIGHT';
          // In vertical layout, children that span ~full width should FILL horizontally
          (childNode as FrameNode | TextNode).layoutSizingHorizontal =
            (shouldStretchCrossAxis || childFillsWidth) ? 'FILL' : (isHugText ? 'HUG' : 'FIXED');
          (childNode as FrameNode | TextNode).layoutSizingVertical = hasFlexGrow ? 'FILL' : (isHugText ? 'HUG' : 'FIXED');
        } else {
          (childNode as FrameNode | TextNode).layoutSizingHorizontal = 'FIXED';
          (childNode as FrameNode | TextNode).layoutSizingVertical = 'FIXED';
        }
      }
    }
  }

  return frame;
}

/**
 * Create a Text node
 */
async function createTextNode(layer: LayerMeta): Promise<TextNode> {
  const text = figma.createText();

  // Always load Inter font first as fallback before doing anything with text
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

  // If we have characters, set them
  if (layer.characters) {
    const textStyles = layer.textStyles;
    let fontLoaded = false;
    let mappedFontFamily = 'Inter';

    // Try to load the specific font if available BEFORE setting any text properties
    if (textStyles) {
      // Map web font to Figma-compatible font
      mappedFontFamily = mapFontFamily(textStyles.fontFamily);
      const fontStyle = getFontStyle(textStyles.fontWeight, textStyles.fontStyle);

      // Try mapped font first, then original, then Inter fallback
      const fontsToTry = [
        { family: mappedFontFamily, style: fontStyle },
        { family: textStyles.fontFamily, style: fontStyle },
        { family: 'Inter', style: fontStyle },
        { family: 'Inter', style: 'Regular' },
      ];

      for (const font of fontsToTry) {
        try {
          await figma.loadFontAsync(font);
          mappedFontFamily = font.family;
          fontLoaded = true;
          break;
        } catch {
          // Try next font
        }
      }

      if (!fontLoaded) {
        console.warn(`Failed to load any font for ${textStyles.fontFamily}, using Inter fallback`);
        mappedFontFamily = 'Inter';
      }
    }

    // Set characters AFTER font is loaded
    text.characters = layer.characters;

    // Apply text properties if available
    if (textStyles) {
      // Apply font family and style
      if (fontLoaded) {
        text.fontName = {
          family: mappedFontFamily,
          style: getFontStyle(textStyles.fontWeight, textStyles.fontStyle),
        };
      }

      text.fontSize = textStyles.fontSize;
      text.textAlignHorizontal = textStyles.textAlign;

      // Line height
      if (textStyles.lineHeight === 'AUTO') {
        text.lineHeight = { unit: 'AUTO' };
      } else {
        text.lineHeight = { unit: 'PIXELS', value: textStyles.lineHeight };
      }

      // Letter spacing
      if (textStyles.letterSpacing !== 0) {
        text.letterSpacing = { unit: 'PIXELS', value: textStyles.letterSpacing };
      }

      // Text decoration
      if (textStyles.textDecoration !== 'NONE') {
        text.textDecoration = textStyles.textDecoration;
      }

      // Text case
      if (textStyles.textCase !== 'ORIGINAL') {
        text.textCase = textStyles.textCase;
      }

      // Apply fill color with proper RGB format
      // Clamp values to ensure they're in valid 0-1 range
      const clamp = (v: number) => Math.max(0, Math.min(1, v));
      text.fills = [
        {
          type: 'SOLID',
          color: {
            r: clamp(textStyles.color.r),
            g: clamp(textStyles.color.g),
            b: clamp(textStyles.color.b),
          },
          opacity: clamp(textStyles.color.a),
        },
      ] as SolidPaint[];
    } else {
      // Fallback text color when textStyles is missing (black)
      text.fills = [
        {
          type: 'SOLID',
          color: { r: 0, g: 0, b: 0 },
          opacity: 1,
        },
      ] as SolidPaint[];
    }

    // Apply mixed text styles (rich text segments)
    if (layer.textSegments && layer.textSegments.length > 0) {
      const clampSeg = (v: number) => Math.max(0, Math.min(1, v));
      for (const segment of layer.textSegments) {
        const start = segment.start;
        const end = Math.min(segment.end, text.characters.length);
        if (start >= end) continue;

        // Apply segment color if different from base
        if (segment.color) {
          text.setRangeFills(start, end, [{
            type: 'SOLID',
            color: {
              r: clampSeg(segment.color.r),
              g: clampSeg(segment.color.g),
              b: clampSeg(segment.color.b),
            },
            opacity: clampSeg(segment.color.a),
          }] as SolidPaint[]);
        }

        // Apply segment font weight / style if different from base
        if (segment.fontWeight !== undefined || segment.fontStyle !== undefined) {
          const segWeight = segment.fontWeight ?? textStyles?.fontWeight ?? 400;
          const segStyle = segment.fontStyle ?? textStyles?.fontStyle;
          const style = getFontStyle(segWeight, segStyle);
          try {
            await figma.loadFontAsync({ family: mappedFontFamily, style });
            text.setRangeFontName(start, end, { family: mappedFontFamily, style });
          } catch {
            // Font style not available, skip
          }
        }

        // Apply segment font size if different from base
        if (segment.fontSize !== undefined) {
          text.setRangeFontSize(start, end, segment.fontSize);
        }

        // Apply segment text decoration if different from base
        if (segment.textDecoration !== undefined) {
          text.setRangeTextDecoration(start, end, segment.textDecoration);
        }
      }
    }
  }

  // Set text auto-resize: smart classification
  // Single-line text (headings, buttons, labels) → Auto width (WIDTH_AND_HEIGHT)
  // Multi-line text (paragraphs, descriptions) → Auto height (HEIGHT) with fixed width
  const textWidth = layer.width;
  const textHeight = layer.height;
  const hasLineBreaks = layer.characters?.includes('\n') || false;
  const fontSize = layer.textStyles?.fontSize || 16;
  // Heuristic: if height > 1.8x fontSize, it's likely multi-line
  const isMultiLine = hasLineBreaks || (textHeight > fontSize * 1.8 && textWidth > 80);

  if (isMultiLine) {
    // Check if text only wraps at explicit \n (no word-wrapping needed)
    const explicitLineCount = (layer.characters?.split('\n').length || 1);
    const lineHeightPx = (layer.textStyles?.lineHeight !== 'AUTO' && typeof layer.textStyles?.lineHeight === 'number')
      ? layer.textStyles.lineHeight
      : fontSize * 1.2;
    const heightBasedLineCount = Math.max(1, Math.round(textHeight / lineHeightPx));

    if (hasLineBreaks && explicitLineCount >= heightBasedLineCount) {
      // Text only breaks at explicit \n - use auto width so each line sizes naturally
      // This prevents incorrect word-wrapping due to font metric differences
      text.textAutoResize = 'WIDTH_AND_HEIGHT';
    } else {
      // Word-wrapping text: fix width with buffer and let height auto-expand
      const widthBuffer = 10;
      text.resize(Math.max(1, textWidth + widthBuffer), Math.max(1, textHeight));
      text.textAutoResize = 'HEIGHT';
    }
  } else {
    // Single-line: auto width - text sizes itself naturally
    text.textAutoResize = 'WIDTH_AND_HEIGHT';
  }

  return text;
}

/**
 * Create a Rectangle node
 */
function createRectangleNode(layer: LayerMeta): RectangleNode {
  const rect = figma.createRectangle();

  // Set size
  rect.resize(Math.max(1, layer.width), Math.max(1, layer.height));

  // Set corner radius
  applyCornerRadius(rect, layer.cornerRadius);

  return rect;
}

/**
 * Create an Ellipse node
 */
function createEllipseNode(layer: LayerMeta): EllipseNode {
  const ellipse = figma.createEllipse();

  // Set size
  ellipse.resize(Math.max(1, layer.width), Math.max(1, layer.height));

  return ellipse;
}

/**
 * Create a Group node
 */
async function createGroupNode(layer: LayerMeta, options: NodeFactoryOptions): Promise<GroupNode> {
  // Create children first with styles - children use absolute positions for groups
  const children: SceneNode[] = [];
  for (const childMeta of layer.children) {
    const childNode = await createNodeWithStyles(childMeta, {
      offsetX: layer.x,
      offsetY: layer.y,
      parent: undefined,
    });
    children.push(childNode);
  }

  // Group requires at least one child
  if (children.length === 0) {
    // Create a dummy rectangle if no children
    const rect = figma.createRectangle();
    rect.resize(layer.width, layer.height);
    rect.x = layer.x;
    rect.y = layer.y;
    children.push(rect);
  }

  const group = figma.group(children, figma.currentPage);
  return group;
}

/**
 * Reset child position for auto-layout frames
 * When auto-layout is applied, direct children should start at (0,0)
 * because auto-layout handles positioning.
 * Note: Do NOT recursively reset grandchildren - they keep their
 * relative positions within their parent.
 */
function resetChildPosition(child: LayerMeta): LayerMeta {
  return {
    ...child,
    x: 0,
    y: 0,
    // DO NOT recursively reset - grandchildren keep their relative positions
  };
}

/**
 * Apply corner radius to a node
 */
function applyCornerRadius(
  node: FrameNode | RectangleNode,
  radius: number | CornerRadius
): void {
  if (typeof radius === 'number') {
    node.cornerRadius = radius;
  } else {
    node.topLeftRadius = radius.topLeft;
    node.topRightRadius = radius.topRight;
    node.bottomRightRadius = radius.bottomRight;
    node.bottomLeftRadius = radius.bottomLeft;
  }
}

/**
 * Apply auto layout to a frame
 */
function applyAutoLayout(frame: FrameNode, config: LayerMeta['autoLayout']): void {
  if (!config) return;

  frame.layoutMode = config.mode;
  frame.primaryAxisAlignItems = config.primaryAxisAlignItems;
  frame.counterAxisAlignItems = config.counterAxisAlignItems;
  frame.paddingTop = config.paddingTop;
  frame.paddingRight = config.paddingRight;
  frame.paddingBottom = config.paddingBottom;
  frame.paddingLeft = config.paddingLeft;
  frame.itemSpacing = config.itemSpacing;

  // Use FIXED sizing to preserve captured dimensions
  // AUTO would resize the frame based on children, breaking the layout
  frame.primaryAxisSizingMode = 'FIXED';
  frame.counterAxisSizingMode = 'FIXED';

  if (config.wrap) {
    frame.layoutWrap = 'WRAP';
  }
}

/**
 * Convert fills to Figma paints
 */
async function convertFills(fills: SharedPaint[]): Promise<Paint[]> {
  const figmaPaints: Paint[] = [];

  for (const fill of fills) {
    if (fill.type === 'SOLID') {
      figmaPaints.push({
        type: 'SOLID',
        color: {
          r: fill.color.r,
          g: fill.color.g,
          b: fill.color.b,
        },
        opacity: fill.color.a * (fill.opacity ?? 1),
        visible: fill.visible ?? true,
      } as SolidPaint);
    } else if (fill.type === 'GRADIENT_LINEAR' || fill.type === 'GRADIENT_RADIAL') {
      const gradientStops = fill.gradientStops.map((stop) => ({
        position: stop.position,
        color: {
          r: stop.color.r,
          g: stop.color.g,
          b: stop.color.b,
          a: stop.color.a,
        },
      }));

      // Calculate gradient transform from CSS angle
      const transform = cssAngleToFigmaTransform(fill.angle ?? 180);

      figmaPaints.push({
        type: fill.type,
        gradientStops,
        gradientTransform: transform,
        opacity: fill.opacity ?? 1,
        visible: fill.visible ?? true,
      } as Paint);
    } else if (fill.type === 'IMAGE') {
      const imageFill = fill as any;
      const imageUrl = imageFill.imageUrl;
      if (imageUrl && !imageUrl.startsWith('data:')) {
        try {
          const image = await figma.createImageAsync(imageUrl);
          figmaPaints.push({
            type: 'IMAGE',
            imageHash: image.hash,
            scaleMode: imageFill.scaleMode || 'FILL',
            opacity: fill.opacity ?? 1,
            visible: fill.visible ?? true,
          } as ImagePaint);
        } catch (err) {
          console.warn(`Failed to load image: ${imageUrl}`, err);
          // Fallback to gray placeholder
          figmaPaints.push({
            type: 'SOLID',
            color: { r: 0.92, g: 0.92, b: 0.92 },
            opacity: 1,
            visible: true,
          } as SolidPaint);
        }
      } else if (imageUrl?.startsWith('data:')) {
        // Handle data URIs - decode base64 to Uint8Array for reliable loading
        // Note: atob may not be available in Figma plugin sandbox
        try {
          const base64Match = imageUrl.match(/^data:image\/\w+;base64,(.+)$/);
          let image: Image;
          if (base64Match) {
            const bytes = decodeBase64ToUint8Array(base64Match[1]);
            image = figma.createImage(bytes);
          } else {
            image = await figma.createImageAsync(imageUrl);
          }
          figmaPaints.push({
            type: 'IMAGE',
            imageHash: image.hash,
            scaleMode: imageFill.scaleMode || 'FILL',
            opacity: fill.opacity ?? 1,
            visible: fill.visible ?? true,
          } as ImagePaint);
        } catch {
          figmaPaints.push({
            type: 'SOLID',
            color: { r: 0.92, g: 0.92, b: 0.92 },
            opacity: 1,
            visible: true,
          } as SolidPaint);
        }
      }
    }
  }

  return figmaPaints;
}

/**
 * Apply strokes to a node
 */
function applyStrokes(
  node: GeometryMixin & MinimalStrokesMixin,
  stroke: LayerMeta['strokes']
): void {
  if (!stroke) return;

  const strokePaint: SolidPaint = {
    type: 'SOLID',
    color: {
      r: stroke.color.r,
      g: stroke.color.g,
      b: stroke.color.b,
    },
    opacity: stroke.color.a,
    visible: true,
  };

  node.strokes = [strokePaint];
  node.strokeWeight = stroke.weight;

  // Apply individual stroke weights if asymmetric borders
  if (stroke.individualWeights && 'strokeTopWeight' in node) {
    const frameNode = node as FrameNode | RectangleNode;
    frameNode.strokeTopWeight = stroke.individualWeights.top;
    frameNode.strokeRightWeight = stroke.individualWeights.right;
    frameNode.strokeBottomWeight = stroke.individualWeights.bottom;
    frameNode.strokeLeftWeight = stroke.individualWeights.left;
  }

  if ('strokeAlign' in node) {
    (node as FrameNode | RectangleNode | EllipseNode).strokeAlign = stroke.position;
  }

  if (stroke.dashPattern && stroke.dashPattern.length > 0) {
    node.dashPattern = stroke.dashPattern;
  }
}

/**
 * Convert effects to Figma effects
 */
function convertEffects(effects: LayerMeta['effects']): Effect[] {
  const figmaEffects: Effect[] = [];

  for (const effect of effects) {
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      figmaEffects.push({
        type: effect.type,
        color: effect.color,
        offset: effect.offset,
        radius: effect.radius,
        spread: effect.spread ?? 0,
        visible: effect.visible ?? true,
        blendMode: 'NORMAL',
      } as DropShadowEffect | InnerShadowEffect);
    } else if (effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR') {
      figmaEffects.push({
        type: effect.type,
        radius: effect.radius,
        visible: effect.visible ?? true,
      } as BlurEffect);
    }
  }

  return figmaEffects;
}

/**
 * Map web fonts to Figma-compatible fonts
 * Many web fonts aren't available in Figma, so we map them to similar alternatives
 */
function mapFontFamily(webFont: string): string {
  const fontLower = webFont.toLowerCase();

  // Sans-serif mappings
  const sansSerifMap: Record<string, string> = {
    'arial': 'Inter',
    'helvetica': 'Inter',
    'helvetica neue': 'Inter',
    'system-ui': 'Inter',
    '-apple-system': 'Inter',
    'blinkmacsystemfont': 'Inter',
    'segoe ui': 'Inter',
    'roboto': 'Roboto',
    'open sans': 'Open Sans',
    'lato': 'Lato',
    'montserrat': 'Montserrat',
    'poppins': 'Poppins',
    'nunito': 'Nunito',
    'raleway': 'Raleway',
    'ubuntu': 'Ubuntu',
    'source sans pro': 'Source Sans Pro',
    'noto sans': 'Noto Sans',
    'noto sans kr': 'Noto Sans KR',
    'noto sans jp': 'Noto Sans JP',
    'pretendard': 'Pretendard',  // Korean font
    'spoqa han sans': 'Noto Sans KR',
    'spoqa han sans neo': 'Noto Sans KR',
  };

  // Serif mappings
  const serifMap: Record<string, string> = {
    'times': 'Times New Roman',
    'times new roman': 'Times New Roman',
    'georgia': 'Georgia',
    'playfair display': 'Playfair Display',
    'merriweather': 'Merriweather',
    'lora': 'Lora',
    'noto serif': 'Noto Serif',
  };

  // Monospace mappings
  const monoMap: Record<string, string> = {
    'courier': 'Roboto Mono',
    'courier new': 'Roboto Mono',
    'monaco': 'Roboto Mono',
    'menlo': 'Roboto Mono',
    'consolas': 'Roboto Mono',
    'source code pro': 'Source Code Pro',
    'fira code': 'Fira Code',
    'jetbrains mono': 'JetBrains Mono',
  };

  // Check mappings
  if (sansSerifMap[fontLower]) return sansSerifMap[fontLower];
  if (serifMap[fontLower]) return serifMap[fontLower];
  if (monoMap[fontLower]) return monoMap[fontLower];

  // Generic CSS font families
  if (fontLower === 'sans-serif' || fontLower === 'ui-sans-serif') return 'Inter';
  if (fontLower === 'serif' || fontLower === 'ui-serif') return 'Times New Roman';
  if (fontLower === 'monospace' || fontLower === 'ui-monospace') return 'Roboto Mono';
  if (fontLower === 'cursive') return 'Inter';
  if (fontLower === 'fantasy') return 'Inter';
  if (fontLower === 'ui-rounded') return 'Inter';

  // Return original if no mapping found (might work if font is in Figma)
  return webFont;
}

/**
 * Get font style from weight and italic style
 */
function getFontStyle(weight: number, fontStyle?: 'normal' | 'italic'): string {
  const isItalic = fontStyle === 'italic';

  // Determine base style from weight
  let baseStyle = '';
  if (weight <= 100) baseStyle = 'Thin';
  else if (weight <= 200) baseStyle = 'Extra Light';
  else if (weight <= 300) baseStyle = 'Light';
  else if (weight <= 400) baseStyle = 'Regular';
  else if (weight <= 500) baseStyle = 'Medium';
  else if (weight <= 600) baseStyle = 'Semi Bold';
  else if (weight <= 700) baseStyle = 'Bold';
  else if (weight <= 800) baseStyle = 'Extra Bold';
  else baseStyle = 'Black';

  // Add italic variant if needed
  if (isItalic) {
    // Handle special cases
    if (baseStyle === 'Regular') return 'Italic';
    return `${baseStyle} Italic`;
  }

  return baseStyle;
}

/**
 * Convert CSS gradient angle to Figma gradient transform matrix
 * CSS angles: 0deg = to top, 90deg = to right, 180deg = to bottom (default)
 * Figma uses a 2x3 affine transform matrix for gradients
 * The gradient line goes from (0,0) to (1,0) in gradient space,
 * and the transform maps this to the node's coordinate space (0-1 range)
 */
function cssAngleToFigmaTransform(angleDeg: number): [[number, number, number], [number, number, number]] {
  // CSS angle to radians (CSS 0deg = to top, clockwise)
  const angleRad = (angleDeg * Math.PI) / 180;

  // Direction vector (CSS angle is clockwise from top)
  const dx = Math.sin(angleRad);
  const dy = -Math.cos(angleRad);

  // Calculate start and end points in 0-1 space
  // Center is (0.5, 0.5), extend to edges
  const startX = 0.5 - dx * 0.5;
  const startY = 0.5 - dy * 0.5;
  const endX = 0.5 + dx * 0.5;
  const endY = 0.5 + dy * 0.5;

  // Figma's gradientTransform is a 2x3 matrix that maps:
  // (0,0) -> gradient start point
  // (1,0) -> gradient end point
  // The matrix is [a, b, tx; c, d, ty] where:
  // transformed_x = a*x + b*y + tx
  // transformed_y = c*x + d*y + ty
  const a = endX - startX;  // x scale/rotation
  const b = -(endY - startY);  // perpendicular x component
  const tx = startX;
  const c = endY - startY;  // y scale/rotation
  const d = (endX - startX);   // perpendicular y component
  const ty = startY;

  return [[a, b, tx], [c, d, ty]];
}

/**
 * Decode base64 string to Uint8Array without relying on atob
 * (atob may not be available in Figma plugin sandbox)
 */
function decodeBase64ToUint8Array(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }

  // Calculate output length accounting for padding
  let len = base64.length;
  while (len > 0 && base64[len - 1] === '=') len--;
  const bufferLength = Math.floor(len * 3 / 4);

  const bytes = new Uint8Array(bufferLength);
  let p = 0;

  for (let i = 0; i < base64.length; i += 4) {
    const e1 = lookup[base64.charCodeAt(i)];
    const e2 = lookup[base64.charCodeAt(i + 1)];
    const e3 = lookup[base64.charCodeAt(i + 2)];
    const e4 = lookup[base64.charCodeAt(i + 3)];

    bytes[p++] = (e1 << 2) | (e2 >> 4);
    if (p < bufferLength) bytes[p++] = ((e2 & 15) << 4) | (e3 >> 2);
    if (p < bufferLength) bytes[p++] = ((e3 & 3) << 6) | (e4 & 63);
  }

  return bytes;
}

// Legacy export for backward compatibility
export const createNode = createNodeWithStyles;
