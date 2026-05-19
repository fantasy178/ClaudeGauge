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
exports.sessionsDir = sessionsDir;
exports.parseSessionFile = parseSessionFile;
exports.dateFromFilename = dateFromFilename;
exports.findLatestSession = findLatestSession;
exports.readLive = readLive;
exports.aggregateHistory = aggregateHistory;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const readline = __importStar(require("readline"));
function homeCodex() {
    return path.join(os.homedir(), ".codex");
}
function sessionsDir() {
    return path.join(homeCodex(), "sessions");
}
function parseCodexRateLimit(node) {
    if (!node)
        return null;
    const used = typeof node.used_percent === "number" ? node.used_percent : null;
    const resetsUnix = typeof node.resets_at === "number" ? node.resets_at : null;
    if (used === null || resetsUnix === null)
        return null;
    return {
        used_percent: used,
        resets_at: new Date(resetsUnix * 1000).toISOString(),
    };
}
async function parseSessionFile(filePath) {
    const tokens = { input: 0, cached: 0, output: 0, reasoning: 0 };
    let latestLive = null;
    let latestModel = null;
    try {
        const rl = readline.createInterface({
            input: fs.createReadStream(filePath, { encoding: "utf8" }),
            crlfDelay: Infinity,
        });
        for await (const line of rl) {
            if (!line.trim())
                continue;
            let v;
            try {
                v = JSON.parse(line);
            }
            catch {
                continue;
            }
            if (v?.type === "turn_context") {
                if (typeof v?.payload?.model === "string") {
                    latestModel = v.payload.model;
                }
            }
            else if (v?.type === "event_msg" && v?.payload?.type === "token_count") {
                const rl_ = v?.payload?.rate_limits ?? {};
                latestLive = {
                    five_hour: parseCodexRateLimit(rl_.primary),
                    seven_day: parseCodexRateLimit(rl_.secondary),
                    plan_type: typeof rl_.plan_type === "string" ? rl_.plan_type : null,
                    model_name: latestModel,
                };
                const info = v?.payload?.info?.total_token_usage ?? {};
                tokens.input = info.input_tokens ?? tokens.input;
                tokens.cached = info.cached_input_tokens ?? tokens.cached;
                tokens.output = info.output_tokens ?? tokens.output;
                tokens.reasoning = info.reasoning_output_tokens ?? tokens.reasoning;
            }
        }
    }
    catch { }
    return { live: latestLive, tokens };
}
function dateFromFilename(name) {
    if (!name.startsWith("rollout-"))
        return null;
    const rest = name.slice("rollout-".length);
    const datePart = rest.slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
    if (!m)
        return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
}
async function walkRollouts(dir) {
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
            else if (e.isFile() &&
                e.name.startsWith("rollout-") &&
                e.name.endsWith(".jsonl"))
                out.push(full);
        }
    }
    await walk(dir);
    return out;
}
async function findLatestSession() {
    const dir = sessionsDir();
    try {
        await fs.promises.access(dir);
    }
    catch {
        return null;
    }
    const files = await walkRollouts(dir);
    let best = null;
    for (const f of files) {
        try {
            const st = await fs.promises.stat(f);
            const m = st.mtimeMs;
            if (!best || m > best.mtime)
                best = { mtime: m, path: f };
        }
        catch { }
    }
    return best?.path ?? null;
}
async function readLive() {
    const p = await findLatestSession();
    if (!p)
        return null;
    const parsed = await parseSessionFile(p);
    return parsed.live;
}
async function aggregateHistory() {
    const out = {
        today_total: 0,
        today_cached: 0,
        month_total: 0,
        month_cached: 0,
    };
    const dir = sessionsDir();
    try {
        await fs.promises.access(dir);
    }
    catch {
        return out;
    }
    const files = await walkRollouts(dir);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    for (const f of files) {
        const date = dateFromFilename(path.basename(f));
        if (!date)
            continue;
        if (date < monthStart)
            continue;
        const { tokens } = await parseSessionFile(f);
        const total = tokens.input + tokens.output;
        out.month_total += total;
        out.month_cached += tokens.cached;
        if (date >= todayStart) {
            out.today_total += total;
            out.today_cached += tokens.cached;
        }
    }
    return out;
}
