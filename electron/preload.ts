import { contextBridge, ipcRenderer } from "electron";
import type { HistoricalSnapshot, LiveSnapshot } from "./types";

const api = {
  getLive: (): Promise<LiveSnapshot> => ipcRenderer.invoke("get_live"),
  refreshHistory: (): Promise<HistoricalSnapshot> =>
    ipcRenderer.invoke("refresh_history"),
  hide: (): Promise<void> => ipcRenderer.invoke("hide_window"),
  installHook: (): Promise<void> => ipcRenderer.invoke("install_hook"),
  removeHook: (): Promise<void> => ipcRenderer.invoke("remove_hook"),
  setSize: (width: number, height: number): Promise<void> =>
    ipcRenderer.invoke("set_size", width, height),
  onLiveUpdate: (cb: (snap: LiveSnapshot) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, snap: LiveSnapshot) => cb(snap);
    ipcRenderer.on("live-update", handler);
    return () => ipcRenderer.removeListener("live-update", handler);
  },
  onForceRefresh: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("force-refresh", handler);
    return () => ipcRenderer.removeListener("force-refresh", handler);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
