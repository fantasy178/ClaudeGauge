import { useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useData } from "../store";
import type { HistoricalSnapshot } from "../types";

export function useHistoricalData() {
  const setHistory = useData((s) => s.setHistory);

  const refresh = useCallback(async () => {
    try {
      const h = await invoke<HistoricalSnapshot>("refresh_history");
      setHistory(h);
    } catch (e) {
      console.error("refresh_history failed", e);
    }
  }, [setHistory]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { refresh };
}
