# ClaudeGauge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Windows 桌面 Tauri 2 app，即時顯示 Claude Code 與 Codex 訂閱制的 5H/7D rate limit 用量、今日/本月 token、快取命中率，並支援懸浮視窗與系統匣兩種模式。

**Architecture:** Tauri 2 (Rust 後端 + React 前端)。Rust 透過 `notify` crate 監聽 `~/.claude/claudegauge-live.json`（由 Claude Stop hook 寫入）和 `~/.codex/sessions/` 目錄。Tauri IPC 把即時與歷史數據 emit 給 React 顯示。

**Tech Stack:** Rust 1.80+、Tauri 2.x、React 19 + TypeScript、Vite、Zustand、`notify` crate、`serde_json`、`chrono`、`globwalk`。

**Spec Reference:** `docs/superpowers/specs/2026-05-20-claudegauge-design.md`

---

## File Structure

```
claudegauge/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── icons/
│   │   ├── tray-normal.png    (24x24 紫)
│   │   ├── tray-warning.png   (24x24 橘)
│   │   └── tray-danger.png    (24x24 紅)
│   └── src/
│       ├── main.rs             # Tauri 入口、tray 設定、視窗管理
│       ├── lib.rs              # 將 main 邏輯模組化
│       ├── models.rs           # 共用資料結構 (LiveData, HistoricalData, …)
│       ├── claude/
│       │   ├── mod.rs
│       │   ├── hook_writer.rs  # 自動寫入 settings.json 的 Stop hook
│       │   ├── live.rs         # 監聽 claudegauge-live.json
│       │   └── transcript.rs   # 解析 ~/.claude/projects/**
│       ├── codex/
│       │   ├── mod.rs
│       │   ├── live.rs         # 監聽 ~/.codex/sessions/
│       │   └── session.rs      # 解析 rollout-*.jsonl
│       ├── aggregator.rs       # 今日/本月彙整
│       ├── config.rs           # 讀寫 ~/.claudegauge/config.json
│       └── ipc.rs              # Tauri commands
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css                       # 全域樣式（紫色主題）
    ├── types.ts                        # 與 Rust models 對應的 TS types
    ├── store.ts                        # Zustand store
    ├── hooks/
    │   ├── useLiveData.ts              # listen Tauri events
    │   └── useHistoricalData.ts        # invoke('refresh_history')
    └── components/
        ├── FloatingWidget.tsx          # 視窗根元件
        ├── HeaderControls.tsx          # ⟳ ⊡ × 按鈕
        ├── ServiceSection.tsx          # Claude/Codex 共用的區塊
        ├── UsageBar.tsx                # 5H / 7D / 4 metric bars
        ├── ModelDistribution.tsx       # 紫/橘/青 三色 stacked bar
        └── CacheRate.tsx               # 快取命中率區塊
```

---

## Task 1: 建立 Tauri 2 專案骨架

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`

- [ ] **Step 1: 用 create-tauri-app 建立專案**

```bash
cd C:\Users\blue-\Desktop\AI\ClaudeGuage
npm create tauri-app@latest -- --template react-ts --manager npm --identifier com.claudegauge.app claudegauge-app
```

注意：產生在子目錄 `claudegauge-app/`，之後把其內容搬到專案根。

- [ ] **Step 2: 將子目錄內容移到專案根**

```bash
robocopy claudegauge-app . /E /MOVE
rmdir claudegauge-app
```

- [ ] **Step 3: 驗證 npm install 成功**

```bash
npm install
```

預期：`node_modules/` 出現，無錯誤。

- [ ] **Step 4: 修改 `src-tauri/tauri.conf.json` 加入懸浮視窗設定**

把 `app.windows[0]` 改為：

```json
{
  "label": "main",
  "title": "ClaudeGauge",
  "width": 240,
  "height": 220,
  "minWidth": 240,
  "maxWidth": 240,
  "resizable": false,
  "decorations": false,
  "transparent": true,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "visible": true
}
```

- [ ] **Step 5: 加入 Tauri tray 與 fs plugin 依賴**

修改 `src-tauri/Cargo.toml`，加入：

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-fs = "2"
tauri-plugin-store = "2"
notify = "6"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
chrono = { version = "0.4", features = ["serde"] }
globwalk = "0.9"
tokio = { version = "1", features = ["full"] }
anyhow = "1"
dirs = "5"
```

- [ ] **Step 6: 驗證 cargo build 成功**

```bash
cd src-tauri
cargo build
cd ..
```

預期：編譯通過（warning 可忽略）。

- [ ] **Step 7: 驗證 npm run tauri dev 能啟動空白視窗**

```bash
npm run tauri dev
```

預期：右下角出現一個 240×220 的透明小視窗，內容為 default React 範本。
按 Ctrl+C 停止。

- [ ] **Step 8: Commit**

```bash
git init
git add .
git commit -m "feat: bootstrap Tauri 2 + React project"
```

---

## Task 2: 定義共用資料模型 (Rust)

**Files:**
- Create: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/lib.rs`（建立並 `pub mod models;`）

- [ ] **Step 1: 寫測試 `src-tauri/src/models.rs` 結尾加入**

先建立空 `models.rs`，下面內容直接寫入：

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RateLimit {
    pub used_percent: f64,
    pub resets_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClaudeLive {
    pub five_hour: Option<RateLimit>,
    pub seven_day: Option<RateLimit>,
    pub model_name: Option<String>,
    pub session_started_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CodexLive {
    pub five_hour: Option<RateLimit>,
    pub seven_day: Option<RateLimit>,
    pub plan_type: Option<String>,
    pub model_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct TokenBucket {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_creation: u64,
}

impl TokenBucket {
    pub fn total(&self) -> u64 { self.input + self.output + self.cache_read + self.cache_creation }
    pub fn cache_hit_rate(&self) -> f64 {
        let denom = self.input + self.cache_read + self.cache_creation;
        if denom == 0 { 0.0 } else { self.cache_read as f64 / denom as f64 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct ClaudeHistorical {
    pub today: TokenBucket,
    pub month: TokenBucket,
    pub model_distribution: Vec<(String, u64)>, // (model_name, total_tokens)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct CodexHistorical {
    pub today_total: u64,
    pub today_cached: u64,
    pub month_total: u64,
    pub month_cached: u64,
}

impl CodexHistorical {
    pub fn today_cache_rate(&self) -> f64 {
        if self.today_total == 0 { 0.0 } else { self.today_cached as f64 / self.today_total as f64 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_bucket_total_sums_all_fields() {
        let b = TokenBucket { input: 10, output: 20, cache_read: 30, cache_creation: 40 };
        assert_eq!(b.total(), 100);
    }

    #[test]
    fn token_bucket_cache_hit_rate_correct() {
        let b = TokenBucket { input: 100, output: 50, cache_read: 200, cache_creation: 100 };
        // cache_read / (input + cache_read + cache_creation) = 200/400 = 0.5
        assert!((b.cache_hit_rate() - 0.5).abs() < 1e-9);
    }

    #[test]
    fn token_bucket_cache_hit_rate_zero_division_safe() {
        let b = TokenBucket::default();
        assert_eq!(b.cache_hit_rate(), 0.0);
    }
}
```

- [ ] **Step 2: 建立 lib.rs 並 export models**

寫入 `src-tauri/src/lib.rs`：

```rust
pub mod models;
```

- [ ] **Step 3: 跑測試確認通過**

```bash
cd src-tauri
cargo test --lib models
```

