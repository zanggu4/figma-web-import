import type { CaptureData, LayerMeta } from '@figma-web-import/shared';

/**
 * Message types for extension communication
 */
export type MessageType =
  | 'CAPTURE_PAGE'
  | 'CAPTURE_SELECTION'
  | 'CAPTURE_RESULT'
  | 'CAPTURE_ERROR'
  | 'COPY_TO_CLIPBOARD';

export interface CapturePageMessage {
  type: 'CAPTURE_PAGE';
}

export interface CaptureSelectionMessage {
  type: 'CAPTURE_SELECTION';
  selector?: string;
}

export interface CaptureResultMessage {
  type: 'CAPTURE_RESULT';
  data: CaptureData;
}

export interface CaptureErrorMessage {
  type: 'CAPTURE_ERROR';
  error: string;
}

export interface CopyToClipboardMessage {
  type: 'COPY_TO_CLIPBOARD';
  data: string;
}

export type ExtensionMessage =
  | CapturePageMessage
  | CaptureSelectionMessage
  | CaptureResultMessage
  | CaptureErrorMessage
  | CopyToClipboardMessage;

/**
 * Send message to content script
 */
export async function sendToContentScript<T = unknown>(
  tabId: number,
  message: ExtensionMessage
): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message);
}

/**
 * Send message to background service worker
 */
export async function sendToBackground<T = unknown>(
  message: ExtensionMessage
): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

/**
 * Create CaptureData envelope from LayerMeta
 */
export function createCaptureData(
  root: LayerMeta,
  sourceUrl: string,
  viewport: { width: number; height: number }
): CaptureData {
  return {
    version: '0.0.1',
    capturedAt: new Date().toISOString(),
    sourceUrl,
    viewport,
    root,
  };
}
