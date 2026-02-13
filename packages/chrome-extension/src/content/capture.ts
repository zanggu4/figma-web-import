import {
  domToLayer,
  captureDocument,
  captureElement,
  VERSION,
  type CaptureData,
  type LayerMeta,
} from '@figma-web-import/shared';
import type { ExtensionMessage } from '../utils/messaging';

/**
 * Content script for capturing DOM elements
 */

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ type: 'CAPTURE_ERROR', error: error.message });
      });

    // Return true to indicate async response
    return true;
  }
);

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'CAPTURE_PAGE':
      return captureFullPage();

    case 'CAPTURE_SELECTION':
      return captureSelection(message.selector);

    default:
      throw new Error(`Unknown message type: ${(message as ExtensionMessage).type}`);
  }
}

/**
 * Capture the entire page
 */
async function captureFullPage(): Promise<CaptureData> {
  const root = captureDocument();

  if (!root) {
    throw new Error('Failed to capture document');
  }

  return createCaptureEnvelope(root, { fullPage: true });
}

/**
 * Capture a specific element by selector
 */
async function captureSelection(selector?: string): Promise<CaptureData> {
  let root: LayerMeta | null = null;

  if (selector) {
    root = captureElement(selector);
  } else {
    // Get currently selected element (if user has selection via DevTools)
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const element =
        container.nodeType === Node.ELEMENT_NODE
          ? (container as Element)
          : container.parentElement;

      if (element) {
        const rect = element.getBoundingClientRect();
        root = domToLayer(element, {
          rootOffset: { x: rect.left, y: rect.top },
        });
      }
    }
  }

  if (!root) {
    throw new Error('No element found to capture. Please provide a selector or select an element.');
  }

  return createCaptureEnvelope(root, { fullPage: false });
}

/**
 * Create the capture data envelope
 */
function createCaptureEnvelope(
  root: LayerMeta,
  options: { fullPage: boolean }
): CaptureData {
  const viewport = options.fullPage
    ? getDocumentViewport(root)
    : {
        width: window.innerWidth,
        height: window.innerHeight,
      };

  return {
    version: VERSION,
    capturedAt: new Date().toISOString(),
    sourceUrl: window.location.href,
    viewport,
    root,
  };
}

function getDocumentViewport(root: LayerMeta): { width: number; height: number } {
  const docEl = document.documentElement;
  const body = document.body;

  const width = Math.max(
    window.innerWidth,
    docEl?.scrollWidth ?? 0,
    docEl?.offsetWidth ?? 0,
    body?.scrollWidth ?? 0,
    body?.offsetWidth ?? 0,
    Math.ceil(root.x + root.width)
  );

  const height = Math.max(
    window.innerHeight,
    docEl?.scrollHeight ?? 0,
    docEl?.offsetHeight ?? 0,
    body?.scrollHeight ?? 0,
    body?.offsetHeight ?? 0,
    Math.ceil(root.y + root.height)
  );

  return { width, height };
}

// Inject selection highlight styles
const style = document.createElement('style');
style.textContent = `
  .figma-web-import-highlight {
    outline: 2px solid #0D99FF !important;
    outline-offset: 2px !important;
  }
`;
document.head.appendChild(style);

/**
 * Enable element selection mode
 */
let selectionModeEnabled = false;
let hoveredElement: Element | null = null;

function enableSelectionMode(): void {
  if (selectionModeEnabled) return;

  selectionModeEnabled = true;

  document.addEventListener('mouseover', handleMouseOver);
  document.addEventListener('mouseout', handleMouseOut);
  document.addEventListener('click', handleClick, true);
}

function disableSelectionMode(): void {
  selectionModeEnabled = false;

  document.removeEventListener('mouseover', handleMouseOver);
  document.removeEventListener('mouseout', handleMouseOut);
  document.removeEventListener('click', handleClick, true);

  if (hoveredElement) {
    hoveredElement.classList.remove('figma-web-import-highlight');
    hoveredElement = null;
  }
}

function handleMouseOver(e: MouseEvent): void {
  if (!selectionModeEnabled) return;

  const target = e.target as Element;
  if (hoveredElement !== target) {
    if (hoveredElement) {
      hoveredElement.classList.remove('figma-web-import-highlight');
    }
    hoveredElement = target;
    hoveredElement.classList.add('figma-web-import-highlight');
  }
}

function handleMouseOut(e: MouseEvent): void {
  if (!selectionModeEnabled) return;

  const target = e.target as Element;
  if (hoveredElement === target) {
    hoveredElement.classList.remove('figma-web-import-highlight');
    hoveredElement = null;
  }
}

function handleClick(e: MouseEvent): void {
  if (!selectionModeEnabled) return;

  e.preventDefault();
  e.stopPropagation();

  const target = e.target as Element;
  disableSelectionMode();

  // Generate selector for clicked element
  const selector = generateSelector(target);

  // Send selection back to popup
  chrome.runtime.sendMessage({
    type: 'ELEMENT_SELECTED',
    selector,
    tagName: target.tagName.toLowerCase(),
    id: target.id || undefined,
    className: target.getAttribute('class') || undefined,
  });
}

/**
 * Generate a CSS selector for an element
 */
function generateSelector(element: Element): string {
  // Use ID if available
  if (element.id) {
    return `#${element.id}`;
  }

  // Build path from element to body
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    // Add classes
    const classAttr = current.getAttribute('class');
    if (classAttr) {
      const classes = classAttr
        .split(/\s+/)
        .filter((c) => c && !c.startsWith('figma-web-import'))
        .slice(0, 2);

      if (classes.length > 0) {
        selector += '.' + classes.join('.');
      }
    }

    // Add nth-of-type if needed for uniqueness
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;
  }

  return path.join(' > ');
}

console.log('[Figma Web Import] Content script loaded');
