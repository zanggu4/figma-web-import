import { create } from 'zustand';
import type { CaptureData } from '@figma-web-import/shared';

export type UIStatus = 'idle' | 'validating' | 'importing' | 'success' | 'error';

interface UIState {
  status: UIStatus;
  captureData: CaptureData | null;
  error: string | null;
  validationInfo: {
    layerCount: number;
    viewport: { width: number; height: number };
    sourceUrl: string;
  } | null;
  importResult: {
    nodeId: string;
    nodeName: string;
    layerCount: number;
  } | null;

  // Options
  scale: number;
  createFrame: boolean;
  frameName: string;

  // Actions
  setStatus: (status: UIStatus) => void;
  setCaptureData: (data: CaptureData | null) => void;
  setError: (error: string | null) => void;
  setValidationInfo: (info: UIState['validationInfo']) => void;
  setImportResult: (result: UIState['importResult']) => void;
  setScale: (scale: number) => void;
  setCreateFrame: (create: boolean) => void;
  setFrameName: (name: string) => void;
  reset: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  status: 'idle',
  captureData: null,
  error: null,
  validationInfo: null,
  importResult: null,
  scale: 1,
  createFrame: true,
  frameName: '',

  setStatus: (status) => set({ status }),
  setCaptureData: (captureData) => set({ captureData }),
  setError: (error) => set({ error }),
  setValidationInfo: (validationInfo) => set({ validationInfo }),
  setImportResult: (importResult) => set({ importResult }),
  setScale: (scale) => set({ scale }),
  setCreateFrame: (createFrame) => set({ createFrame }),
  setFrameName: (frameName) => set({ frameName }),
  reset: () =>
    set({
      status: 'idle',
      captureData: null,
      error: null,
      validationInfo: null,
      importResult: null,
      frameName: '',
    }),
}));
