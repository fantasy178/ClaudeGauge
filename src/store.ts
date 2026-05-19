import { create } from "zustand";
import type { HistoricalSnapshot, LiveSnapshot } from "./types";

interface UIState {
  expanded: boolean;
  toggleExpanded: () => void;
}

interface DataState {
  live: LiveSnapshot;
  history: HistoricalSnapshot | null;
  lastRefreshed: Date | null;
  setLive: (l: LiveSnapshot) => void;
  setHistory: (h: HistoricalSnapshot) => void;
}

export const useUI = create<UIState>((set) => ({
  expanded: false,
  toggleExpanded: () => set((s) => ({ expanded: !s.expanded })),
}));

export const useData = create<DataState>((set) => ({
  live: { claude: null, codex: null },
  history: null,
  lastRefreshed: null,
  setLive: (live) => set({ live }),
  setHistory: (history) => set({ history, lastRefreshed: new Date() }),
}));
