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
Object.defineProperty(exports, "__esModule", { value: true });
exports.liveFilePath = liveFilePath;
exports.parseClaudeLive = parseClaudeLive;
exports.readLive = readLive;
exports.aggregateHistory = aggregateHistory;
exports.ensureStopHook = ensureStopHook;
exports.removeStopHook = removeStopHook;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const readline = __importStar(require("readline"));
const HOOK_MARKER = "claudegauge-hook";
function homeClaude() {
    return path.join(os.homedir(), ".claude");
}
function liveFilePath() {
    return path.join(homeClaude(), "claudegauge-live.json");
}
function parseRateLimit(node) {
    if (!node)
        return null;
    const used = typeof node.used_percentage === "number" ? node.used_percentage : null;
    const resetsUnix = typeof node.resets_at === "number" ? node.resets_at : null;
    if (used === null || resetsUnix === null)
        return null;
    return {
        used_percent: used,
        resets_at: new Date(resetsUnix * 1000).toISOString(),
    };
}
function parseClaudeLive(jsonText) {
    const v = JSON.parse(jsonText);
    return {
        five_hour: parseRateLimit(v?.rate_limits?.five_hour),
        seven_day: parseRateLimit(v?.rate_limits?.seven_day),
        model_name: v?.model?.display_name ?? null,
    };
}
async function readLive() {
    try {
        const txt = await fs.promises.readFile(liveFilePath(), "utf8");
        if (!txt.trim())
            return null;
        return parseClaudeLive(txt);
    }
    catch {
        return null;
    }
}
function extractRecord(v) {
    if (typeof v?.timestamp !== "string")
        return null;
    const ts = new Date(v.timestamp);
    if (Number.isNaN(ts.getTime()))
        return null;
    const model = v?.message?.model;
    if (typeof model !== "string")
        return null;
    const usage = v?.message?.usage ?? {};
    return {
        timestamp: ts,
        model,
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        cache_read: usage.cache_read_input_tokens ?? 0,
        cache_creation: usage.cache_creation_input_tokens ?? 0,
    };
}
async function parseTranscriptFile(filePath) {
    const out = [];
    try {
        const rl = readline.createInterface({
            input: fs.createReadStream(filePath, { encoding: "utf8" }),
            crlfDelay: Infinity,
        });
        for await (const line of rl) {
            if (!line.trim())
                continue;
            try {
                const obj = JSON.parse(line);
                const rec = extractRecord(obj);
                if (rec)
                    out.push(rec);
            }
            catch {
                // skip malformed
            }
        }
    }
    catch {
        // file missing
    }
    return out;
}
async function walkJsonl(dir) {
    const out = [];
    async function walk(d) {
        let entries;
        try {
            entries = await fs.promises.readdir(d, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of entries) {
            const full = path.join(d, e.name);
            if (e.isDirectory())
                await walk(full);
            else if (e.isFile() && e.name.endsWith(".jsonl"))
                out.push(full);
        }
    }
    await walk(dir);
    return out;
}
function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
}
async function aggregateHistory() {
    const root = path.join(homeClaude(), "projects");
    let files = [];
    try {
        await fs.promises.access(root);
        files = await walkJsonl(root);
    }
    catch {
        return { today: empty(), month: empty(), model_distribution: [] };
    }
    const now = new Date();
    const todayStart = startOfDay(now);
    const monthStart = startOfMonth(now);
    const today = empty();
    const month = empty();
    const byModel = new Map();
    for (const f of files) {
        const recs = await parseTranscriptFile(f);
        for (const r of recs) {
            if (r.timestamp >= monthStart) {
                month.input += r.input;
                month.output += r.output;
                month.cache_read += r.cache_read;
                month.cache_creation += r.cache_creation;
                const sum = r.input + r.output + r.cache_read + r.cache_creation;
                byModel.set(r.model, (byModel.get(r.model) ?? 0) + sum);
            }
            if (r.timestamp >= todayStart) {
                today.input += r.input;
                today.output += r.output;
                today.cache_read += r.cache_read;
                today.cache_creation += r.cache_creation;
            }
        }
    }
    const model_distribution = Array.from(byModel.entries()).sort((a, b) => b[1] - a[1]);
    return { today, month, model_distribution };
}
function empty() {
    return { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
}
// Hook writer
async function ensureStopHook() {
    const claudeDir = homeClaude();
    await fs.promises.mkdir(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, "settings.json");
    let root = {};
    try {
        const txt = await fs.promises.readFile(settingsPath, "utf8");
        if (txt.trim())
            root = JSON.parse(txt);
    }
    catch { }
    if (typeof root.hooks !== "object" || root.hooks === null)
        root.hooks = {};
    if (!Array.isArray(root.hooks.Stop))
        root.hooks.Stop = [];
    const alreadyInstalled = root.hooks.Stop.some((h) => Array.isArray(h?.hooks) &&
        h.hooks.some((x) => x?.comment === HOOK_MARKER));
    if (alreadyInstalled)
        return;
    const livePath = liveFilePath();
    const cmd = process.platform === "win32"
        ? `more > "${livePath}"`
        : `cat > "${livePath}"`;
    root.hooks.Stop.push({
        matcher: "",
        hooks: [{ type: "command", command: cmd, comment: HOOK_MARKER }],
    });
    await fs.promises.writeFile(settingsPath, JSON.stringify(root, null, 2));
}
async function removeStopHook() {
    const settingsPath = path.join(homeClaude(), "settings.json");
    let root;
    try {
        const txt = await fs.promises.readFile(settingsPath, "utf8");
        if (!txt.trim())
            return;
        root = JSON.parse(txt);
    }
    catch {
        return;
    }
    const stop = root?.hooks?.Stop;
    if (!Array.isArray(stop))
        return;
    root.hooks.Stop = stop.filter((h) => !Array.isArray(h?.hooks) ||
        !h.hooks.some((x) => x?.comment === HOOK_MARKER));
    await fs.promises.writeFile(settingsPath, JSON.stringify(root, null, 2));
}
