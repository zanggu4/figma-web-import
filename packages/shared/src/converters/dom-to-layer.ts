import type { LayerMeta, LayerType, ImagePaint, TextSegment } from '../types/layer-meta';
import {
  parseBackground,
  parseBorder,
  parseBoxShadow,
  parseBorderRadius,
  parseTextStyle,
  parseAutoLayout,
  parseOpacity,
  isVisible,
  parseFilters,
  parseTextShadow,
} from './style-parser';
import { parseColor } from './color-utils';

/**
 * Options for DOM to LayerMeta conversion
 */
export interface ConversionOptions {
  /** Include hidden elements */
  includeHidden?: boolean;
  /** Maximum depth to traverse */
  maxDepth?: number;
  /** Root element offset for relative positioning */
  rootOffset?: { x: number; y: number };
  /** Capture images as URLs */
  captureImages?: boolean;
}

const DEFAULT_OPTIONS: Required<ConversionOptions> = {
  includeHidden: false,
  maxDepth: 50,
  rootOffset: { x: 0, y: 0 },
  captureImages: true,
};

/**
 * Convert a DOM element to LayerMeta structure
 */
export function domToLayer(
  element: Element,
  options: ConversionOptions = {}
): LayerMeta | null {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return convertElement(element, opts, 0);
}

