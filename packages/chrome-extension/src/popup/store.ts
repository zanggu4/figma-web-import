import { create } from 'zustand';
import type { CaptureData } from '@figma-web-import/shared';

export type CaptureStatus = 'idle' | 'capturing' | 'success' | 'error';

interface PopupState {
  status: CaptureStatus;
  captureData: CaptureData | null;
  error: string | null;
  selector: string;

  // Actions
  setStatus: (status: CaptureStatus) => void;
  setCaptureData: (data: CaptureData | null) => void;
  setError: (error: string | null) => void;
  setSelector: (selector: string) => void;
  reset: () => void;
}

export const usePopupStore = create<PopupState>((set) => ({
  status: 'idle',
  captureData: null,
  error: null,
  selector: '',

  setStatus: (status) => set({ status }),
  setCaptureData: (captureData) => set({ captureData }),
  setError: (error) => set({ error }),
  setSelector: (selector) => set({ selector }),
  reset: () =>
    set({
      status: 'idle',
      captureData: null,
      error: null,
    }),
}));
