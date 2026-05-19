import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { AppConfig } from "../types";

function configPath(): string {
  return path.join(os.homedir(), ".claudegauge", "config.json");
}

const DEFAULT: AppConfig = {
  start_minimized: false,
  last_x: null,
  last_y: null,
};

export async function load(): Promise<AppConfig> {
  try {
    const txt = await fs.promises.readFile(configPath(), "utf8");
    return { ...DEFAULT, ...JSON.parse(txt) };
  } catch {
    return { ...DEFAULT };
  }
}

export async function save(cfg: AppConfig): Promise<void> {
  const p = configPath();
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, JSON.stringify(cfg, null, 2));
}
