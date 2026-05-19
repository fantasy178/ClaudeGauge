import { useEffect } from "react";
import { bridge } from "../bridge";
import { useData } from "../store";

export function useLiveData() {
  const setLive = useData((s) => s.setLive);
  useEffect(() => {
    bridge.getLive().then(setLive).catch(console.error);
    const unsubscribe = bridge.onLiveUpdate(setLive);
    return unsubscribe;
  }, [setLive]);
}
