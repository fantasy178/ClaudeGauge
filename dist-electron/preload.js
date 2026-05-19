"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const api = {
    getLive: () => electron_1.ipcRenderer.invoke("get_live"),
    refreshHistory: () => electron_1.ipcRenderer.invoke("refresh_history"),
    hide: () => electron_1.ipcRenderer.invoke("hide_window"),
    installHook: () => electron_1.ipcRenderer.invoke("install_hook"),
    removeHook: () => electron_1.ipcRenderer.invoke("remove_hook"),
    setSize: (width, height) => electron_1.ipcRenderer.invoke("set_size", width, height),
    onLiveUpdate: (cb) => {
        const handler = (_e, snap) => cb(snap);
        electron_1.ipcRenderer.on("live-update", handler);
        return () => electron_1.ipcRenderer.removeListener("live-update", handler);
    },
    onForceRefresh: (cb) => {
        const handler = () => cb();
        electron_1.ipcRenderer.on("force-refresh", handler);
        return () => electron_1.ipcRenderer.removeListener("force-refresh", handler);
    },
};
electron_1.contextBridge.exposeInMainWorld("api", api);
