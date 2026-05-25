"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const chokidar_1 = __importDefault(require("chokidar"));
const claude = __importStar(require("./services/claude"));
const codex = __importStar(require("./services/codex"));
const cfg = __importStar(require("./services/config"));
let mainWindow = null;
let tray = null;
let watcher = null;
let lastEmitTs = 0;
let lastGoodSnap = { claude: null, codex: null };
const VITE_DEV_URL = process.env.VITE_DEV_URL || "http://localhost:1420";
const isDev = !electron_1.app.isPackaged && process.env.CLAUDEGAUGE_DEV === "1";
function buildPath() {
    return path.join(__dirname, "..", "dist", "index.html");
}
function trayIconPath(name) {
    // When packaged: process.resourcesPath/build/...
    // When dev/direct: <appRoot>/build/...
    const packagedPath = path.join(process.resourcesPath, "build", name);
    if (fs.existsSync(packagedPath))
        return packagedPath;
    const devPath = path.join(__dirname, "..", "build", name);
    return devPath;
}
async function getLive() {
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
    const snap = {
        claude: claudeSnap,
        codex: codexSnap,
    };
    if (claudeSnap)
        lastGoodSnap.claude = claudeSnap;
    if (codexSnap)
        lastGoodSnap.codex = codexSnap;
    return snap;
}
async function refreshHistory() {
    const [c, x] = await Promise.all([
        claude.aggregateHistory(),
        codex.aggregateHistory(),
    ]);
    return { claude: c, codex: x };
}
function maxSevenDay(snap) {
    const c = snap.claude?.seven_day?.used_percent ?? 0;
    const x = snap.codex?.seven_day?.used_percent ?? 0;
    return Math.max(c, x);
}
function updateTrayIcon(snap) {
    if (!tray)
        return;
    const pct = maxSevenDay(snap);
    const name = pct < 70 ? "tray-normal.png" : pct < 90 ? "tray-warning.png" : "tray-danger.png";
    try {
        const img = electron_1.nativeImage.createFromPath(trayIconPath(name));
        if (!img.isEmpty())
            tray.setImage(img);
    }
    catch { }
}
async function broadcastLive() {
    const now = Date.now();
    if (now - lastEmitTs < 100)
        return; // debounce
    lastEmitTs = now;
    const snap = await getLive();
    updateTrayIcon(snap);
    mainWindow?.webContents.send("live-update", snap);
}
function startWatchers() {
    const claudeLive = claude.liveFilePath();
    try {
        fs.mkdirSync(path.dirname(claudeLive), { recursive: true });
        if (!fs.existsSync(claudeLive))
            fs.writeFileSync(claudeLive, "{}");
    }
    catch { }
    watcher = chokidar_1.default.watch([claudeLive, codex.sessionsDir()], {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 200 },
        depth: 6,
    });
    watcher.on("all", () => {
        broadcastLive().catch(() => { });
    });
}
async function createWindow() {
    const config = await cfg.load();
    const w = 256;
    const h = 260;
    let x = config.last_x;
    let y = config.last_y;
    if (x === null || y === null) {
        const display = electron_1.screen.getPrimaryDisplay();
        x = display.workArea.x + display.workArea.width - w - 16;
        y = display.workArea.y + display.workArea.height - h - 16;
    }
    mainWindow = new electron_1.BrowserWindow({
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
        if (!mainWindow)
            return;
        const [nx, ny] = mainWindow.getPosition();
        const c = await cfg.load();
        cfg.save({ ...c, last_x: nx, last_y: ny }).catch(() => { });
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
    if (isDev) {
        await mainWindow.loadURL(VITE_DEV_URL);
    }
    else {
        await mainWindow.loadFile(buildPath());
    }
}
function createTray() {
    const img = electron_1.nativeImage.createFromPath(trayIconPath("tray-normal.png"));
    tray = new electron_1.Tray(img.isEmpty() ? electron_1.nativeImage.createEmpty() : img);
    const menu = electron_1.Menu.buildFromTemplate([
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
                electron_1.app.exit(0);
            },
        },
    ]);
    tray.setToolTip("ClaudeGauge");
    tray.setContextMenu(menu);
    tray.on("click", () => {
        if (!mainWindow)
            return;
        if (mainWindow.isVisible())
            mainWindow.hide();
        else {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}
function registerIpc() {
    electron_1.ipcMain.handle("get_live", () => getLive());
    electron_1.ipcMain.handle("refresh_history", () => refreshHistory());
    electron_1.ipcMain.handle("hide_window", () => {
        mainWindow?.hide();
    });
    electron_1.ipcMain.handle("install_hook", () => claude.ensureStopHook());
    electron_1.ipcMain.handle("remove_hook", () => claude.removeStopHook());
    electron_1.ipcMain.handle("set_size", (_e, width, height) => {
        if (!mainWindow)
            return;
        mainWindow.setContentSize(Math.round(width), Math.round(height), false);
    });
    electron_1.ipcMain.handle("get_config", () => cfg.load());
    electron_1.ipcMain.handle("set_opacity", async (_e, opacity) => {
        const clamped = Math.max(0.2, Math.min(1.0, opacity));
        mainWindow?.setOpacity(clamped);
        const c = await cfg.load();
        await cfg.save({ ...c, opacity: clamped });
    });
    electron_1.ipcMain.handle("set_pinned", async (_e, pinned) => {
        mainWindow?.setMovable(!pinned);
        const c = await cfg.load();
        await cfg.save({ ...c, pinned });
    });
}
electron_1.app.whenReady().then(async () => {
    await claude.ensureStopHook().catch(() => { });
    await createWindow();
    createTray();
    registerIpc();
    startWatchers();
    // Initial broadcast after window is ready
    setTimeout(() => {
        broadcastLive().catch(() => { });
    }, 300);
});
electron_1.app.on("window-all-closed", () => {
    // Keep tray running, don't quit when window closed
});
electron_1.app.on("before-quit", () => {
    watcher?.close().catch(() => { });
});