預期：3 passed.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/lib.rs
git commit -m "feat: define shared data models for live and historical metrics"
```

---

## Task 3: Claude Live 解析器

**Files:**
- Create: `src-tauri/src/claude/mod.rs`, `src-tauri/src/claude/live.rs`
- Modify: `src-tauri/src/lib.rs`（加入 `pub mod claude;`）

- [ ] **Step 1: 建立 mod.rs**

寫入 `src-tauri/src/claude/mod.rs`：

```rust
pub mod live;
pub mod hook_writer;
pub mod transcript;
```

（hook_writer 與 transcript 之後 task 才實作，先建空檔案）

```bash
type nul > src-tauri\src\claude\hook_writer.rs
type nul > src-tauri\src\claude\transcript.rs
```

- [ ] **Step 2: 寫測試 (在 live.rs 底部)**

寫入 `src-tauri/src/claude/live.rs`：

```rust
use crate::models::{ClaudeLive, RateLimit};
use chrono::{DateTime, TimeZone, Utc};
use serde_json::Value;
use std::path::Path;

pub fn parse_claude_live(json_text: &str) -> anyhow::Result<ClaudeLive> {
    let v: Value = serde_json::from_str(json_text)?;
    Ok(ClaudeLive {
        five_hour: parse_rate_limit(&v["rate_limits"]["five_hour"]),
        seven_day: parse_rate_limit(&v["rate_limits"]["seven_day"]),
        model_name: v["model"]["display_name"].as_str().map(String::from),
        session_started_at: None, // 從 transcript 算，這裡不處理
    })
}

fn parse_rate_limit(node: &Value) -> Option<RateLimit> {
    let used = node["used_percentage"].as_f64()?;
    let resets_unix = node["resets_at"].as_i64()?;
    let resets_at: DateTime<Utc> = Utc.timestamp_opt(resets_unix, 0).single()?;
    Some(RateLimit { used_percent: used, resets_at })
}

pub fn read_live_file(path: &Path) -> anyhow::Result<ClaudeLive> {
    let txt = std::fs::read_to_string(path)?;
    parse_claude_live(&txt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_live_payload() {
        let json = r#"{
            "model": {"display_name": "Claude Sonnet 4.6"},
            "rate_limits": {
                "five_hour": {"used_percentage": 2.5, "resets_at": 1779210000},
                "seven_day": {"used_percentage": 10.0, "resets_at": 1779800000}
            }
        }"#;
        let live = parse_claude_live(json).unwrap();
        assert_eq!(live.model_name.as_deref(), Some("Claude Sonnet 4.6"));
        assert_eq!(live.five_hour.as_ref().unwrap().used_percent, 2.5);
        assert_eq!(live.seven_day.as_ref().unwrap().used_percent, 10.0);
    }

    #[test]
    fn missing_rate_limits_returns_none() {
        let json = r#"{"model": {"display_name": "X"}}"#;
        let live = parse_claude_live(json).unwrap();
        assert!(live.five_hour.is_none());
        assert!(live.seven_day.is_none());
    }

    #[test]
    fn invalid_json_returns_err() {
        assert!(parse_claude_live("not json").is_err());
    }
}
```

- [ ] **Step 3: 更新 lib.rs**

把 `src-tauri/src/lib.rs` 內容換為：

```rust
pub mod models;
pub mod claude;
```

- [ ] **Step 4: 跑測試**

```bash
cd src-tauri
cargo test --lib claude::live
```

預期：3 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/claude
git commit -m "feat: parse Claude live JSON from Stop hook output"
```

---

## Task 4: Claude Transcript 解析器

**Files:**
- Modify: `src-tauri/src/claude/transcript.rs`

- [ ] **Step 1: 寫測試 + 實作**

寫入 `src-tauri/src/claude/transcript.rs`：

```rust
use crate::models::{ClaudeHistorical, TokenBucket};
use chrono::{DateTime, Datelike, Local, TimeZone, Utc};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;

/// 一筆 transcript 訊息的彙整輸出
#[derive(Debug, Clone, PartialEq)]
pub struct MessageRecord {
    pub timestamp: DateTime<Utc>,
    pub model: String,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_creation: u64,
}

pub fn parse_transcript_file(path: &Path) -> anyhow::Result<Vec<MessageRecord>> {
    let file = std::fs::File::open(path)?;
    let reader = BufReader::new(file);
    let mut out = Vec::new();
    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() { continue; }
        let v: Value = match serde_json::from_str(&line) {
            Ok(x) => x,
            Err(_) => continue,
        };
        if let Some(rec) = extract_record(&v) {
            out.push(rec);
        }
    }
    Ok(out)
}

fn extract_record(v: &Value) -> Option<MessageRecord> {
    let ts_str = v["timestamp"].as_str()?;
    let timestamp = DateTime::parse_from_rfc3339(ts_str).ok()?.with_timezone(&Utc);
    let usage = &v["message"]["usage"];
    let model = v["message"]["model"].as_str()?.to_string();
    Some(MessageRecord {
        timestamp,
        model,
        input: usage["input_tokens"].as_u64().unwrap_or(0),
        output: usage["output_tokens"].as_u64().unwrap_or(0),
        cache_read: usage["cache_read_input_tokens"].as_u64().unwrap_or(0),
        cache_creation: usage["cache_creation_input_tokens"].as_u64().unwrap_or(0),
    })
}

pub fn aggregate_records(records: &[MessageRecord], now: DateTime<Utc>) -> ClaudeHistorical {
    let now_local = now.with_timezone(&Local);
    let today_start = Local.with_ymd_and_hms(now_local.year(), now_local.month(), now_local.day(), 0, 0, 0).single().unwrap();
    let month_start = Local.with_ymd_and_hms(now_local.year(), now_local.month(), 1, 0, 0, 0).single().unwrap();

    let mut today = TokenBucket::default();
    let mut month = TokenBucket::default();
    let mut by_model: HashMap<String, u64> = HashMap::new();

    for r in records {
        let ts_local = r.timestamp.with_timezone(&Local);
        if ts_local >= month_start {
            month.input += r.input;
            month.output += r.output;
            month.cache_read += r.cache_read;
            month.cache_creation += r.cache_creation;
            *by_model.entry(r.model.clone()).or_default() +=
                r.input + r.output + r.cache_read + r.cache_creation;
        }
        if ts_local >= today_start {
            today.input += r.input;
            today.output += r.output;
            today.cache_read += r.cache_read;
            today.cache_creation += r.cache_creation;
        }
    }

    let mut model_distribution: Vec<(String, u64)> = by_model.into_iter().collect();
    model_distribution.sort_by(|a, b| b.1.cmp(&a.1));

    ClaudeHistorical { today, month, model_distribution }
}

pub fn scan_all_transcripts(claude_dir: &Path) -> anyhow::Result<Vec<MessageRecord>> {
    let pattern = format!("{}/**/*.jsonl", claude_dir.join("projects").display());
    let pattern = pattern.replace('\\', "/");
    let mut all = Vec::new();
    for entry in globwalk::glob(&pattern)? {
        let entry = entry?;
        if let Ok(recs) = parse_transcript_file(entry.path()) {
            all.extend(recs);
        }
    }
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn make_jsonl(lines: &[&str]) -> NamedTempFile {
        let mut f = NamedTempFile::new().unwrap();
        for l in lines { writeln!(f, "{}", l).unwrap(); }
        f
    }

    #[test]
    fn parses_a_well_formed_line() {
        let f = make_jsonl(&[r#"{"timestamp":"2026-05-20T10:00:00Z","message":{"model":"Claude Sonnet 4.6","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":200,"cache_creation_input_tokens":10}}}"#]);
        let recs = parse_transcript_file(f.path()).unwrap();
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].input, 100);
        assert_eq!(recs[0].cache_read, 200);
    }

    #[test]
    fn ignores_malformed_lines() {
        let f = make_jsonl(&["not json", r#"{"timestamp":"2026-05-20T10:00:00Z","message":{"model":"X","usage":{"input_tokens":5}}}"#]);
        let recs = parse_transcript_file(f.path()).unwrap();
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].input, 5);
    }

    #[test]
    fn aggregate_filters_today_and_month() {
        let now = Utc.with_ymd_and_hms(2026, 5, 20, 12, 0, 0).unwrap();
        let today_record = MessageRecord {
            timestamp: Utc.with_ymd_and_hms(2026, 5, 20, 10, 0, 0).unwrap(),
            model: "Sonnet".into(), input: 100, output: 50, cache_read: 0, cache_creation: 0,
        };
        let earlier_month = MessageRecord {
            timestamp: Utc.with_ymd_and_hms(2026, 5, 1, 8, 0, 0).unwrap(),
            model: "Opus".into(), input: 200, output: 100, cache_read: 0, cache_creation: 0,
        };
        let last_month = MessageRecord {
            timestamp: Utc.with_ymd_and_hms(2026, 4, 30, 8, 0, 0).unwrap(),
            model: "Sonnet".into(), input: 999, output: 999, cache_read: 0, cache_creation: 0,
        };
        let h = aggregate_records(&[today_record, earlier_month, last_month], now);
        assert_eq!(h.today.input, 100);
        assert_eq!(h.today.output, 50);
        assert_eq!(h.month.input, 300);
        assert_eq!(h.month.output, 150);
        assert_eq!(h.model_distribution.len(), 2);
    }
}
```

