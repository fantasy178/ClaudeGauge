import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";
import type { CodexHistorical, CodexLive, RateLimit } from "../types";

function homeCodex(): string {
  return path.join(os.homedir(), ".codex");
}

export function sessionsDir(): string {
  return path.join(homeCodex(), "sessions");
}

function parseCodexRateLimit(node: any): RateLimit | null {
  if (!node) return null;
  const used = typeof node.used_percent === "number" ? node.used_percent : null;
  const resetsUnix = typeof node.resets_at === "number" ? node.resets_at : null;
  if (used === null || resetsUnix === null) return null;
  return {
    used_percent: used,
    resets_at: new Date(resetsUnix * 1000).toISOString(),
  };
}

// Codex emits up to two windows under primary/secondary, but the position is
// NOT stable: some accounts report the 7-day window as `primary` with `secondary`
// null. Classify by window_minutes instead — ~300 min = 5H, ~10080 min = 7D.
function classifyRateLimits(rl: any): {
  five_hour: RateLimit | null;
  seven_day: RateLimit | null;
} {
  let five_hour: RateLimit | null = null;
  let seven_day: RateLimit | null = null;
  const now = Date.now();
  for (const node of [rl?.primary, rl?.secondary]) {
    if (!node) continue;
    const parsed = parseCodexRateLimit(node);
    if (!parsed) continue;
    // Discard already-expired windows — the percentage has since reset and is
    // no longer meaningful (e.g. a stale 5H reading from days ago).
    if (new Date(parsed.resets_at).getTime() < now) continue;
    const mins = typeof node.window_minutes === "number" ? node.window_minutes : null;
    // 7-day window (10080 min) vs everything shorter (5h = 300 min).
    if (mins !== null && mins >= 1440) {
      if (!seven_day) seven_day = parsed;
    } else {
      if (!five_hour) five_hour = parsed;
    }
  }
  return { five_hour, seven_day };
}

interface SessionTokens {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
}

interface ParsedSession {
  live: CodexLive | null;
  tokens: SessionTokens;
}

export async function parseSessionFile(filePath: string): Promise<ParsedSession> {
  const tokens: SessionTokens = { input: 0, cached: 0, output: 0, reasoning: 0 };
  let latestLive: CodexLive | null = null;
  let latestModel: string | null = null;

  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let v: any;
      try {
        v = JSON.parse(line);
      } catch {
        continue;
      }
      if (v?.type === "turn_context") {
        if (typeof v?.payload?.model === "string") {
          latestModel = v.payload.model;
        }
      } else if (v?.type === "event_msg" && v?.payload?.type === "token_count") {
        const rl_ = v?.payload?.rate_limits ?? {};
        const { five_hour, seven_day } = classifyRateLimits(rl_);
        latestLive = {
          five_hour,
          seven_day,
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
  } catch {}
  return { live: latestLive, tokens };
}

export function dateFromFilename(name: string): Date | null {
  if (!name.startsWith("rollout-")) return null;
  const rest = name.slice("rollout-".length);
  const datePart = rest.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

async function walkRollouts(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (
        e.isFile() &&
        e.name.startsWith("rollout-") &&
        e.name.endsWith(".jsonl")
      )
        out.push(full);
    }
  }
  await walk(dir);
  return out;
}

export async function findLatestSession(): Promise<string | null> {
  const dir = sessionsDir();
  try {
    await fs.promises.access(dir);
  } catch {
    return null;
  }
  const files = await walkRollouts(dir);
  let best: { mtime: number; path: string } | null = null;
  for (const f of files) {
    try {
      const st = await fs.promises.stat(f);
      const m = st.mtimeMs;
      if (!best || m > best.mtime) best = { mtime: m, path: f };
    } catch {}
  }
  return best?.path ?? null;
}

export async function readLive(): Promise<CodexLive | null> {
  const dir = sessionsDir();
  try {
    await fs.promises.access(dir);
  } catch {
    return null;
  }
  const files = await walkRollouts(dir);
  // Sort newest-first by mtime so the freshest readings win.
  const stamped: { mtime: number; path: string }[] = [];
  for (const f of files) {
    try {
      stamped.push({ mtime: (await fs.promises.stat(f)).mtimeMs, path: f });
    } catch {}
  }
  stamped.sort((a, b) => b.mtime - a.mtime);

  // A single session may only carry one window (e.g. 7D as primary, secondary
  // null). Merge across the most recent sessions, keeping the freshest non-null
  // value for each window, so both 5H and 7D stay populated.
  let merged: CodexLive | null = null;
  const SCAN = 25;
  for (const { path: p } of stamped.slice(0, SCAN)) {
    const { live } = await parseSessionFile(p);
    if (!live) continue;
    if (!merged) {
      merged = { ...live };
    } else {
      if (!merged.five_hour && live.five_hour) merged.five_hour = live.five_hour;
      if (!merged.seven_day && live.seven_day) merged.seven_day = live.seven_day;
      if (!merged.plan_type && live.plan_type) merged.plan_type = live.plan_type;
      if (!merged.model_name && live.model_name) merged.model_name = live.model_name;
    }
    if (merged.five_hour && merged.seven_day) break;
  }
  return merged;
}

export async function aggregateHistory(): Promise<CodexHistorical> {
  const out: CodexHistorical = {
    today_total: 0,
    today_cached: 0,
    month_total: 0,
    month_cached: 0,
  };
  const dir = sessionsDir();
  try {
    await fs.promises.access(dir);
  } catch {
    return out;
  }
  const files = await walkRollouts(dir);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  for (const f of files) {
    const date = dateFromFilename(path.basename(f));
    if (!date) continue;
    if (date < monthStart) continue;
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