function convertElement(
  element: Element,
  options: Required<ConversionOptions>,
  depth: number
): LayerMeta | null {
  if (depth > options.maxDepth) {
    return null;
  }

  // Skip script, style, and other non-visual elements
  const tagName = element.tagName.toLowerCase();
  if (isNonVisualElement(tagName)) {
    return null;
  }

  const styles = window.getComputedStyle(element);

  // Skip hidden elements unless explicitly included
  if (!options.includeHidden && !isVisible(styles)) {
    return null;
  }

  const rect = element.getBoundingClientRect();

  // Skip zero-size elements
  if (rect.width === 0 && rect.height === 0) {
    return null;
  }

  // Determine layer type
  const type = determineLayerType(element, styles);

  // Check for absolute/fixed/sticky positioning
  const position = styles.position;
  const isFixed = position === 'fixed';
  const isSticky = position === 'sticky';
  // Fixed and absolute are absolutely positioned in Figma
  // Sticky elements should also be treated as absolute in Figma (they overlay content)
  const isAbsolute = position === 'absolute' || isFixed || isSticky;

  // Parse z-index for stacking order
  const zIndexValue = parseInt(styles.zIndex, 10);
  const zIndex = isNaN(zIndexValue) ? 0 : zIndexValue;

  // Parse flex-grow for layout sizing
  const flexGrowValue = parseFloat(styles.flexGrow);
  const flexGrow = !isNaN(flexGrowValue) && flexGrowValue > 0 ? flexGrowValue : undefined;

  // Create base layer
  const layer: LayerMeta = {
    type,
    name: generateLayerName(element),
    // Fixed/sticky elements: position relative to parent (x from parent offset, y=0 for top-fixed)
    x: (isFixed || isSticky) ? (rect.left - options.rootOffset.x) : (rect.left - options.rootOffset.x),
    y: (isFixed || isSticky) ? 0 : (rect.top - options.rootOffset.y),
    width: rect.width,
    height: rect.height,
    fills: parseBackground(styles),
    strokes: parseBorder(styles),
    effects: [...parseBoxShadow(styles), ...parseFilters(styles)],
    cornerRadius: parseBorderRadius(styles),
    opacity: parseOpacity(styles),
    visible: true,
    clipsContent: styles.overflow === 'hidden' || styles.overflow === 'clip',
    isAbsolutelyPositioned: isAbsolute || undefined,
    // Fixed/sticky elements get high z-index to stay on top
    zIndex: (isFixed || isSticky) ? Math.max(zIndex, 1000) : (zIndex !== 0 ? zIndex : undefined),
    rotation: parseRotation(styles.transform),
    flexGrow,
    children: [],
    sourceElement: {
      tagName: element.tagName,
      id: element.id || undefined,
      className: element.getAttribute('class') || undefined,
    },
  };

  // Handle native form controls (checkbox, radio) that don't expose styles via getComputedStyle
  if (element.tagName === 'INPUT') {
    const inputType = (element as HTMLInputElement).type;
    if ((inputType === 'checkbox' || inputType === 'radio') &&
        styles.appearance !== 'none' &&
        layer.fills.length === 0 && !layer.strokes) {
      // Add default checkbox/radio visual styling since native rendering isn't captured
      layer.fills = [{
        type: 'SOLID' as const,
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true,
      }];
      layer.strokes = {
        color: { r: 0.796, g: 0.835, b: 0.882, a: 1 }, // slate-300 equivalent
        weight: 1.5,
        position: 'INSIDE' as const,
      };
      layer.cornerRadius = inputType === 'radio'
        ? Math.min(layer.width, layer.height) / 2  // Fully rounded for radio
        : 4; // rounded for checkbox
      // Ensure minimum visible size
      if (layer.width < 16) layer.width = 20;
      if (layer.height < 16) layer.height = 20;
    }
  }

  // Expand flex child width to max-width if applicable
  // In flex containers, children shrink to content size, but max-width indicates intended width
  if (element.parentElement) {
    const parentDisplay = window.getComputedStyle(element.parentElement).display;
    if (parentDisplay === 'flex' || parentDisplay === 'inline-flex') {
      const maxWidth = styles.maxWidth;
      if (maxWidth && maxWidth !== 'none') {
        const maxW = parseFloat(maxWidth);
        if (!isNaN(maxW) && maxW > layer.width && maxW <= layer.width * 3) {
          layer.width = maxW;
        }
      }
    }
  }

  // Handle text content
  if (type === 'TEXT') {
    const textContent = getDirectTextContent(element);
    if (textContent) {
      layer.characters = textContent;
      layer.textStyles = parseTextStyle(styles);
      layer.textSegments = captureTextSegments(element);
      // Add text shadows to effects
      layer.effects = [...layer.effects, ...parseTextShadow(styles)];
    }
  }

  // Capture SVG as string for vector node creation in Figma
  if (tagName === 'svg') {
    const svgString = sanitizeSvg(element as SVGElement, styles);
    if (svgString) {
      layer.svgString = svgString;
      // SVG elements shouldn't process children normally since we have the full SVG
      layer.children = [];
      return layer;
    }
  }

  // Handle images
  if (tagName === 'img' && options.captureImages) {
    const imgSrc = (element as HTMLImageElement).src;
    if (imgSrc) {
      layer.imageUrl = imgSrc;
      // Map CSS object-fit to Figma scaleMode
      const objectFit = styles.objectFit;
      let scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE' = 'FILL';
      switch (objectFit) {
        case 'cover':
          scaleMode = 'FILL';
          break;
        case 'contain':
        case 'scale-down':
          scaleMode = 'FIT';
          break;
        case 'fill':
          scaleMode = 'CROP';
          break;
        case 'none':
          scaleMode = 'CROP';
          break;
        default:
          scaleMode = 'FILL';
      }
      layer.fills = [
        {
          type: 'IMAGE',
          imageUrl: imgSrc,
          scaleMode,
          opacity: 1,
          visible: true,
        } as ImagePaint,
      ];
    }
  }

  // Handle auto layout
  const autoLayout = parseAutoLayout(styles);
  if (autoLayout) {
    layer.autoLayout = autoLayout;
  }

  // Process children
  if (type !== 'TEXT') {
    const children: LayerMeta[] = [];

    // Children should be positioned relative to parent, not root
    const childOptions = {
      ...options,
      rootOffset: { x: rect.left, y: rect.top },
    };

    // First pass: detect fixed elements at top to calculate offset
    let fixedTopHeight = 0;
    for (const child of element.children) {
      const childStyles = window.getComputedStyle(child);
      const childPos = childStyles.position;
      if (childPos === 'fixed' || childPos === 'sticky') {
        const childRect = child.getBoundingClientRect();
        // Only count fixed elements at top (y near 0)
        if (childRect.top < 100) {
          fixedTopHeight = Math.max(fixedTopHeight, childRect.height);
        }
      }
    }

    for (const child of element.children) {
      const childLayer = convertElement(child, childOptions, depth + 1);
      if (childLayer) {
        // Adjust non-fixed content to account for fixed header
        // This makes content start at y=0 instead of y=headerHeight
        if (!childLayer.isAbsolutelyPositioned && fixedTopHeight > 0) {
          // Only adjust if the element's y is close to fixedTopHeight
          if (Math.abs(childLayer.y - fixedTopHeight) < 20) {
            childLayer.y = 0;
          } else if (childLayer.y > fixedTopHeight) {
            childLayer.y -= fixedTopHeight;
          }
        }
        children.push(childLayer);
      }
    }

    // For FRAME elements with direct text content (like buttons, links),
    // create a TEXT child to hold the text
    const directText = children.length === 0
      ? getDirectTextContent(element)
      : getDirectTextNodesOnly(element);
    if (directText) {
      // Calculate content area (subtract padding for proper text sizing)
      const paddingTop = parseFloat(styles.paddingTop) || 0;
      const paddingRight = parseFloat(styles.paddingRight) || 0;
      const paddingBottom = parseFloat(styles.paddingBottom) || 0;
      const paddingLeft = parseFloat(styles.paddingLeft) || 0;
      const contentWidth = rect.width - paddingLeft - paddingRight;
      const contentHeight = rect.height - paddingTop - paddingBottom;

      // Text-only frames (no element children) should override to HORIZONTAL auto-layout
      const isTextOnly = children.length === 0 ||
        children.every(c => c.sourceElement?.tagName === '::before' || c.sourceElement?.tagName === '::after');
      if (isTextOnly) {
        const textAlign = styles.textAlign;
        const primaryAlign = textAlign === 'center' ? 'CENTER' : textAlign === 'right' ? 'MAX' : 'MIN';
        const existingAL = layer.autoLayout;
        layer.autoLayout = {
          mode: 'HORIZONTAL',
          primaryAxisAlignItems: primaryAlign,
          counterAxisAlignItems: 'CENTER',
          paddingTop: existingAL?.paddingTop ?? paddingTop,
          paddingRight: existingAL?.paddingRight ?? paddingRight,
          paddingBottom: existingAL?.paddingBottom ?? paddingBottom,
          paddingLeft: existingAL?.paddingLeft ?? paddingLeft,
          itemSpacing: 0,
          primaryAxisSizingMode: 'FIXED',
          counterAxisSizingMode: 'FIXED',
        };
      }

      // Measure text width from direct text nodes using Range API
      let textWidth = contentWidth;
      let textHeight = contentHeight;
      let textX = 0;
      let textY = 0;
      if (!isTextOnly) {
        // For mixed content (icon + text), measure only the text node width
        for (const child of element.childNodes) {
          if (child.nodeType === Node.TEXT_NODE && (child.textContent?.trim() || '').length > 0) {
            const range = document.createRange();
            range.selectNodeContents(child);
            const textRect = range.getBoundingClientRect();
            textWidth = textRect.width || contentWidth;
            textHeight = textRect.height || contentHeight;
            textX = textRect.left - rect.left - paddingLeft;
            textY = textRect.top - rect.top - paddingTop;
            break;
          }
        }
      }

      const textChild: LayerMeta = {
        type: 'TEXT',
        name: directText.slice(0, 20) + (directText.length > 20 ? '...' : ''),
        x: textX,
        y: textY,
        width: Math.max(1, textWidth),
        height: Math.max(1, textHeight),
        fills: [],
        strokes: null,
        effects: parseTextShadow(styles),
        cornerRadius: 0,
        opacity: 1,
        visible: true,
        clipsContent: false,
        characters: directText,
        textStyles: parseTextStyle(styles),
        textSegments: isTextOnly ? captureTextSegments(element) : undefined,
        children: [],
      };
      children.push(textChild);
    }

    // Sort children by z-index for proper stacking order
    // In Figma, later children appear on top, so sort ascending by z-index
    children.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

    // Capture pseudo-elements
    const beforeElement = capturePseudoElement(element, '::before', rect);
    if (beforeElement) {
      children.unshift(beforeElement); // Prepend ::before
    }

    const afterElement = capturePseudoElement(element, '::after', rect);
    if (afterElement) {
      children.push(afterElement); // Append ::after
    }

    // Calculate itemSpacing from actual child positions if auto-layout is active
    if (layer.autoLayout && children.length >= 2) {
      const flowChildren = children.filter(c => !c.isAbsolutelyPositioned);
      if (flowChildren.length >= 2) {
        const gaps: number[] = [];
        const isVertical = layer.autoLayout.mode === 'VERTICAL';

        for (let i = 0; i < flowChildren.length - 1; i++) {
          const curr = flowChildren[i];
          const next = flowChildren[i + 1];
          const gap = isVertical
            ? (next.y - (curr.y + curr.height))
            : (next.x - (curr.x + curr.width));
          gaps.push(Math.round(Math.max(0, gap)));
        }

        if (gaps.length > 0) {
          const display = styles.display;
          const isFlexOrGrid = display === 'flex' || display === 'inline-flex' ||
                               display === 'grid' || display === 'inline-grid';

          if (isFlexOrGrid) {
            // For flex/grid, trust the CSS gap value (already set by parseAutoLayout)
            // Only override if actual gaps differ significantly from CSS gap
            const cssGap = layer.autoLayout.itemSpacing;
            const avgGap = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
            if (Math.abs(avgGap - cssGap) > 4) {
              layer.autoLayout.itemSpacing = avgGap;
            }
          } else {
            // Block layout: check gap consistency
            const minGap = Math.min(...gaps);
            const maxGap = Math.max(...gaps);
            const GAP_TOLERANCE = 4; // px
            const avgGap = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);

            if (maxGap - minGap <= GAP_TOLERANCE) {
              // Consistent gaps - use average
              layer.autoLayout.itemSpacing = avgGap;
            } else {
              // Inconsistent gaps: use minGap as itemSpacing,
              // wrap children that need extra spacing in a transparent frame
              layer.autoLayout.itemSpacing = minGap;

              // Build a map of flow child index → gap after it
              const flowChildGaps = new Map<LayerMeta, number>();
              for (let gi = 0; gi < flowChildren.length - 1; gi++) {
                flowChildGaps.set(flowChildren[gi], gaps[gi]);
              }

              // Wrap children that have gaps larger than minGap
              for (let ci = 0; ci < children.length; ci++) {
                const child = children[ci];
                const gapAfter = flowChildGaps.get(child);
                if (gapAfter !== undefined && gapAfter > minGap + GAP_TOLERANCE) {
                  const extraGap = gapAfter - minGap;
                  // Create transparent wrapper frame with extra padding
                  const wrapper: LayerMeta = {
                    type: 'FRAME',
                    name: child.name,
                    x: child.x,
                    y: child.y,
                    width: child.width,
                    height: child.height + (isVertical ? extraGap : 0),
                    fills: [],
                    strokes: null,
                    effects: [],
                    cornerRadius: 0,
                    opacity: 1,
                    visible: true,
                    clipsContent: false,
                    autoLayout: {
                      mode: isVertical ? 'VERTICAL' : 'HORIZONTAL',
                      primaryAxisAlignItems: 'MIN',
                      counterAxisAlignItems: layer.autoLayout!.counterAxisAlignItems,
                      paddingTop: 0,
                      paddingRight: isVertical ? 0 : extraGap,
                      paddingBottom: isVertical ? extraGap : 0,
                      paddingLeft: 0,
                      itemSpacing: 0,
                      primaryAxisSizingMode: 'AUTO',
                      counterAxisSizingMode: 'AUTO',
                    },
                    children: [{ ...child, x: 0, y: 0 }],
                  };
                  children[ci] = wrapper;
                }
              }
            }
          }
        }
      }
    }

    // Detect cross-axis alignment for VERTICAL auto-layouts
    // This runs independently of gap calculation (even for single-child containers)
    if (layer.autoLayout && layer.autoLayout.mode === 'VERTICAL') {
      const flowChildren = children.filter(c => !c.isAbsolutelyPositioned);
      if (flowChildren.length > 0) {
        const pLeft = layer.autoLayout.paddingLeft || 0;
        const pRight = layer.autoLayout.paddingRight || 0;
        const contentWidth = layer.width - pLeft - pRight;

        let centeredCount = 0;
        let fullWidthCount = 0;

        for (const child of flowChildren) {
          // Only classify as "full width" if child truly fills the content area (within 2px)
          if (contentWidth > 0 && child.width < contentWidth - 2) {
            // child.x is relative to parent frame (includes padding offset)
            // so expectedCenterX must also include padding
            const expectedCenterX = pLeft + (contentWidth - child.width) / 2;
            if (Math.abs(child.x - expectedCenterX) < 8) {
              centeredCount++;
            }
          } else {
            fullWidthCount++;
          }
        }

        const nonFullWidthChildren = flowChildren.length - fullWidthCount;
        if (nonFullWidthChildren > 0 && centeredCount > nonFullWidthChildren / 2) {
          layer.autoLayout.counterAxisAlignItems = 'CENTER';
        }
      }
    }

    layer.children = children;
  }

  return layer;
}

