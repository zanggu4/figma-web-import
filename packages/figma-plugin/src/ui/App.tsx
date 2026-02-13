import { h, Fragment } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useUIStore } from './store';
import type { CaptureData } from '@figma-web-import/shared';

declare const __BUILD_TIME__: string;

export function App() {
  const {
    status,
    captureData,
    error,
    validationInfo,
    importResult,
    scale,
    createFrame,
    frameName,
    setStatus,
    setCaptureData,
    setError,
    setValidationInfo,
    setImportResult,
    setScale,
    setCreateFrame,
    setFrameName,
    reset,
  } = useUIStore();
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle messages from plugin code
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data.pluginMessage;
      if (!msg) return;

      switch (msg.type) {
        case 'status':
          setStatus(msg.status);
          break;

        case 'validation-success':
          setValidationInfo({
            layerCount: msg.layerCount,
            viewport: msg.viewport,
            sourceUrl: msg.sourceUrl,
          });
          setStatus('idle');
          break;

        case 'validation-error':
          setError(msg.errors.join(', '));
          setStatus('error');
          break;

        case 'import-complete':
          setImportResult({
            nodeId: msg.nodeId,
            nodeName: msg.nodeName,
            layerCount: msg.layerCount,
          });
          setStatus('success');
          break;

        case 'error':
          setError(msg.error);
          setStatus('error');
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [setStatus, setError, setValidationInfo, setImportResult]);

  const processCaptureText = useCallback((text: string) => {
    setError(null);
    setStatus('validating');

    try {
      const data = JSON.parse(text) as CaptureData;

      // Basic validation
      if (!data.version || !data.root) {
        throw new Error('Invalid capture data format');
      }

      setCaptureData(data);

      // Set default frame name from source URL
      if (data.sourceUrl) {
        try {
          const url = new URL(data.sourceUrl);
          setFrameName(`Import - ${url.hostname}`);
        } catch {
          setFrameName('Web Import');
        }
      }

      // Send to plugin for full validation
      parent.postMessage(
        {
          pluginMessage: {
            type: 'validate',
            data,
          },
        },
        '*'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse data');
      setStatus('error');
    }
  }, [setCaptureData, setError, setStatus, setFrameName]);

  // Handle paste from clipboard
  const handlePaste = useCallback((text: string) => {
    processCaptureText(text);
  }, [processCaptureText]);

  const readCaptureFile = useCallback(async (file: File) => {
    if (!file) return;

    try {
      const text = await file.text();
      processCaptureText(text);
    } catch {
      setError('Failed to read file');
      setStatus('error');
    }
  }, [processCaptureText, setError, setStatus]);

  // Handle textarea paste
  const handleTextAreaPaste = useCallback(
    (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text');
      if (text) {
        handlePaste(text);
      }
    },
    [handlePaste]
  );

  const handleFileInputChange = useCallback((e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];

    if (file) {
      void readCaptureFile(file);
    }

    // Allow selecting the same file again.
    target.value = '';
  }, [readCaptureFile]);

  const handleChooseFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (status === 'validating' || status === 'importing') {
      return;
    }

    setIsDragActive(true);
  }, [status]);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (status === 'validating' || status === 'importing') {
      return;
    }

    const file = e.dataTransfer?.files?.[0];
    if (file) {
      void readCaptureFile(file);
      return;
    }

    const text = e.dataTransfer?.getData('text/plain');
    if (text) {
      processCaptureText(text);
    }
  }, [processCaptureText, readCaptureFile, status]);

  // Handle import button
  const handleImport = useCallback(() => {
    if (!captureData) return;

    setStatus('importing');
    setError(null);

    parent.postMessage(
      {
        pluginMessage: {
          type: 'import',
          data: captureData,
          options: {
            scale,
            createFrame,
            frameName: frameName || undefined,
          },
        },
      },
      '*'
    );
  }, [captureData, scale, createFrame, frameName, setStatus, setError]);

  // Handle close
  const handleClose = useCallback(() => {
    parent.postMessage({ pluginMessage: { type: 'close' } }, '*');
  }, []);

  return (
    <div class="container">
      <header class="header">
        <h1>Web Import</h1>
        <p>Paste captured data from the Chrome extension</p>
        <p style={{ fontSize: '10px', color: '#999', marginTop: '4px' }}>Built: {__BUILD_TIME__}</p>
      </header>

      {/* Input Section */}
      {!validationInfo && status !== 'success' && (
        <section class="section">
          <label class="label">Paste or drop capture data:</label>
          <div
            class={`dropzone${isDragActive ? ' active' : ''}${status === 'validating' || status === 'importing' ? ' disabled' : ''}`}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <p class="dropzone-title">Drop JSON file here</p>
            <p class="dropzone-subtitle">or choose a file</p>
            <button
              class="btn btn-secondary"
              onClick={handleChooseFile}
              disabled={status === 'validating' || status === 'importing'}
            >
              Choose JSON File
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json,text/json"
              onChange={handleFileInputChange}
              style={{ display: 'none' }}
            />
          </div>
          <textarea
            class="textarea"
            placeholder='Paste JSON from Chrome extension (Ctrl/Cmd+V)...'
            onPaste={handleTextAreaPaste}
            disabled={status === 'validating' || status === 'importing'}
          />
        </section>
      )}

      {/* Validation Info */}
      {validationInfo && status !== 'success' && (
        <section class="section">
          <div class="preview">
            <div class="preview-item">
              <span>Layers:</span>
              <strong>{validationInfo.layerCount}</strong>
            </div>
            <div class="preview-item">
              <span>Viewport:</span>
              <strong>
                {validationInfo.viewport.width}×{validationInfo.viewport.height}
              </strong>
            </div>
            <div class="preview-item">
              <span>Source:</span>
              <strong>{truncateUrl(validationInfo.sourceUrl)}</strong>
            </div>
          </div>
        </section>
      )}

      {/* Options */}
      {validationInfo && status !== 'success' && (
        <section class="section options">
          <div class="option">
            <input
              type="checkbox"
              id="createFrame"
              checked={createFrame}
              onChange={(e) => setCreateFrame((e.target as HTMLInputElement).checked)}
            />
            <label htmlFor="createFrame">Wrap in frame</label>
          </div>
          <div class="option">
            <label htmlFor="scale">Scale:</label>
            <select
              id="scale"
              value={scale}
              onChange={(e) => setScale(parseFloat((e.target as HTMLSelectElement).value))}
            >
              <option value="0.5">50%</option>
              <option value="1">100%</option>
              <option value="1.5">150%</option>
              <option value="2">200%</option>
            </select>
          </div>
          {createFrame && (
            <div class="option">
              <label htmlFor="frameName">Frame name:</label>
              <input
                type="text"
                id="frameName"
                value={frameName}
                onInput={(e) => setFrameName((e.target as HTMLInputElement).value)}
                style={{ flex: 1 }}
              />
            </div>
          )}
        </section>
      )}

      {/* Error */}
      {error && (
        <div class="status error">
          ⚠️ {error}
        </div>
      )}

      {/* Success */}
      {status === 'success' && importResult && (
        <div class="status success">
          ✓ Imported {importResult.layerCount} layers as "{importResult.nodeName}"
        </div>
      )}

      {/* Loading */}
      {(status === 'validating' || status === 'importing') && (
        <div class="status info">
          {status === 'validating' ? 'Validating...' : 'Importing...'}
        </div>
      )}

      {/* Actions */}
      <section class="section" style={{ marginTop: 'auto' }}>
        {validationInfo && status !== 'success' && (
          <button
            class="btn btn-primary"
            onClick={handleImport}
            disabled={status === 'importing'}
          >
            {status === 'importing' ? 'Importing...' : 'Import to Figma'}
          </button>
        )}
        {status === 'success' && (
          <>
            <button class="btn btn-primary" onClick={reset}>
              Import Another
            </button>
            <button class="btn btn-secondary" onClick={handleClose}>
              Close
            </button>
          </>
        )}
        {status === 'error' && (
          <button class="btn btn-secondary" onClick={reset}>
            Try Again
          </button>
        )}
      </section>
    </div>
  );
}

function truncateUrl(url: string, maxLength = 30): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    if (path.length > maxLength) {
      return parsed.hostname + path.slice(0, maxLength - 3) + '...';
    }
    return parsed.hostname + path;
  } catch {
    return url.slice(0, maxLength);
  }
}
