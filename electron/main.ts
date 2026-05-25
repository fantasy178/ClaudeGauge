import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
} from "electron";
import * as path from "path";
import * as fs from "fs";
import chokidar from "chokidar";
import * as claude from "./services/claude";
import * as codex from "./services/codex";
import * as cfg from "./services/config";
import type { LiveSnapshot, HistoricalSnapshot } from "./types";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let watcher: chokidar.FSWatcher | null = null;
let lastEmitTs = 0;
let lastGoodSnap: LiveSnapshot = { claude: null, codex: null };

const VITE_DEV_URL = process.env.VITE_DEV_URL || "http://localhost:1420";
const isDev = !app.isPackaged && process.env.CLAUDEGAUGE_DEV === "1";
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

function buildPath(): string {
  return path.join(__dirname, "..", "dist", "index.html");
}

function trayIconPath(name: string): string {
  // When packaged: process.resourcesPath/build/...
  // When dev/direct: <appRoot>/build/...
  const packagedPath = path.join(process.resourcesPath, "build", name);
  if (fs.existsSync(packagedPath)) return packagedPath;
  const devPath = path.join(__dirname, "..", "build", name);
  return devPath;
}

async function getLive(): Promise<LiveSnapshot> {
  const [c, x] = await Promise.all([claude.readLive(), codex.readLive()]);
  const claudeSnap = c
    ? {
        five_hour: c.five_hour ?? lastGoodSnap.claude?.five_hour ?? null,
        seven_day: c.seven_day ?? lastGoodSnap.claude?.seven_day ?? null,
        model_name: c.model_name ?? lastGoodSnap.claude?.model_name ?? null,
        plan_type: c.plan_type ?? lastGoodSnap.claude?.plan_type ?? null,
      }
    : lastGoodSnap.claude;
  const codexSnap = x
    ? {
        five_hour: x.five_hour ?? lastGoodSnap.codex?.five_hour ?? null,
        seven_day: x.seven_day ?? lastGoodSnap.codex?.seven_day ?? null,
        plan_type: x.plan_type ?? lastGoodSnap.codex?.plan_type ?? null,
        model_name: x.model_name ?? lastGoodSnap.codex?.model_name ?? null,
      }
    : lastGoodSnap.codex;

  // Preserve last known good fields when current live data is partial.
  const snap: LiveSnapshot = {
    claude: claudeSnap,
    codex: codexSnap,
  };
  if (claudeSnap) lastGoodSnap.claude = claudeSnap;
  if (codexSnap) lastGoodSnap.codex = codexSnap;
  return snap;
}

async function refreshHistory(): Promise<HistoricalSnapshot> {
  const [c, x] = await Promise.all([
    claude.aggregateHistory(),
    codex.aggregateHistory(),
  ]);
  return { claude: c, codex: x };
}

function maxSevenDay(snap: LiveSnapshot): number {
  const c = snap.claude?.seven_day?.used_percent ?? 0;
  const x = snap.codex?.seven_day?.used_percent ?? 0;
  return Math.max(c, x);
}

function updateTrayIcon(snap: LiveSnapshot) {
  if (!tray) return;
  const pct = maxSevenDay(snap);
  const name = pct < 70 ? "tray-normal.png" : pct < 90 ? "tray-warning.png" : "tray-danger.png";
  try {
    const img = nativeImage.createFromPath(trayIconPath(name));
    if (!img.isEmpty()) tray.setImage(img);
  } catch {}
}

async function broadcastLive() {
  const now = Date.now();
  if (now - lastEmitTs < 100) return; // debounce
  lastEmitTs = now;
  const snap = await getLive();
  updateTrayIcon(snap);
  mainWindow?.webContents.send("live-update", snap);
}

function startWatchers() {
  const claudeLive = claude.liveFilePath();
  try {
    fs.mkdirSync(path.dirname(claudeLive), { recursive: true });
    if (!fs.existsSync(claudeLive)) fs.writeFileSync(claudeLive, "{}");
  } catch {}

  watcher = chokidar.watch([claudeLive, codex.sessionsDir()], {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200 },
    depth: 6,
  });
  watcher.on("all", () => {
    broadcastLive().catch(() => {});
  });
}

async function createWindow() {
  const config = await cfg.load();
  const w = 256;
  const h = 260;

  let x = config.last_x;
  let y = config.last_y;
  if (x === null || y === null) {
    const display = screen.getPrimaryDisplay();
    x = display.workArea.x + display.workArea.width - w - 16;
    y = display.workArea.y + display.workArea.height - h - 16;
  }

  mainWindow = new BrowserWindow({
    width: w,
    height: h,
    x,
    y,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: !config.start_minimized,
    backgroundColor: "#1a1a2e",
    opacity: config.opacity ?? 1.0,
    movable: !config.pinned,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    console.error("Window failed to load:", code, desc);
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.on("move", async () => {
    if (!mainWindow) return;
    const [nx, ny] = mainWindow.getPosition();
    const c = await cfg.load();
    cfg.save({ ...c, last_x: nx, last_y: ny }).catch(() => {});
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (isDev) {
    await mainWindow.loadURL(VITE_DEV_URL);
  } else {
    await mainWindow.loadFile(buildPath());
  }
}

function createTray() {
  const img = nativeImage.createFromPath(trayIconPath("tray-normal.png"));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);

  const menu = Menu.buildFromTemplate([
    {
      label: "展開視窗",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "重新掃描歷史",
      click: () => {
        mainWindow?.webContents.send("force-refresh");
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        app.exit(0);
      },
    },
  ]);

  tray.setToolTip("ClaudeGauge");
  tray.setContextMenu(menu);
  tray.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function registerIpc() {
  ipcMain.handle("get_live", () => getLive());
  ipcMain.handle("refresh_history", () => refreshHistory());
  ipcMain.handle("hide_window", () => {
    mainWindow?.hide();
  });
  ipcMain.handle("install_hook", () => claude.ensureStopHook());
  ipcMain.handle("remove_hook", () => claude.removeStopHook());
  ipcMain.handle("set_size", (_e, width: number, height: number) => {
    if (!mainWindow) return;
    mainWindow.setContentSize(Math.round(width), Math.round(height), false);
  });
  ipcMain.handle("get_config", () => cfg.load());
  ipcMain.handle("set_opacity", async (_e, opacity: number) => {
    const clamped = Math.max(0.2, Math.min(1.0, opacity));
    mainWindow?.setOpacity(clamped);
    const c = await cfg.load();
    await cfg.save({ ...c, opacity: clamped });
  });
  ipcMain.handle("set_pinned", async (_e, pinned: boolean) => {
    mainWindow?.setMovable(!pinned);
    const c = await cfg.load();
    await cfg.save({ ...c, pinned });
  });
}

app.whenReady().then(async () => {
  await claude.ensureStopHook().catch(() => {});
  await createWindow();
  createTray();
  registerIpc();
  startWatchers();

  // Initial broadcast after window is ready
  setTimeout(() => {
    broadcastLive().catch(() => {});
  }, 300);
});

app.on("window-all-closed", () => {
  // Keep tray running, don't quit when window closed
});

app.on("before-quit", () => {
  watcher?.close().catch(() => {});
});