- [ ] **Step 2: 加入 dev-dependencies**

修改 `src-tauri/Cargo.toml` 增加：

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 3: 跑測試**

```bash
cd src-tauri
cargo test --lib claude::transcript
```

預期：3 passed.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/claude/transcript.rs src-tauri/Cargo.toml
git commit -m "feat: parse Claude transcripts and aggregate today/month/model"
```

---

## Task 5: Codex Live + Session 解析器

**Files:**
- Create: `src-tauri/src/codex/mod.rs`, `src-tauri/src/codex/live.rs`, `src-tauri/src/codex/session.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 建立 mod.rs**

```rust
// src-tauri/src/codex/mod.rs
pub mod live;
pub mod session;
```

- [ ] **Step 2: 寫 session.rs 解析 token_count 事件**

寫入 `src-tauri/src/codex/session.rs`：

```rust
use crate::models::{CodexLive, RateLimit, CodexHistorical};
use chrono::{DateTime, Datelike, Local, NaiveDate, TimeZone, Utc};
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct SessionTokens {
    pub input: u64,
    pub cached: u64,
    pub output: u64,
    pub reasoning: u64,
}

/// 解析一個 Codex rollout JSONL 檔案，回傳 (latest_live, total_tokens)
pub fn parse_session_file(path: &Path) -> anyhow::Result<(Option<CodexLive>, SessionTokens)> {
    let file = std::fs::File::open(path)?;
    let reader = BufReader::new(file);
    let mut latest_live: Option<CodexLive> = None;
    let mut totals = SessionTokens::default();
    let mut latest_model: Option<String> = None;

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() { continue; }
        let v: Value = match serde_json::from_str(&line) {
            Ok(x) => x,
            Err(_) => continue,
        };
        let t = v["type"].as_str().unwrap_or("");
        if t == "turn_context" {
            if let Some(m) = v["payload"]["model"].as_str() {
                latest_model = Some(m.to_string());
            }
        } else if t == "event_msg" && v["payload"]["type"].as_str() == Some("token_count") {
            let rl = &v["payload"]["rate_limits"];
            latest_live = Some(CodexLive {
                five_hour: parse_codex_rate_limit(&rl["primary"]),
                seven_day: parse_codex_rate_limit(&rl["secondary"]),
                plan_type: rl["plan_type"].as_str().map(String::from),
                model_name: latest_model.clone(),
            });
            let info = &v["payload"]["info"]["total_token_usage"];
            // 取最後一個 token_count 的累計值即為 session 結束時的累計
            totals.input = info["input_tokens"].as_u64().unwrap_or(totals.input);
            totals.cached = info["cached_input_tokens"].as_u64().unwrap_or(totals.cached);
            totals.output = info["output_tokens"].as_u64().unwrap_or(totals.output);
            totals.reasoning = info["reasoning_output_tokens"].as_u64().unwrap_or(totals.reasoning);
        }
    }
    Ok((latest_live, totals))
}

fn parse_codex_rate_limit(node: &Value) -> Option<RateLimit> {
    let used = node["used_percent"].as_f64()?;
    let resets_unix = node["resets_at"].as_i64()?;
    let resets_at: DateTime<Utc> = Utc.timestamp_opt(resets_unix, 0).single()?;
    Some(RateLimit { used_percent: used, resets_at })
}

/// 從檔名 "rollout-2026-05-15T08-37-51-...jsonl" 取得日期
pub fn date_from_filename(name: &str) -> Option<NaiveDate> {
    let prefix = "rollout-";
    let rest = name.strip_prefix(prefix)?;
    let date_part = rest.get(..10)?; // "2026-05-15"
    NaiveDate::parse_from_str(date_part, "%Y-%m-%d").ok()
}

pub fn scan_all_sessions(codex_dir: &Path, now: DateTime<Utc>) -> anyhow::Result<CodexHistorical> {
    let pattern = format!("{}/**/rollout-*.jsonl", codex_dir.join("sessions").display());
    let pattern = pattern.replace('\\', "/");
    let now_local = now.with_timezone(&Local).date_naive();
    let month_start = NaiveDate::from_ymd_opt(now_local.year(), now_local.month(), 1).unwrap();

    let mut h = CodexHistorical::default();
    for entry in globwalk::glob(&pattern)? {
        let entry = entry?;
        let fname = entry.file_name().to_string_lossy().to_string();
        let date = match date_from_filename(&fname) {
            Some(d) => d,
            None => continue,
        };
        if date < month_start { continue; }
        let (_live, tokens) = match parse_session_file(entry.path()) {
            Ok(x) => x,
            Err(_) => continue,
        };
        let total = tokens.input + tokens.output;
        h.month_total += total;
        h.month_cached += tokens.cached;
        if date == now_local {
            h.today_total += total;
            h.today_cached += tokens.cached;
        }
    }
    Ok(h)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn parses_token_count_and_rate_limits() {
        let mut f = NamedTempFile::new().unwrap();
        writeln!(f, r#"{{"type":"turn_context","payload":{{"model":"gpt-5.5"}}}}"#).unwrap();
        writeln!(f, r#"{{"type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":17672,"cached_input_tokens":8576,"output_tokens":755,"reasoning_output_tokens":516}}}},"rate_limits":{{"plan_type":"plus","primary":{{"used_percent":1.0,"resets_at":1778823479}},"secondary":{{"used_percent":7.0,"resets_at":1779342007}}}}}}}}"#).unwrap();

        let (live, totals) = parse_session_file(f.path()).unwrap();
        let live = live.unwrap();
        assert_eq!(live.plan_type.as_deref(), Some("plus"));
        assert_eq!(live.model_name.as_deref(), Some("gpt-5.5"));
        assert_eq!(live.five_hour.unwrap().used_percent, 1.0);
        assert_eq!(live.seven_day.unwrap().used_percent, 7.0);
        assert_eq!(totals.input, 17672);
        assert_eq!(totals.cached, 8576);
    }

    #[test]
    fn date_extraction_works() {
        assert_eq!(
            date_from_filename("rollout-2026-05-15T08-37-51-abc.jsonl"),
            Some(NaiveDate::from_ymd_opt(2026, 5, 15).unwrap())
        );
        assert!(date_from_filename("garbage").is_none());
    }
}
```

- [ ] **Step 3: 寫 live.rs（薄包裝層）**

