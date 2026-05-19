import type { HistoricalSnapshot, LiveSnapshot } from "./types";

export interface Bridge {
  getLive(): Promise<LiveSnapshot>;
  refreshHistory(): Promise<HistoricalSnapshot>;
  hide(): Promise<void>;
  installHook(): Promise<void>;
  removeHook(): Promise<void>;
  setSize(width: number, height: number): Promise<void>;
  getConfig(): Promise<{ opacity: number; pinned: boolean }>;
  setOpacity(opacity: number): Promise<void>;
  setPinned(pinned: boolean): Promise<void>;
  onLiveUpdate(cb: (snap: LiveSnapshot) => void): () => void;
  onForceRefresh(cb: () => void): () => void;
}

declare global {
  interface Window {
    api?: Bridge;
  }
}

function mockBridge(): Bridge {
  return {
    getLive: async () => ({ claude: null, codex: null }),
    refreshHistory: async () => ({
      claude: { today: empty(), month: empty(), model_distribution: [] },
      codex: { today_total: 0, today_cached: 0, month_total: 0, month_cached: 0 },
    }),
    hide: async () => {},
    installHook: async () => {},
    removeHook: async () => {},
    setSize: async () => {},
    getConfig: async () => ({ opacity: 1, pinned: false }),
    setOpacity: async () => {},
    setPinned: async () => {},
    onLiveUpdate: () => () => {},
    onForceRefresh: () => () => {},
  };
}

function empty() {
  return { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
}

export const bridge: Bridge = window.api ?? mockBridge();
