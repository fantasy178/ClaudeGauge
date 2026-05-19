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
  const p = await findLatestSession();
  if (!p) return null;
  const parsed = await parseSessionFile(p);
  return parsed.live;
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