/**
 * Sanitize SVG element to a string ready for Figma import
 */
function sanitizeSvg(svg: SVGElement, styles: CSSStyleDeclaration): string | null {
  try {
    const clone = svg.cloneNode(true) as SVGElement;

    // Resolve currentColor to actual color
    const currentColor = styles.color;
    const svgStr = clone.outerHTML;
    let sanitized = svgStr.replace(/currentColor/gi, currentColor);

    // Ensure width and height attributes
    const rect = svg.getBoundingClientRect();
    if (!clone.getAttribute('width')) {
      sanitized = sanitized.replace('<svg', `<svg width="${rect.width}"`);
    }
    if (!clone.getAttribute('height')) {
      sanitized = sanitized.replace('<svg', `<svg height="${rect.height}"`);
    }

    // Ensure xmlns is present
    if (!sanitized.includes('xmlns=')) {
      sanitized = sanitized.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    return sanitized;
  } catch {
    return null;
  }
}

/**
 * Determine the Figma layer type for an element
 */
function determineLayerType(element: Element, styles: CSSStyleDeclaration): LayerType {
  const tagName = element.tagName.toLowerCase();

  // Images become rectangles with image fill
  if (tagName === 'img') {
    return 'RECTANGLE';
  }

  // SVG root element - treat as FRAME
  if (tagName === 'svg') {
    return 'FRAME';
  }

  // SVG shapes
  if (tagName === 'circle' || tagName === 'ellipse') {
    return 'ELLIPSE';
  }

  if (tagName === 'rect') {
    return 'RECTANGLE';
  }

  // SVG path, polygon, polyline - treat as FRAME for now
  if (tagName === 'path' || tagName === 'polygon' || tagName === 'polyline' || tagName === 'line') {
    return 'FRAME';
  }

  // SVG group
  if (tagName === 'g') {
    return 'GROUP';
  }

  // Table elements - treat structural elements as FRAME
  if (tagName === 'table' || tagName === 'thead' || tagName === 'tbody' || tagName === 'tfoot' || tagName === 'tr') {
    return 'FRAME';
  }

  // Table caption - treat as FRAME for consistency (can contain complex content)
  if (tagName === 'caption') {
    return 'FRAME';
  }

  // Check for circular elements (border-radius: 50%)
  const borderRadius = styles.borderRadius;
  if (borderRadius === '50%' || borderRadius === '9999px') {
    const rect = element.getBoundingClientRect();
    if (Math.abs(rect.width - rect.height) < 2) {
      return 'ELLIPSE';
    }
  }

  // Elements with background colors should be FRAME (not TEXT)
  // because TEXT nodes can't have background fills
  const bgColor = styles.backgroundColor;
  const hasBackground = bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)';

  // Pure text elements without backgrounds
  // Exclude elements with only pseudo-element text (like FA icons) - they should be FRAME
  // so their ::before/::after content gets captured as child nodes
  if (!hasBackground && (isTextElement(tagName) || isTextOnlyElement(element))) {
    // Check if element contains block-level children - if so, treat as FRAME
    // This prevents collapsing complex structures like <a><div>...</div></a> into TEXT
    const hasBlockChildren = Array.from(element.children).some(child => {
      const childDisplay = window.getComputedStyle(child).display;
      return childDisplay === 'block' || childDisplay === 'flex' || childDisplay === 'grid' ||
             childDisplay === 'table' || childDisplay === 'list-item';
    });
    if (hasBlockChildren) {
      return 'FRAME';
    }
    // Elements with significant padding need FRAME for auto-layout centering
    // Figma TEXT nodes cannot have padding, so these must be FRAME + TEXT child
    const pt = parseFloat(styles.paddingTop) || 0;
    const pr = parseFloat(styles.paddingRight) || 0;
    const pb = parseFloat(styles.paddingBottom) || 0;
    const pl = parseFloat(styles.paddingLeft) || 0;
    if (pt > 2 || pr > 2 || pb > 2 || pl > 2) {
      return 'FRAME';
    }
    // Check if text content comes only from pseudo-elements
    const hasRealTextNodes = Array.from(element.childNodes).some(
      n => n.nodeType === Node.TEXT_NODE && (n.textContent?.trim() || '').length > 0
    );
    // Only classify as TEXT if there are real text nodes, or it's a known text tag
    if (isTextElement(tagName) || hasRealTextNodes) {
      return 'TEXT';
    }
  }

  // Default to frame for container elements and elements with backgrounds
  return 'FRAME';
}

