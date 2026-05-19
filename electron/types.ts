export interface RateLimit {
  used_percent: number;
  resets_at: string;
}

export interface ClaudeLive {
  five_hour: RateLimit | null;
  seven_day: RateLimit | null;
  model_name: string | null;
  plan_type: string | null;
}

export interface CodexLive {
  five_hour: RateLimit | null;
  seven_day: RateLimit | null;
  plan_type: string | null;
  model_name: string | null;
}

export interface TokenBucket {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
}

export interface ClaudeHistorical {
  today: TokenBucket;
  month: TokenBucket;
  model_distribution: [string, number][];
}

export interface CodexHistorical {
  today_total: number;
  today_cached: number;
  month_total: number;
  month_cached: number;
}

export interface LiveSnapshot {
  claude: ClaudeLive | null;
  codex: CodexLive | null;
}

export interface HistoricalSnapshot {
  claude: ClaudeHistorical;
  codex: CodexHistorical;
}

export interface AppConfig {
  start_minimized: boolean;
  last_x: number | null;
  last_y: number | null;
  opacity: number;
  pinned: boolean;
}
