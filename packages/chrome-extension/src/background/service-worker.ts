import type { ExtensionMessage } from '../utils/messaging';

/**
 * Background service worker for Chrome Extension
 */

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => {
        console.error('[Service Worker] Error:', error);
        sendResponse({ error: error.message });
      });

    return true; // Async response
  }
);

async function handleMessage(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case 'COPY_TO_CLIPBOARD':
      // Note: clipboard write is handled in popup context
      return { success: true };

    default:
      console.log('[Service Worker] Unknown message:', message);
      return { error: 'Unknown message type' };
  }
}

// Handle extension icon click (open popup)
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  // Ensure content script is injected
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content/capture.ts'],
    });
  } catch (error) {
    console.error('[Service Worker] Failed to inject content script:', error);
  }
});

// Handle installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Service Worker] Extension installed');
  } else if (details.reason === 'update') {
    console.log('[Service Worker] Extension updated to', chrome.runtime.getManifest().version);
  }
});

console.log('[Service Worker] Background service worker started');