/**
 * Check if element is non-visual
 */
function isNonVisualElement(tagName: string): boolean {
  const nonVisual = [
    'script',
    'style',
    'link',
    'meta',
    'head',
    'title',
    'noscript',
    'template',
    'slot',
    'br',
    'wbr',
    'defs',
    'clipPath',
    'mask',
    'symbol',
    'use',
    'colgroup',
    'col',
  ];
  return nonVisual.includes(tagName);
}

/**
 * Check if element is a text element
 */
function isTextElement(tagName: string): boolean {
  const textTags = [
    'p',
    'span',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'a',
    'label',
    'strong',
    'em',
    'b',
    // 'i' intentionally excluded - commonly used for icon fonts (FA, Material Icons)
    // Italic <i> tags with real text content will be caught by isTextOnlyElement instead
    'u',
    'small',
    'mark',
    'del',
    'ins',
    'sub',
    'sup',
    'code',
    'pre',
    'blockquote',
    'cite',
    'q',
    'button', // buttons with text
    'li',     // list items
    'dt',     // definition term
    'dd',     // definition description
  ];
  return textTags.includes(tagName);
}

/**
 * Check if element contains only text (no child elements)
 */
function isTextOnlyElement(element: Element): boolean {
  // Has child elements
  if (element.children.length > 0) {
    return false;
  }

  // Has direct text content
  const text = element.textContent?.trim();
  return !!text && text.length > 0;
}