寫入 `src-tauri/src/codex/live.rs`：

```rust
use crate::models::CodexLive;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

pub fn find_latest_session(codex_dir: &Path) -> anyhow::Result<Option<PathBuf>> {
    let pattern = format!("{}/**/rollout-*.jsonl", codex_dir.join("sessions").display());
    let pattern = pattern.replace('\\', "/");
    let mut best: Option<(SystemTime, PathBuf)> = None;
    for entry in globwalk::glob(&pattern)? {
        let entry = entry?;
        let mtime = entry.metadata()?.modified()?;
        if best.as_ref().map_or(true, |b| mtime > b.0) {
            best = Some((mtime, entry.path().to_path_buf()));
        }
    }
    Ok(best.map(|(_, p)| p))
}

pub fn read_latest_codex_live(codex_dir: &Path) -> anyhow::Result<Option<CodexLive>> {
    let Some(path) = find_latest_session(codex_dir)? else { return Ok(None); };
    let (live, _) = crate::codex::session::parse_session_file(&path)?;
    Ok(live)
}
```

- [ ] **Step 4: 更新 lib.rs**

```rust
pub mod models;
pub mod claude;
pub mod codex;
```

- [ ] **Step 5: 跑測試**

```bash
cd src-tauri
cargo test --lib codex
```

預期：2 passed.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/codex src-tauri/src/lib.rs
git commit -m "feat: parse Codex session JSONL for rate limits and tokens"
```

---

## Task 6: Claude Hook 自動安裝

**Files:**
- Modify: `src-tauri/src/claude/hook_writer.rs`

- [ ] **Step 1: 寫測試 + 實作**

寫入 `src-tauri/src/claude/hook_writer.rs`：

```rust
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const HOOK_MARKER: &str = "claudegauge-hook";

/// 在 ~/.claude/settings.json 注入 Stop hook 寫 claudegauge-live.json
pub fn ensure_stop_hook(claude_dir: &Path) -> anyhow::Result<()> {
    let settings_path = claude_dir.join("settings.json");
    let mut root: Value = if settings_path.exists() {
        let txt = std::fs::read_to_string(&settings_path)?;
        if txt.trim().is_empty() { json!({}) } else { serde_json::from_str(&txt)? }
    } else {
        json!({})
    };

    let hooks = root.get_mut("hooks").and_then(Value::as_object_mut);
    // 確保 root.hooks 是物件
    if hooks.is_none() {
        root["hooks"] = json!({});
    }
    let stop_arr = root["hooks"].as_object_mut().unwrap()
        .entry("Stop".to_string()).or_insert(json!([]));
    let arr = stop_arr.as_array_mut().expect("Stop hooks must be array");

    // 是否已存在我們的 hook？
    let already = arr.iter().any(|h| {
        h.get("hooks").and_then(Value::as_array).map_or(false, |inner| {
            inner.iter().any(|x| x.get("comment").and_then(Value::as_str) == Some(HOOK_MARKER))
        })
    });
    if already { return Ok(()); }

    let live_path = claude_dir.join("claudegauge-live.json");
    let cmd = if cfg!(windows) {
        format!("more > \"{}\"", live_path.display())
    } else {
        format!("cat > \"{}\"", live_path.display())
    };

    arr.push(json!({
        "matcher": "",
        "hooks": [{
            "type": "command",
            "command": cmd,
            "comment": HOOK_MARKER
        }]
    }));

    std::fs::write(&settings_path, serde_json::to_string_pretty(&root)?)?;
    Ok(())
}

/// 反向操作：移除我們的 hook
pub fn remove_stop_hook(claude_dir: &Path) -> anyhow::Result<()> {
    let settings_path = claude_dir.join("settings.json");
    if !settings_path.exists() { return Ok(()); }
    let txt = std::fs::read_to_string(&settings_path)?;
    if txt.trim().is_empty() { return Ok(()); }
    let mut root: Value = serde_json::from_str(&txt)?;
    if let Some(stop_arr) = root.pointer_mut("/hooks/Stop").and_then(Value::as_array_mut) {
        stop_arr.retain(|h| {
            !h.get("hooks").and_then(Value::as_array).map_or(false, |inner| {
                inner.iter().any(|x| x.get("comment").and_then(Value::as_str) == Some(HOOK_MARKER))
            })
        });
    }
    std::fs::write(&settings_path, serde_json::to_string_pretty(&root)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn creates_settings_with_hook_when_missing() {
        let dir = TempDir::new().unwrap();
        ensure_stop_hook(dir.path()).unwrap();
        let txt = std::fs::read_to_string(dir.path().join("settings.json")).unwrap();
        assert!(txt.contains(HOOK_MARKER));
    }

    #[test]
    fn idempotent_when_already_installed() {
        let dir = TempDir::new().unwrap();
        ensure_stop_hook(dir.path()).unwrap();
        ensure_stop_hook(dir.path()).unwrap();
        let txt = std::fs::read_to_string(dir.path().join("settings.json")).unwrap();
        let count = txt.matches(HOOK_MARKER).count();
        assert_eq!(count, 1, "hook should be installed exactly once");
    }

    #[test]
    fn remove_removes_our_hook_only() {
        let dir = TempDir::new().unwrap();
        let existing = serde_json::json!({
            "hooks": {
                "Stop": [
                    {"matcher": "", "hooks": [{"type":"command","command":"echo other"}]}
                ]
            }
        });
        std::fs::write(dir.path().join("settings.json"), existing.to_string()).unwrap();
        ensure_stop_hook(dir.path()).unwrap();
        remove_stop_hook(dir.path()).unwrap();
        let txt = std::fs::read_to_string(dir.path().join("settings.json")).unwrap();
        assert!(!txt.contains(HOOK_MARKER));
        assert!(txt.contains("echo other"));
    }
}
```

- [ ] **Step 2: 跑測試**

```bash
cd src-tauri
cargo test --lib claude::hook_writer
```

預期：3 passed.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/claude/hook_writer.rs
git commit -m "feat: install and remove Claude Stop hook idempotently"
```

---

## Task 7: 檔案監聽 + IPC commands

**Files:**
- Create: `src-tauri/src/ipc.rs`
- Modify: `src-tauri/src/lib.rs`、`src-tauri/src/main.rs`

- [ ] **Step 1: 寫 IPC commands**

寫入 `src-tauri/src/ipc.rs`：

```rust
use crate::claude::{live as claude_live, transcript as claude_transcript, hook_writer};
use crate::codex::{live as codex_live, session as codex_session};
use crate::models::*;
use chrono::Utc;
use serde::Serialize;
use std::path::PathBuf;

fn home_claude() -> PathBuf { dirs::home_dir().unwrap().join(".claude") }
fn home_codex() -> PathBuf { dirs::home_dir().unwrap().join(".codex") }

#[derive(Serialize, Clone)]
pub struct LiveSnapshot {
    pub claude: Option<ClaudeLive>,
    pub codex: Option<CodexLive>,
}

#[derive(Serialize, Clone)]
pub struct HistoricalSnapshot {
    pub claude: ClaudeHistorical,
    pub codex: CodexHistorical,
}

#[tauri::command]
pub fn install_hook() -> Result<(), String> {
    hook_writer::ensure_stop_hook(&home_claude()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_hook() -> Result<(), String> {
    hook_writer::remove_stop_hook(&home_claude()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_live() -> Result<LiveSnapshot, String> {
    let claude = claude_live::read_live_file(&home_claude().join("claudegauge-live.json")).ok();
    let codex = codex_live::read_latest_codex_live(&home_codex()).ok().flatten();
    Ok(LiveSnapshot { claude, codex })
}

#[tauri::command]
pub fn refresh_history() -> Result<HistoricalSnapshot, String> {
    let claude_records = claude_transcript::scan_all_transcripts(&home_claude()).map_err(|e| e.to_string())?;
    let claude = claude_transcript::aggregate_records(&claude_records, Utc::now());
    let codex = codex_session::scan_all_sessions(&home_codex(), Utc::now()).map_err(|e| e.to_string())?;
    Ok(HistoricalSnapshot { claude, codex })
}
```

- [ ] **Step 2: 更新 lib.rs**

```rust
pub mod models;
pub mod claude;
pub mod codex;
pub mod ipc;
```

- [ ] **Step 3: 在 main.rs 中註冊 commands 並啟動 file watcher**

修改 `src-tauri/src/main.rs`：

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use claudegauge_lib::claude::{live as claude_live, hook_writer};
use claudegauge_lib::codex::live as codex_live;
use claudegauge_lib::ipc::*;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager, Emitter};

