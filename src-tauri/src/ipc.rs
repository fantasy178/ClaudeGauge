use crate::claude::{hook_writer, live as claude_live, transcript as claude_transcript};
use crate::codex::{live as codex_live, session as codex_session};
use crate::config::{self, AppConfig};
use crate::models::*;
use chrono::Utc;
use serde::Serialize;
use std::path::PathBuf;

fn home_claude() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".claude")
}

fn home_codex() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".codex")
}

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
    let claude_path = home_claude().join("claudegauge-live.json");
    let claude = claude_live::read_live_file(&claude_path).ok();
    let codex = codex_live::read_latest_codex_live(&home_codex()).ok().flatten();
    Ok(LiveSnapshot { claude, codex })
}

#[tauri::command]
pub fn refresh_history() -> Result<HistoricalSnapshot, String> {
    let now = Utc::now();
    let claude_records =
        claude_transcript::scan_all_transcripts(&home_claude()).map_err(|e| e.to_string())?;
    let claude = claude_transcript::aggregate_records(&claude_records, now);
    let codex =
        codex_session::scan_all_sessions(&home_codex(), now).map_err(|e| e.to_string())?;
    Ok(HistoricalSnapshot { claude, codex })
}

#[tauri::command]
pub fn get_config() -> AppConfig {
    config::load()
}

#[tauri::command]
pub fn save_config(cfg: AppConfig) -> Result<(), String> {
    config::save(&cfg).map_err(|e| e.to_string())
}