/**
 * Parse CSS transform for rotation angle
 * Handles: rotate(Xdeg), rotate(Xrad), rotate(Xturn)
 * Also extracts from matrix() transform
 */
function parseRotation(transform: string): number | undefined {
  if (!transform || transform === 'none') return undefined;

  // Direct rotate() function
  const rotateMatch = transform.match(/rotate\(\s*(-?[\d.]+)(deg|rad|turn)\s*\)/);
  if (rotateMatch) {
    const value = parseFloat(rotateMatch[1]);
    const unit = rotateMatch[2];
    if (unit === 'deg') return value || undefined;
    if (unit === 'rad') return (value * 180 / Math.PI) || undefined;
    if (unit === 'turn') return (value * 360) || undefined;
  }

  // matrix(a, b, c, d, tx, ty) - extract rotation from matrix
  const matrixMatch = transform.match(/matrix\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/);
  if (matrixMatch) {
    const a = parseFloat(matrixMatch[1]);
    const b = parseFloat(matrixMatch[2]);
    const angle = Math.atan2(b, a) * (180 / Math.PI);
    return Math.abs(angle) > 0.01 ? angle : undefined;
  }

  return undefined;
}

/**
 * Capture rich text segments from inline children with different styles.
 * Walks the element's childNodes and records per-range style overrides
 * (color, fontWeight, fontStyle, fontSize, textDecoration) relative to the parent.
 * Returns undefined when all children share the same style as the parent.
 */
