import type { LayerMeta, CaptureData } from '@figma-web-import/shared';
import { createNodeWithStyles } from './node-factory';

/**
 * Layout engine for converting captured data to Figma design
 */

export interface ImportOptions {
  /** Scale factor for the import (1 = 100%) */
  scale?: number;
  /** Position offset for the imported design */
  offsetX?: number;
  offsetY?: number;
  /** Create a wrapper frame */
  createFrame?: boolean;
  /** Frame name */
  frameName?: string;
}

const DEFAULT_OPTIONS: Required<ImportOptions> = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  createFrame: true,
  frameName: 'Web Import',
};

/**
 * Import captured data into Figma
 */
export async function importToFigma(
  data: CaptureData,
  options: ImportOptions = {}
): Promise<FrameNode | SceneNode> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Scale the layer data if needed
  const scaledRoot = opts.scale !== 1 ? scaleLayer(data.root, opts.scale) : data.root;

  // Create wrapper frame if requested
  if (opts.createFrame) {
    const frame = figma.createFrame();
    frame.name = opts.frameName;
    frame.x = opts.offsetX;
    frame.y = opts.offsetY;
    // Transform root coordinates before measuring required frame size.
    const transformedRoot = transformToFrameCoordinates(scaledRoot);
    const contentBounds = measureLayerBounds(transformedRoot);
    const frameWidth = Math.max(
      1,
      data.viewport.width * opts.scale,
      Math.ceil(contentBounds.maxX)
    );
    const frameHeight = Math.max(
      1,
      data.viewport.height * opts.scale,
      Math.ceil(contentBounds.maxY)
    );

    frame.resize(frameWidth, frameHeight);
    frame.clipsContent = true;

    // Set frame background to white
    frame.fills = [{
      type: 'SOLID',
      color: { r: 1, g: 1, b: 1 },
      opacity: 1,
      visible: true,
    }];

    // Transform root layer coordinates to be relative to frame (0,0)
    // Children should be positioned relative to the frame, not absolute page coordinates
    // Import root layer into the frame
    const rootNode = await createNodeWithStyles(transformedRoot, {
      offsetX: 0,
      offsetY: 0,
      parent: frame,
    });
    frame.appendChild(rootNode);

    // Select the frame
    figma.currentPage.selection = [frame];
    figma.viewport.scrollAndZoomIntoView([frame]);

    return frame;
  }

  // Import root layer directly to page
  const node = await createNodeWithStyles(scaledRoot, {
    offsetX: opts.offsetX,
    offsetY: opts.offsetY,
  });

  figma.currentPage.appendChild(node);
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);

  return node;
}

/**
 * Scale all dimensions in a layer
 */
function scaleLayer(layer: LayerMeta, scale: number): LayerMeta {
  if (scale === 1) return layer;

  return {
    ...layer,
    x: layer.x * scale,
    y: layer.y * scale,
    width: layer.width * scale,
    height: layer.height * scale,
    cornerRadius: scaleCornerRadius(layer.cornerRadius, scale),
    effects: layer.effects.map((effect) => scaleEffect(effect, scale)),
    strokes: layer.strokes
      ? { ...layer.strokes, weight: layer.strokes.weight * scale }
      : null,
    autoLayout: layer.autoLayout
      ? scaleAutoLayout(layer.autoLayout, scale)
      : undefined,
    textStyles: layer.textStyles
      ? scaleTextStyles(layer.textStyles, scale)
      : undefined,
    children: layer.children.map((child) => scaleLayer(child, scale)),
  };
}

function scaleCornerRadius(
  radius: number | LayerMeta['cornerRadius'],
  scale: number
): number | LayerMeta['cornerRadius'] {
  if (typeof radius === 'number') {
    return radius * scale;
  }
  return {
    topLeft: radius.topLeft * scale,
    topRight: radius.topRight * scale,
    bottomRight: radius.bottomRight * scale,
    bottomLeft: radius.bottomLeft * scale,
  };
}

function scaleEffect(
  effect: LayerMeta['effects'][0],
  scale: number
): LayerMeta['effects'][0] {
  if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
    return {
      ...effect,
      offset: {
        x: effect.offset.x * scale,
        y: effect.offset.y * scale,
      },
      radius: effect.radius * scale,
      spread: (effect.spread ?? 0) * scale,
    };
  }
  return {
    ...effect,
    radius: effect.radius * scale,
  };
}

function scaleAutoLayout(
  layout: NonNullable<LayerMeta['autoLayout']>,
  scale: number
): NonNullable<LayerMeta['autoLayout']> {
  return {
    ...layout,
    paddingTop: layout.paddingTop * scale,
    paddingRight: layout.paddingRight * scale,
    paddingBottom: layout.paddingBottom * scale,
    paddingLeft: layout.paddingLeft * scale,
    itemSpacing: layout.itemSpacing * scale,
  };
}

function scaleTextStyles(
  styles: NonNullable<LayerMeta['textStyles']>,
  scale: number
): NonNullable<LayerMeta['textStyles']> {
  return {
    ...styles,
    fontSize: styles.fontSize * scale,
    lineHeight: styles.lineHeight === 'AUTO' ? 'AUTO' : styles.lineHeight * scale,
    letterSpacing: styles.letterSpacing * scale,
  };
}

/**
 * Transform layer coordinates to be relative to frame (0,0)
 *
 * NOTE: Children coordinates are ALREADY relative to their parent from the capture side
 * (dom-to-layer.ts uses rootOffset to make children relative).
 * We only need to move the root layer to (0,0) - children keep their positions.
 */
function transformToFrameCoordinates(layer: LayerMeta): LayerMeta {
  // Only transform the root layer to start at (0,0)
  // Children are already in relative coordinates from capture
  return {
    ...layer,
    x: 0,
    y: 0,
    // Children keep their original coordinates (already relative to parent)
  };
}

function measureLayerBounds(layer: LayerMeta): { maxX: number; maxY: number } {
  const bounds = { maxX: 0, maxY: 0 };

  const traverse = (node: LayerMeta, parentX: number, parentY: number): void => {
    const x = parentX + node.x;
    const y = parentY + node.y;

    bounds.maxX = Math.max(bounds.maxX, x + node.width);
    bounds.maxY = Math.max(bounds.maxY, y + node.height);

    for (const child of node.children) {
      traverse(child, x, y);
    }
  };

  traverse(layer, 0, 0);
  return bounds;
}

/**
 * Count total layers in hierarchy
 */
export function countLayers(layer: LayerMeta): number {
  let count = 1;
  for (const child of layer.children) {
    count += countLayers(child);
  }
  return count;
}
