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

const VITE_DEV_URL = process.env.VITE_DEV_URL || "http://localhost:1420";
const isDev = !app.isPackaged && process.env.CLAUDEGAUGE_DEV === "1";

function buildPath(): string {
  return path.join(__dirname, "..", "dist", "index.html");
}

function trayIconPath(name: string): string {
  const base = isDev
    ? path.join(__dirname, "..", "build")
    : path.join(process.resourcesPath, "build");
  return path.join(base, name);
}

async function getLive(): Promise<LiveSnapshot> {
  const [c, x] = await Promise.all([claude.readLive(), codex.readLive()]);
  return { claude: c, codex: x };
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
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: !config.start_minimized,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("move", () => {
    if (!mainWindow) return;
    const [nx, ny] = mainWindow.getPosition();
    cfg.save({ ...(config as any), last_x: nx, last_y: ny }).catch(() => {});
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
    mainWindow.setSize(Math.round(width), Math.round(height), false);
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