function captureTextSegments(element: Element): TextSegment[] | undefined {
  // Only process if element has child elements (mixed content)
  if (element.children.length === 0) return undefined;

  const segments: TextSegment[] = [];
  const parentStyles = window.getComputedStyle(element);
  const parentColor = parentStyles.color;
  const parentWeight = parentStyles.fontWeight;
  const parentFontStyle = parentStyles.fontStyle;
  const parentFontSize = parentStyles.fontSize;
  const parentTextDecoration = parentStyles.textDecorationLine || parentStyles.textDecoration;

  let offset = 0;

  for (const child of element.childNodes) {
    let text = '';
    let childColor = parentColor;
    let childWeight = parentWeight;
    let childFontStyle = parentFontStyle;
    let childFontSize = parentFontSize;
    let childTextDecoration = parentTextDecoration;

    if (child.nodeType === Node.TEXT_NODE) {
      text = child.textContent || '';
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      // Skip <br> tags -- they are handled as newlines in getDirectTextContent
      if (el.tagName.toLowerCase() === 'br') {
        offset += 1; // accounts for the \n that getDirectTextContent inserts
        continue;
      }
      const childStyles = window.getComputedStyle(el);
      text = el.textContent || '';
      childColor = childStyles.color;
      childWeight = childStyles.fontWeight;
      childFontStyle = childStyles.fontStyle;
      childFontSize = childStyles.fontSize;
      childTextDecoration = childStyles.textDecorationLine || childStyles.textDecoration;
    }

    if (text.length > 0) {
      const isDifferent =
        childColor !== parentColor ||
        childWeight !== parentWeight ||
        childFontStyle !== parentFontStyle ||
        childFontSize !== parentFontSize ||
        childTextDecoration !== parentTextDecoration;

      if (isDifferent) {
        const segment: TextSegment = {
          text,
          start: offset,
          end: offset + text.length,
        };

        if (childColor !== parentColor) {
          segment.color = parseColor(childColor);
        }
        if (childWeight !== parentWeight) {
          segment.fontWeight = parseInt(childWeight, 10);
        }
        if (childFontStyle !== parentFontStyle) {
          segment.fontStyle = childFontStyle === 'italic' ? 'italic' : 'normal';
        }
        if (childFontSize !== parentFontSize) {
          segment.fontSize = parseFloat(childFontSize);
        }
        if (childTextDecoration !== parentTextDecoration) {
          if (childTextDecoration.includes('underline')) {
            segment.textDecoration = 'UNDERLINE';
          } else if (childTextDecoration.includes('line-through')) {
            segment.textDecoration = 'STRIKETHROUGH';
          } else {
            segment.textDecoration = 'NONE';
          }
        }

        segments.push(segment);
      }
      offset += text.length;
    }
  }

  return segments.length > 0 ? segments : undefined;
}

