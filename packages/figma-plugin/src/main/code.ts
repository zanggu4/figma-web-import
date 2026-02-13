import type { CaptureData } from '@figma-web-import/shared';
import { importToFigma, countLayers } from './layout-engine';

/**
 * Main Figma Plugin Code
 * Runs in Figma's sandbox environment
 */

/**
 * Safely extract hostname from a URL
 */
function safeHostname(url: string | undefined): string {
  try {
    return new URL(url || '').hostname || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

// Plugin dimensions
const PLUGIN_WIDTH = 320;
const PLUGIN_HEIGHT = 400;

// Show plugin UI
figma.showUI(__html__, {
  width: PLUGIN_WIDTH,
  height: PLUGIN_HEIGHT,
  title: 'Web Import',
});

// Handle messages from UI
figma.ui.onmessage = async (msg: PluginMessage) => {
  try {
    switch (msg.type) {
      case 'import':
        await handleImport(msg.data, msg.options);
        break;

      case 'validate':
        handleValidate(msg.data);
        break;

      case 'close':
        figma.closePlugin();
        break;

      case 'resize':
        figma.ui.resize(msg.width || PLUGIN_WIDTH, msg.height || PLUGIN_HEIGHT);
        break;

      default:
        console.warn('Unknown message type:', (msg as { type: string }).type);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    figma.ui.postMessage({
      type: 'error',
      error: errorMessage,
    });
  }
};

/**
 * Validate capture data structure
 */
function validateCaptureData(data: CaptureData | null | undefined): string[] {
  const errors: string[] = [];
  if (!data) {
    errors.push('No data provided');
    return errors;
  }
  if (!data.version) errors.push('Missing version');
  if (!data.root) errors.push('Missing root layer');
  if (!data.viewport) errors.push('Missing viewport info');
  if (!data.sourceUrl) errors.push('Missing source URL');
  return errors;
}

/**
 * Handle import request
 */
async function handleImport(
  data: CaptureData,
  options?: ImportOptions
): Promise<void> {
  figma.ui.postMessage({ type: 'status', status: 'importing' });

  // Validate data
  const errors = validateCaptureData(data);
  if (errors.length > 0) {
    throw new Error(`Invalid capture data: ${errors.join(', ')}`);
  }

  // Calculate position (next to existing selection or at viewport center)
  const position = calculatePosition();

  // Import to Figma
  const node = await importToFigma(data, {
    scale: options?.scale ?? 1,
    offsetX: position.x,
    offsetY: position.y,
    createFrame: options?.createFrame ?? true,
    frameName: options?.frameName || `Import - ${safeHostname(data.sourceUrl)}`,
  });

  const layerCount = countLayers(data.root);

  figma.ui.postMessage({
    type: 'import-complete',
    nodeId: node.id,
    nodeName: node.name,
    layerCount,
  });

  figma.notify(`Imported ${layerCount} layers`);
}

/**
 * Validate capture data
 */
function handleValidate(data: CaptureData): void {
  const errors = validateCaptureData(data);

  if (errors.length > 0) {
    figma.ui.postMessage({
      type: 'validation-error',
      errors,
    });
  } else {
    const layerCount = countLayers(data.root);
    figma.ui.postMessage({
      type: 'validation-success',
      layerCount,
      viewport: data.viewport,
      sourceUrl: data.sourceUrl,
    });
  }
}

/**
 * Calculate position for new import
 */
function calculatePosition(): { x: number; y: number } {
  const selection = figma.currentPage.selection;

  if (selection.length > 0) {
    // Position next to selection
    const bounds = getBounds(selection);
    return {
      x: bounds.x + bounds.width + 100,
      y: bounds.y,
    };
  }

  // Position at viewport center
  const viewport = figma.viewport.center;
  return {
    x: viewport.x - 400, // Offset to account for typical frame size
    y: viewport.y - 300,
  };
}

/**
 * Get bounding box of nodes
 */
function getBounds(nodes: readonly SceneNode[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// Message types
interface ImportMessage {
  type: 'import';
  data: CaptureData;
  options?: ImportOptions;
}

interface ValidateMessage {
  type: 'validate';
  data: CaptureData;
}

interface CloseMessage {
  type: 'close';
}

interface ResizeMessage {
  type: 'resize';
  width?: number;
  height?: number;
}

type PluginMessage = ImportMessage | ValidateMessage | CloseMessage | ResizeMessage;

interface ImportOptions {
  scale?: number;
  createFrame?: boolean;
  frameName?: string;
}
