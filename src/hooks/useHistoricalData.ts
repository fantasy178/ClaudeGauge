import { useCallback, useEffect } from "react";
import { bridge } from "../bridge";
import { useData } from "../store";

export function useHistoricalData() {
  const setHistory = useData((s) => s.setHistory);

  const refresh = useCallback(async () => {
    try {
      const h = await bridge.refreshHistory();
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
