import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useData } from "../store";
import type { LiveSnapshot } from "../types";

export function useLiveData() {
  const setLive = useData((s) => s.setLive);
  useEffect(() => {
    invoke<LiveSnapshot>("get_live").then(setLive).catch(console.error);
    const unlisten = listen<LiveSnapshot>("live-update", (e) => setLive(e.payload));
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [setLive]);
}
