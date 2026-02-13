import { useCallback } from 'preact/hooks';
import { usePopupStore, type CaptureStatus } from './store';
import type { CaptureData } from '@figma-web-import/shared';

export function App() {
  const { status, captureData, error, selector, setStatus, setCaptureData, setError, setSelector, reset } =
    usePopupStore();

  const handleCapturePage = useCallback(async () => {
    setStatus('capturing');
    setError(null);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) {
        throw new Error('No active tab found');
      }

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'CAPTURE_PAGE',
      });

      if (response.type === 'CAPTURE_ERROR') {
        throw new Error(response.error);
      }

      const data = response as CaptureData;
      setCaptureData(data);
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture failed');
      setStatus('error');
    }
  }, [setStatus, setCaptureData, setError]);

  const handleCaptureSelection = useCallback(async () => {
    if (!selector.trim()) {
      setError('Please enter a CSS selector');
      return;
    }

    setStatus('capturing');
    setError(null);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) {
        throw new Error('No active tab found');
      }

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'CAPTURE_SELECTION',
        selector: selector.trim(),
      });

      if (response.type === 'CAPTURE_ERROR') {
        throw new Error(response.error);
      }

      const data = response as CaptureData;
      setCaptureData(data);
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture failed');
      setStatus('error');
    }
  }, [selector, setStatus, setCaptureData, setError]);

  const handleCopyToClipboard = useCallback(async () => {
    if (!captureData) return;

    try {
      const json = JSON.stringify(captureData, null, 2);
      await navigator.clipboard.writeText(json);
      // Show brief success feedback
      alert('Copied! Paste in Figma Plugin');
    } catch (err) {
      setError('Failed to copy to clipboard');
    }
  }, [captureData, setError]);

  return (
    <div class="popup-container">
      <header class="header">
        <h1>Figma Web Import</h1>
        <p class="subtitle">Capture web pages for Figma</p>
      </header>

      <main class="main">
        {/* Full Page Capture */}
        <section class="section">
          <button
            class="btn btn-primary"
            onClick={handleCapturePage}
            disabled={status === 'capturing'}
          >
            {status === 'capturing' ? 'Capturing...' : 'Capture Full Page'}
          </button>
        </section>

        {/* Selection Capture */}
        <section class="section">
          <label class="label">Or capture specific element:</label>
          <input
            type="text"
            class="input"
            placeholder="CSS selector (e.g., #main, .hero)"
            value={selector}
            onInput={(e) => setSelector((e.target as HTMLInputElement).value)}
          />
          <button
            class="btn btn-secondary"
            onClick={handleCaptureSelection}
            disabled={status === 'capturing' || !selector.trim()}
          >
            Capture Selection
          </button>
        </section>

        {/* Status & Results */}
        {error && (
          <div class="error">
            <span class="error-icon">⚠️</span>
            {error}
          </div>
        )}

        {status === 'success' && captureData && (
          <section class="section success">
            <div class="success-info">
              <span class="success-icon">✓</span>
              <span>
                Captured {countLayers(captureData.root)} layers
              </span>
            </div>
            <div class="meta">
              <small>Viewport: {captureData.viewport.width}×{captureData.viewport.height}</small>
            </div>
            <button class="btn btn-primary" onClick={handleCopyToClipboard}>
              Copy to Clipboard
            </button>
            <p class="hint">Then paste in Figma Plugin</p>
          </section>
        )}
      </main>

      <footer class="footer">
        <button class="btn-link" onClick={reset}>
          Reset
        </button>
      </footer>
    </div>
  );
}

function countLayers(layer: CaptureData['root']): number {
  let count = 1;
  for (const child of layer.children) {
    count += countLayers(child);
  }
  return count;
}