/**
 * Get text content of an element (including nested inline elements)
 * Converts <br> tags to newlines
 */
function getDirectTextContent(element: Element): string {
  // Use innerText directly on the real DOM element (not a clone)
  // This ensures pseudo-element content (e.g., Font Awesome icons) is included
  // innerText already converts <br> to newlines in the browser
  return ((element as HTMLElement).innerText || '').trim();
}

/**
 * Get text from direct Text node children only (not from child elements).
 * Used for mixed content like: <button><i>icon</i> 채널 추가하기</button>
 */
function getDirectTextNodesOnly(element: Element): string {
  let text = '';
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent || '';
    }
  }
  return text.trim();
}

/**
 * Capture a pseudo-element (::before or ::after) as a LayerMeta node
 */
function capturePseudoElement(
  element: Element,
  pseudo: '::before' | '::after',
  parentRect: DOMRect,
): LayerMeta | null {
  const styles = window.getComputedStyle(element, pseudo);
  const content = styles.content;

  // Skip if no content or content is 'none' / 'normal' / empty
  if (!content || content === 'none' || content === 'normal' || content === '""' || content === "''") {
    return null;
  }

  // Skip if not visible
  if (styles.display === 'none' || styles.visibility === 'hidden') {
    return null;
  }

  // Extract text content (remove quotes from CSS content value)
  // CSS computed content wraps values in quotes, e.g., '"hello"' or '"\f201"'
  let textContent = content.replace(/^["']|["']$/g, '');

  // Handle CSS unicode escapes that may remain as literal backslash sequences
  // e.g., content might be '"\\f201"' which after quote removal becomes '\\f201'
  textContent = textContent.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => {
    return String.fromCodePoint(parseInt(hex, 16));
  });

  const isTextContent = textContent.length > 0 && !content.startsWith('url(');

  // Check if this is an icon font (Font Awesome, Material Icons, etc.)
  const fontFamily = styles.fontFamily;
  const isIconFont = isTextContent && (
    fontFamily.includes('Font Awesome') ||
    fontFamily.includes('Material') ||
    fontFamily.includes('icon') ||
    fontFamily.includes('Icon')
  );

  if (isIconFont && textContent.length > 0) {
    // Render icon font character to canvas and capture as PNG
    // FA icons use PUA unicode chars that won't render in Figma without the font
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const fontSize = parseFloat(styles.fontSize) || 16;
        const fontWeight = styles.fontWeight || '400';
        const color = styles.color || 'black';

        // Find closest ancestor with background color
        let bgColor = '';
        let bgParent: Element | null = element.parentElement;
        while (bgParent) {
          const bg = window.getComputedStyle(bgParent).backgroundColor;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
            bgColor = bg;
            break;
          }
          bgParent = bgParent.parentElement;
        }

        // Use the <i> element's actual rendered size
        const elemRect = element.getBoundingClientRect();
        const iconWidth = elemRect.width || fontSize;
        const iconHeight = elemRect.height || fontSize;

        const scale = 4; // High DPI for crisp rendering
        const canvasW = Math.ceil(iconWidth * scale);
        const canvasH = Math.ceil(iconHeight * scale);
        canvas.width = canvasW;
        canvas.height = canvasH;

        // Fill background if parent has color (ensures white icons are visible)
        if (bgColor) {
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, canvasW, canvasH);
        }

        // Draw icon character centered
        ctx.font = `${fontWeight} ${fontSize * scale}px ${fontFamily}`;
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(textContent, canvasW / 2, canvasH / 2);

        // Check if canvas has any non-transparent pixels
        const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
        let hasContent = false;
        for (let i = 3; i < imageData.data.length; i += 4) {
          if (imageData.data[i] > 0) { hasContent = true; break; }
        }

        if (hasContent) {
          const dataUrl = canvas.toDataURL('image/png');

          return {
            type: 'RECTANGLE' as const,
            name: `${pseudo.replace('::', '')}`,
            x: 0,
            y: 0,
            width: iconWidth,
            height: iconHeight,
            fills: [{
              type: 'IMAGE' as const,
              imageUrl: dataUrl,
              scaleMode: 'FILL' as const,
              opacity: 1,
              visible: true,
            }],
            strokes: null,
            effects: [],
            cornerRadius: 0,
            opacity: parseOpacity(styles),
            visible: true,
            clipsContent: false,
            children: [],
            sourceElement: {
              tagName: pseudo,
            },
          } as LayerMeta;
        }
        // If canvas is blank (font not loaded), fall through to text fallback
      }
    } catch (e) {
      // Fallback to text if canvas rendering fails
    }
  }

  // Parse visual styles
  const fills = parseBackground(styles);
  const strokes = parseBorder(styles);
  const effects = parseBoxShadow(styles);
  const cornerRadius = parseBorderRadius(styles);
  const opacity = parseOpacity(styles);

  // Estimate size from computed styles
  const width = parseFloat(styles.width) || 0;
  const height = parseFloat(styles.height) || 0;

  // Skip if zero-size and no text
  if (width === 0 && height === 0 && !isTextContent && fills.length === 0) {
    return null;
  }

  const layer: LayerMeta = {
    type: isTextContent ? 'TEXT' : 'FRAME',
    name: `${pseudo.replace('::', '')}`,
    x: parseFloat(styles.left) || 0,
    y: parseFloat(styles.top) || 0,
    width: width || (isTextContent ? 100 : 20),
    height: height || (isTextContent ? 20 : 20),
    fills,
    strokes,
    effects,
    cornerRadius,
    opacity,
    visible: true,
    clipsContent: false,
    children: [],
    sourceElement: {
      tagName: pseudo,
    },
  };

  // Add text content if present
  if (isTextContent) {
    layer.characters = textContent;
    layer.textStyles = parseTextStyle(styles);
  }

  // Check if absolutely positioned
  const position = styles.position;
  if (position === 'absolute' || position === 'fixed') {
    layer.isAbsolutelyPositioned = true;
  }

  return layer;
}