fn home_claude() -> PathBuf { dirs::home_dir().unwrap().join(".claude") }
fn home_codex() -> PathBuf { dirs::home_dir().unwrap().join(".codex") }

fn spawn_watchers(app: AppHandle) {
    let app1 = app.clone();
    thread::spawn(move || {
        let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher = RecommendedWatcher::new(tx, notify::Config::default()).unwrap();
        let claude_live_path = home_claude().join("claudegauge-live.json");
        if claude_live_path.exists() {
            watcher.watch(&claude_live_path, RecursiveMode::NonRecursive).ok();
        }
        let codex_sessions = home_codex().join("sessions");
        if codex_sessions.exists() {
            watcher.watch(&codex_sessions, RecursiveMode::Recursive).ok();
        }
        while let Ok(event) = rx.recv() {
            if event.is_ok() {
                // 簡單去抖：稍微等一下再讀
                thread::sleep(Duration::from_millis(100));
                if let Ok(snap) = get_live() {
                    let _ = app1.emit("live-update", snap);
                }
            }
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            install_hook,
            remove_hook,
            get_live,
            refresh_history
        ])
        .setup(|app| {
            // 嘗試安裝 hook（idempotent）
            let _ = hook_writer::ensure_stop_hook(&home_claude());
            // 啟動 watcher
            spawn_watchers(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: 確認 Cargo.toml 的 lib name**

確認 `src-tauri/Cargo.toml` 內有：

```toml
[lib]
name = "claudegauge_lib"
crate-type = ["staticlib", "cdylib", "rlib"]
```

如果沒有就加上。

- [ ] **Step 5: cargo build**

```bash
cd src-tauri
cargo build
```

預期：成功編譯。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/ipc.rs src-tauri/src/main.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat: wire IPC commands and file watchers"
```

---

## Task 8: TypeScript Types 與 Zustand Store

**Files:**
- Create: `src/types.ts`, `src/store.ts`, `src/hooks/useLiveData.ts`, `src/hooks/useHistoricalData.ts`

- [ ] **Step 1: 寫 types.ts**

```typescript
// src/types.ts
export interface RateLimit {
  used_percent: number;
  resets_at: string; // ISO date string
}

export interface ClaudeLive {
  five_hour: RateLimit | null;
  seven_day: RateLimit | null;
  model_name: string | null;
  session_started_at: string | null;
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
```

- [ ] **Step 2: 寫 store.ts**

```typescript
// src/store.ts
import { create } from 'zustand';
import type { LiveSnapshot, HistoricalSnapshot } from './types';

interface UIState {
  expanded: boolean;
  toggleExpanded: () => void;
}

interface DataState {
  live: LiveSnapshot;
  history: HistoricalSnapshot | null;
  lastRefreshed: Date | null;
  setLive: (l: LiveSnapshot) => void;
  setHistory: (h: HistoricalSnapshot) => void;
}

export const useUI = create<UIState>((set) => ({
  expanded: false,
  toggleExpanded: () => set(s => ({ expanded: !s.expanded }))
}));

export const useData = create<DataState>((set) => ({
  live: { claude: null, codex: null },
  history: null,
  lastRefreshed: null,
  setLive: (live) => set({ live }),
  setHistory: (history) => set({ history, lastRefreshed: new Date() })
}));
```

- [ ] **Step 3: 安裝 zustand**

```bash
npm install zustand
```

- [ ] **Step 4: 寫 hooks**

```typescript
// src/hooks/useLiveData.ts
import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useData } from '../store';
import type { LiveSnapshot } from '../types';

export function useLiveData() {
  const setLive = useData(s => s.setLive);
  useEffect(() => {
    invoke<LiveSnapshot>('get_live').then(setLive).catch(console.error);
    const unlisten = listen<LiveSnapshot>('live-update', (e) => setLive(e.payload));
    return () => { unlisten.then(fn => fn()); };
  }, [setLive]);
}
```

```typescript
// src/hooks/useHistoricalData.ts
import { useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useData } from '../store';
import type { HistoricalSnapshot } from '../types';

export function useHistoricalData() {
  const setHistory = useData(s => s.setHistory);

  const refresh = useCallback(async () => {
    try {
      const h = await invoke<HistoricalSnapshot>('refresh_history');
      setHistory(h);
    } catch (e) {
      console.error('refresh_history failed', e);
    }
  }, [setHistory]);

  useEffect(() => { refresh(); }, [refresh]);

  return { refresh };
}
```

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/store.ts src/hooks package.json package-lock.json
git commit -m "feat: add TS types, Zustand store, and data hooks"
```

---

## Task 9: 共用元件 UsageBar

**Files:**
- Create: `src/components/UsageBar.tsx`, `src/index.css`

- [ ] **Step 1: 寫 UsageBar 元件**

```tsx
// src/components/UsageBar.tsx
import './UsageBar.css';

interface Props {
  label: string;        // "5H" / "7D"
  percent: number;      // 0-100
  resetsAt: string | null;  // ISO timestamp
  color: 'claude' | 'codex';
}

function formatResetTime(resetsAt: string | null, kind: '5h' | '7d'): string {
  if (!resetsAt) return '';
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = date.getTime() - Date.now();
  if (kind === '5h') {
    return 'resets ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  // 7d → 顯示剩餘時間
  const totalMin = Math.max(0, Math.floor(diffMs / 60000));
  const d = Math.floor(totalMin / (60 * 24));
  const h = Math.floor((totalMin % (60 * 24)) / 60);
  return `resets ${d}d${h}h`;
}

export function UsageBar({ label, percent, resetsAt, color }: Props) {
  const kind: '5h' | '7d' = label === '5H' ? '5h' : '7d';
  return (
    <div className={`usage-bar usage-bar--${color}`}>
      <div className="usage-bar__row">
        <span className="usage-bar__label">{label}</span>
        <span className="usage-bar__meta">
          <span className="usage-bar__pct">{percent.toFixed(0)}%</span>
          <span className="usage-bar__reset">{formatResetTime(resetsAt, kind)}</span>
        </span>
      </div>
      <div className="usage-bar__track">
        <div className="usage-bar__fill" style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 寫 UsageBar.css**

```css
/* src/components/UsageBar.css */
.usage-bar { margin-bottom: 5px; }
.usage-bar__row {
  display: flex; justify-content: space-between;
  margin-bottom: 2px; font-size: 9px;
}
.usage-bar__label { color: #6b7280; }
.usage-bar__meta { display: flex; gap: 6px; }
.usage-bar__pct { font-weight: 600; }
.usage-bar__reset { color: #4b5563; }
.usage-bar__track {
  background: #2d2d4e;
  border-radius: 4px;
  height: 5px;
  overflow: hidden;
}
.usage-bar__fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}
.usage-bar--claude .usage-bar__pct { color: #a78bfa; }
.usage-bar--claude .usage-bar__fill {
  background: linear-gradient(90deg, #7c3aed, #a78bfa);
}
.usage-bar--codex { /* override track color */ }
.usage-bar--codex .usage-bar__track { background: #1a3a2a; }
.usage-bar--codex .usage-bar__pct { color: #34d399; }
.usage-bar--codex .usage-bar__fill {
  background: linear-gradient(90deg, #059669, #34d399);
}
```

- [ ] **Step 3: 寫全域 index.css**

```css
/* src/index.css */
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  background: transparent;
  font-family: system-ui, sans-serif;
  -webkit-user-select: none;
  user-select: none;
  overflow: hidden;
}
#root { padding: 8px; }
.widget {
  background: #1a1a2e;
  border: 1px solid #7c3aed;
  border-radius: 10px;
  padding: 12px;
  box-shadow: 0 4px 24px rgba(124,58,237,0.3);
  color: #e9d5ff;
}
.widget__controls {
  display: flex; justify-content: flex-end; gap: 6px;
  margin-bottom: 8px;
}
.widget__btn {
  background: none; border: 0; padding: 0;
  color: #6b7280; font-size: 11px;
  cursor: pointer;
}
.widget__btn:hover { color: #a78bfa; }
.divider { border-top: 1px solid #2d2d4e; margin: 10px 0; }
```

- [ ] **Step 4: Commit**

```bash
git add src/components/UsageBar.tsx src/components/UsageBar.css src/index.css
git commit -m "feat: UsageBar component with reset countdown"
```

---

## Task 10: ServiceSection 與 ClaudeSection / CodexSection

**Files:**
- Create: `src/components/ServiceSection.tsx`, `src/components/ServiceSection.css`, `src/components/ClaudeSection.tsx`, `src/components/CodexSection.tsx`, `src/components/ModelDistribution.tsx`

- [ ] **Step 1: ServiceSection（共用標題列）**

```tsx
// src/components/ServiceSection.tsx
import './ServiceSection.css';

interface Props {
  name: 'CLAUDE' | 'CODEX';
  color: 'claude' | 'codex';
  meta?: string;        // "plus · gpt-5.5" or "34m · Sonnet 4.6"
  children: React.ReactNode;
}

export function ServiceSection({ name, color, meta, children }: Props) {
  return (
    <section className={`service service--${color}`}>
      <header className="service__head">
        <span className="service__dot" />
        <span className="service__name">{name}</span>
        {meta && <span className="service__meta">{meta}</span>}
      </header>
      {children}
    </section>
  );
}
```

```css
/* src/components/ServiceSection.css */
.service { margin-bottom: 6px; }
.service__head {
  display: flex; align-items: center;
  gap: 5px; margin-bottom: 7px;
}
.service__dot { width: 7px; height: 7px; border-radius: 50%; }
.service__name {
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.5px;
}
.service__meta {
  font-size: 8px; color: #4b5563;
  margin-left: auto;
}
.service--claude .service__dot { background: #a78bfa; }
.service--claude .service__name { color: #a78bfa; }
.service--codex .service__dot { background: #34d399; }
.service--codex .service__name { color: #34d399; }
```

- [ ] **Step 2: ModelDistribution（色盲友善）**

```tsx
// src/components/ModelDistribution.tsx
const MODEL_COLORS: Array<[RegExp, string, string]> = [
  [/sonnet/i, '#7c3aed', '#a78bfa'],   // 紫
  [/opus/i,   '#f59e0b', '#fbbf24'],   // 橘
  [/haiku/i,  '#06b6d4', '#22d3ee'],   // 青
  [/.*/,      '#6b7280', '#9ca3af'],   // 灰（fallback）
];

function colorFor(model: string): string {
  const [, from, to] = MODEL_COLORS.find(([r]) => r.test(model))!;
  return `linear-gradient(90deg, ${from}, ${to})`;
}

interface Props { distribution: [string, number][]; }

export function ModelDistribution({ distribution }: Props) {
  const total = distribution.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return null;
  return (
    <div style={{ background:'#0f0f1a', border:'1px solid #2d2d4e',
                  borderRadius:6, padding:7, marginBottom:5 }}>
      <div style={{ fontSize:8, color:'#6b7280', marginBottom:5 }}>模型分佈</div>
      <div style={{ display:'flex', height:7, borderRadius:4, overflow:'hidden', marginBottom:5 }}>
        {distribution.map(([model, n]) => (
          <div key={model} style={{ flex:n / total, background: colorFor(model) }} />
        ))}
      </div>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
        {distribution.map(([model, n]) => (
          <span key={model} style={{ display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ width:8, height:8, borderRadius:2, background: colorFor(model) }} />
            <span style={{ fontSize:8, color:'#e9d5ff' }}>
              {model.replace(/^claude /i, '').replace(/-.*/,'')} {Math.round(n / total * 100)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: ClaudeSection**

```tsx
// src/components/ClaudeSection.tsx
import { useData, useUI } from '../store';
import { ServiceSection } from './ServiceSection';
import { UsageBar } from './UsageBar';
import { ModelDistribution } from './ModelDistribution';

export function ClaudeSection() {
  const live = useData(s => s.live.claude);
  const hist = useData(s => s.history?.claude);
  const expanded = useUI(s => s.expanded);
  const bucket = hist?.today;
  const monthBucket = hist?.month;

  const todayTotal = bucket ? bucket.input + bucket.output + bucket.cache_read + bucket.cache_creation : 0;
  const monthTotal = monthBucket ? monthBucket.input + monthBucket.output + monthBucket.cache_read + monthBucket.cache_creation : 0;
  const cacheDenom = bucket ? bucket.input + bucket.cache_read + bucket.cache_creation : 0;
  const cacheRate = bucket && cacheDenom > 0 ? bucket.cache_read / cacheDenom : 0;
  const savedTokens = bucket ? bucket.cache_read : 0;

  return (
    <ServiceSection name="CLAUDE" color="claude" meta={live?.model_name ?? undefined}>
      <UsageBar label="5H" percent={live?.five_hour?.used_percent ?? 0}
                resetsAt={live?.five_hour?.resets_at ?? null} color="claude" />
      <UsageBar label="7D" percent={live?.seven_day?.used_percent ?? 0}
                resetsAt={live?.seven_day?.resets_at ?? null} color="claude" />

      {expanded ? (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5, marginBottom:5 }}>
            <div style={cardStyle}>
              <div style={lbl}>今日 Token</div>
              <div style={val}>{fmt(todayTotal)}</div>
            </div>
            <div style={cardStyle}>
              <div style={lbl}>本月</div>
              <div style={val}>{fmt(monthTotal)}</div>
            </div>
          </div>
          <ModelDistribution distribution={hist?.model_distribution ?? []} />
          <div style={cardStyle}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
              <span style={lbl}>快取命中率</span>
              <span style={{ fontSize:8, color:'#a78bfa' }}>節省 {fmt(savedTokens)}</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <div style={{ flex:1, background:'#2d2d4e', height:4, borderRadius:4 }}>
                <div style={{ width:`${cacheRate * 100}%`, height:4, borderRadius:4,
                              background:'linear-gradient(90deg,#7c3aed,#a78bfa)' }} />
              </div>
              <span style={{ fontSize:11, color:'#e9d5ff', fontWeight:600 }}>
                {Math.round(cacheRate * 100)}%
              </span>
            </div>
          </div>
        </>
      ) : (
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end' }}>
          <div>
            <div style={lbl}>今日</div>
            <div style={val}>{fmt(todayTotal)}</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={lbl}>快取命中率</div>
            <div style={{ ...val, color:'#a78bfa' }}>
              {Math.round(cacheRate * 100)}%
              <span style={{ fontSize:8, color:'#4b5563', marginLeft:4 }}>節省 {fmt(savedTokens)}</span>
            </div>
          </div>
        </div>
      )}
    </ServiceSection>
  );
}

const cardStyle: React.CSSProperties = {
  background:'#0f0f1a', border:'1px solid #2d2d4e', borderRadius:6, padding:7,
};
const lbl: React.CSSProperties = { fontSize:8, color:'#6b7280', marginBottom:2 };
const val: React.CSSProperties = { fontSize:11, color:'#e9d5ff', fontWeight:600 };

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
```

- [ ] **Step 4: CodexSection**

```tsx
// src/components/CodexSection.tsx
import { useData, useUI } from '../store';
import { ServiceSection } from './ServiceSection';
import { UsageBar } from './UsageBar';

export function CodexSection() {
  const live = useData(s => s.live.codex);
  const hist = useData(s => s.history?.codex);
  const expanded = useUI(s => s.expanded);
  const today = hist?.today_total ?? 0;
  const month = hist?.month_total ?? 0;
  const cacheRate = hist && hist.today_total > 0 ? hist.today_cached / hist.today_total : 0;
  const saved = hist?.today_cached ?? 0;
  const meta = [live?.plan_type, live?.model_name].filter(Boolean).join(' · ') || undefined;

  return (
    <ServiceSection name="CODEX" color="codex" meta={meta}>
      <UsageBar label="5H" percent={live?.five_hour?.used_percent ?? 0}
                resetsAt={live?.five_hour?.resets_at ?? null} color="codex" />
      <UsageBar label="7D" percent={live?.seven_day?.used_percent ?? 0}
                resetsAt={live?.seven_day?.resets_at ?? null} color="codex" />

      {expanded ? (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
          <div style={cardStyle}>
            <div style={lbl}>今日</div>
            <div style={val}>{fmt(today)}</div>
          </div>
          <div style={cardStyle}>
            <div style={lbl}>本月</div>
            <div style={val}>{fmt(month)}</div>
          </div>
          <div style={{ ...cardStyle, gridColumn:'1/-1' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
              <span style={lbl}>快取命中率</span>
              <span style={{ fontSize:8, color:'#34d399' }}>節省 {fmt(saved)}</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <div style={{ flex:1, background:'#1a3a2a', height:4, borderRadius:4 }}>
                <div style={{ width:`${cacheRate * 100}%`, height:4, borderRadius:4,
                              background:'linear-gradient(90deg,#059669,#34d399)' }} />
              </div>
              <span style={{ fontSize:11, color:'#e9d5ff', fontWeight:600 }}>
                {Math.round(cacheRate * 100)}%
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end' }}>
          <div>
            <div style={lbl}>今日</div>
            <div style={val}>{fmt(today)}</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={lbl}>快取命中率</div>
            <div style={{ ...val, color:'#34d399' }}>
              {Math.round(cacheRate * 100)}%
              <span style={{ fontSize:8, color:'#4b5563', marginLeft:4 }}>節省 {fmt(saved)}</span>
            </div>
          </div>
        </div>
      )}
    </ServiceSection>
  );
}

const cardStyle: React.CSSProperties = {
  background:'#0f0f1a', border:'1px solid #1a3a2a', borderRadius:6, padding:7,
};
const lbl: React.CSSProperties = { fontSize:8, color:'#6b7280', marginBottom:2 };
const val: React.CSSProperties = { fontSize:11, color:'#e9d5ff', fontWeight:600 };

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components
git commit -m "feat: Claude/Codex sections with compact and expanded views"
```

---

## Task 11: FloatingWidget 與 App 主視窗

**Files:**
- Create: `src/components/FloatingWidget.tsx`
- Modify: `src/App.tsx`、`src/main.tsx`

- [ ] **Step 1: FloatingWidget**

```tsx
// src/components/FloatingWidget.tsx
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useUI } from '../store';
import { useHistoricalData } from '../hooks/useHistoricalData';
import { useLiveData } from '../hooks/useLiveData';
import { ClaudeSection } from './ClaudeSection';
import { CodexSection } from './CodexSection';

export function FloatingWidget() {
  useLiveData();
  const { refresh } = useHistoricalData();
  const { expanded, toggleExpanded } = useUI();

  return (
    <div className="widget" data-tauri-drag-region>
      <div className="widget__controls">
        <button className="widget__btn" title="刷新" onClick={() => refresh()}>⟳</button>
        <button className="widget__btn" title={expanded ? '縮小' : '展開'} onClick={toggleExpanded}>
          {expanded ? '⊟' : '⊞'}
        </button>
        <button className="widget__btn" title="最小化至匣" onClick={() => getCurrentWindow().hide()}>⊡</button>
        <button className="widget__btn" title="關閉" onClick={() => getCurrentWindow().hide()}>×</button>
      </div>
      <ClaudeSection />
      <div className="divider" />
      <CodexSection />
    </div>
  );
}
```

- [ ] **Step 2: 簡化 App.tsx**

```tsx
// src/App.tsx
import './index.css';
import { FloatingWidget } from './components/FloatingWidget';

export default function App() {
  return <FloatingWidget />;
}
```

- [ ] **Step 3: 視窗高度自動調整**

修改 `src/components/FloatingWidget.tsx` 加入 effect：

```tsx
import { useEffect, useRef } from 'react';
// ...在 component 內部加：
const rootRef = useRef<HTMLDivElement>(null);
useEffect(() => {
  if (!rootRef.current) return;
  const h = rootRef.current.scrollHeight + 16;
  getCurrentWindow().setSize({ type: 'Logical', width: 256, height: h } as any).catch(() => {});
}, [expanded]);
// 並把 div 加上 ref={rootRef}
```

- [ ] **Step 4: 跑 dev 預覽**

```bash
npm run tauri dev
```

肉眼確認：視窗顯示 Claude/Codex 兩區塊，按 ⊞ 可展開、按 ⟳ 觸發 history refresh。

- [ ] **Step 5: Commit**

```bash
git add src/components/FloatingWidget.tsx src/App.tsx
git commit -m "feat: floating widget with expand/refresh/hide controls"
```

---

## Task 12: System Tray

**Files:**
- Modify: `src-tauri/src/main.rs`
- Create: `src-tauri/icons/tray-normal.png`, `tray-warning.png`, `tray-danger.png`

- [ ] **Step 1: 準備三個 24×24 PNG 圖示**

用任何圖工軟體製作：
- `tray-normal.png`：紫色 (#7c3aed) 圓點或字母 "C"
- `tray-warning.png`：橘色 (#f59e0b)
- `tray-danger.png`：紅色 (#ef4444)

放到 `src-tauri/icons/`。

- [ ] **Step 2: 修改 main.rs 註冊 tray**

在 `main.rs` 的 `setup` closure 內加入：

```rust
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent},
    Manager,
};

// 在 setup(|app| { ... }) 內加：
let show_i  = MenuItem::with_id(app, "show",  "展開視窗", true, None::<&str>)?;
let refresh_i = MenuItem::with_id(app, "refresh", "重新掃描歷史", true, None::<&str>)?;
let quit_i  = MenuItem::with_id(app, "quit",  "退出", true, None::<&str>)?;
let menu = Menu::with_items(app, &[&show_i, &refresh_i, &quit_i])?;

let _tray = TrayIconBuilder::new()
    .icon(app.default_window_icon().unwrap().clone())
    .menu(&menu)
    .on_menu_event(|app, event| match event.id.as_ref() {
        "show" => { if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); } }
        "refresh" => { let _ = app.emit("force-refresh", ()); }
        "quit" => app.exit(0),
        _ => {}
    })
    .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
            let app = tray.app_handle();
            if let Some(w) = app.get_webview_window("main") {
                if w.is_visible().unwrap_or(false) { let _ = w.hide(); }
                else { let _ = w.show(); let _ = w.set_focus(); }
            }
        }
    })
    .build(app)?;
```

- [ ] **Step 3: 前端監聽 force-refresh**

修改 `FloatingWidget.tsx` 加 effect：

```tsx
useEffect(() => {
  const unlisten = listen('force-refresh', () => { refresh(); });
  return () => { unlisten.then(fn => fn()); };
}, [refresh]);
```

（記得從 `@tauri-apps/api/event` import `listen`。）

- [ ] **Step 4: 動態切換 tray 圖示**

在 `spawn_watchers` 內，每次 emit `live-update` 後計算最高 7D %，呼叫 `tray.set_icon()` 切換三張 PNG。可先以 const 路徑載入：

```rust
let icon_normal = tauri::image::Image::from_path("icons/tray-normal.png")?;
// ...在 emit 之後依 percent 切換
if max_pct < 70.0 { tray.set_icon(Some(icon_normal.clone())).ok(); }
else if max_pct < 90.0 { tray.set_icon(Some(icon_warn.clone())).ok(); }
else { tray.set_icon(Some(icon_danger.clone())).ok(); }
```

實作細節：把 tray handle 用 `Arc<Mutex<>>` 傳進 thread；或在 watcher thread 內直接用 `app.tray_by_id`。先做最簡：每次都從 `app_handle` 取 tray by id。

- [ ] **Step 5: 跑 dev 確認 tray 出現、左鍵切換顯示/隱藏、右鍵選單可用**

```bash
npm run tauri dev
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/main.rs src-tauri/icons src/components/FloatingWidget.tsx
git commit -m "feat: system tray with dynamic icon color and menu"
```

---

## Task 13: 設定與位置記憶

**Files:**
- Create: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/lib.rs`、`src-tauri/src/main.rs`、`src-tauri/src/ipc.rs`

- [ ] **Step 1: 寫 config.rs**

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub start_minimized: bool,
    pub autostart: bool,
    pub last_x: Option<i32>,
    pub last_y: Option<i32>,
}

fn config_path() -> PathBuf {
    dirs::home_dir().unwrap().join(".claudegauge").join("config.json")
}

pub fn load() -> AppConfig {
    let p = config_path();
    if !p.exists() { return AppConfig::default(); }
    std::fs::read_to_string(&p).ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save(cfg: &AppConfig) -> anyhow::Result<()> {
    let p = config_path();
    std::fs::create_dir_all(p.parent().unwrap())?;
    std::fs::write(&p, serde_json::to_string_pretty(cfg)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_all_false_and_none() {
        let c = AppConfig::default();
        assert!(!c.start_minimized);
        assert!(c.last_x.is_none());
    }
}
```

- [ ] **Step 2: 加入 ipc commands**

在 `ipc.rs` 加：

```rust
use crate::config::{self, AppConfig};

#[tauri::command]
pub fn get_config() -> AppConfig { config::load() }

#[tauri::command]
pub fn save_config(cfg: AppConfig) -> Result<(), String> {
    config::save(&cfg).map_err(|e| e.to_string())
}
```

更新 `lib.rs`：

```rust
pub mod config;
```

- [ ] **Step 3: 註冊到 invoke_handler**

修改 `main.rs` 的 `tauri::generate_handler![…]` 加入 `get_config, save_config`。

- [ ] **Step 4: 視窗位置在啟動時還原、移動時儲存**

在 `main.rs` setup 內：

```rust
let cfg = claudegauge_lib::config::load();
if let (Some(x), Some(y)) = (cfg.last_x, cfg.last_y) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
    }
}
// 啟動 listener 監聽 window move event 並寫回 config（細節：on_window_event）
```

對 `Builder::default()` 鏈式加 `.on_window_event` 處理 `WindowEvent::Moved`：

```rust
.on_window_event(|window, event| {
    if let tauri::WindowEvent::Moved(pos) = event {
        let mut cfg = claudegauge_lib::config::load();
        cfg.last_x = Some(pos.x);
        cfg.last_y = Some(pos.y);
        let _ = claudegauge_lib::config::save(&cfg);
    }
})
```

- [ ] **Step 5: 跑測試 + commit**

```bash
cd src-tauri
cargo test --lib config
```

預期：1 passed.

```bash
git add src-tauri
git commit -m "feat: persist window position and app config"
```

---

## Task 14: 整合測試與打包

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: 設定 bundle**

修改 `src-tauri/tauri.conf.json` 的 `bundle` 區塊：

```json
{
  "bundle": {
    "active": true,
    "category": "DeveloperTool",
    "shortDescription": "Claude Code / Codex usage dashboard for Windows",
    "longDescription": "Always-on-top widget showing Claude Code and Codex rate limit, token, and cache usage.",
    "targets": ["msi"],
    "windows": {
      "wix": { "language": ["zh-TW", "en-US"] },
      "webviewInstallMode": { "type": "embedBootstrapper" }
    },
    "icon": ["icons/tray-normal.png"]
  }
}
```

- [ ] **Step 2: 全套 Rust 測試**

```bash
cd src-tauri
cargo test
```

預期：所有 task 加總的 test 全部 PASS。

- [ ] **Step 3: 打包 release**

```bash
cd ..
npm run tauri build
```

預期：產生 `src-tauri/target/release/bundle/msi/claudegauge_*.msi`。

- [ ] **Step 4: 手動 smoke test**

雙擊 MSI 安裝、執行：
1. 視窗出現於右下角
2. ⊞ 可展開
3. 等 Claude Code 跑一次 → 5H/7D bars 出現數值
4. 等 Codex 跑一次 → Codex 區塊出現數值
5. ⊡ 隱藏 → tray 圖示左鍵點擊復原

- [ ] **Step 5: Commit + tag**

```bash
git add src-tauri/tauri.conf.json
git commit -m "chore: configure MSI bundling for Windows"
git tag v0.1.0
```

---

## Self-Review

**Spec coverage 對照表**：

| Spec 章節 | 對應 task |
|-----------|----------|
| 3.1 兩種模式並存 | Task 12 (tray) |
| 3.2 Compact / Expanded | Task 10, 11 |
| 4.1 共通元素（無標題） | Task 11 |
| 4.2 Claude 區塊 | Task 10 (ClaudeSection) |
| 4.3 Codex 區塊（含快取） | Task 10 (CodexSection) |
| 5.1 紫色配色 | Task 9 (UsageBar.css) |
| 5.2 模型分佈三色 | Task 10 (ModelDistribution) |
| 5.3 漸層 bar | Task 9 |
| 6.1 Claude live | Task 3, Task 7 |
| 6.2 Claude transcript | Task 4 |
| 6.3 Codex live | Task 5 |
| 6.4 Codex sessions | Task 5 |
| 6.5 手動刷新 | Task 8, 11 |
| 7.4 啟動流程（含安裝/移除 hook） | Task 6, 7 |
| 8. Tray 動態顏色 | Task 12 |
| 9. 設定 / 位置記憶 | Task 13 |
| 11. 未解問題 | Spike PRs（建議在 Task 1 後額外排 4 個 spike PR；本計畫不重複展開細節，spike 結果直接在執行對應 task 時消化） |

**Placeholder 掃描**：所有「TBD / TODO / 之後再實作」已避免；只有 Task 13 的 `on_window_event` 部分鏈式呼叫需要按 Tauri 2 文件實際拼接（這是已知 API，不算 placeholder）。

**型別一致性**：`ClaudeLive` 在 Rust 與 TS 同步、`CodexLive`、`TokenBucket` 同步；`RateLimit.resets_at` 在 Rust 為 `DateTime<Utc>`、在 TS 為 ISO string（serde 預設序列化）；驗證一致。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-20-claudegauge.md`.