/**
 * Generate a descriptive layer name
 */
function generateLayerName(element: Element): string {
  const tagName = element.tagName.toLowerCase();

  // Use ID if available
  if (element.id) {
    return `${tagName}#${element.id}`;
  }

  // Use first class name if available
  const classList = element.classList;
  if (classList.length > 0) {
    return `${tagName}.${classList[0]}`;
  }

  // Use aria-label if available
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    return ariaLabel.slice(0, 30);
  }

  // For text elements, use content preview
  const text = element.textContent?.trim();
  if (text && text.length > 0) {
    return text.slice(0, 20) + (text.length > 20 ? '...' : '');
  }

  // Fallback to tag name
  return tagName;
}

/**
 * Capture entire document body as LayerMeta
 */
export function captureDocument(): LayerMeta | null {
  const body = document.body;
  if (!body) return null;

  const rect = body.getBoundingClientRect();

  return domToLayer(body, {
    rootOffset: { x: rect.left, y: rect.top },
  });
}

/**
 * Capture a specific element by selector
 */
export function captureElement(selector: string): LayerMeta | null {
  const element = document.querySelector(selector);
  if (!element) return null;

  const rect = element.getBoundingClientRect();

  return domToLayer(element, {
    rootOffset: { x: rect.left, y: rect.top },
  });
}
