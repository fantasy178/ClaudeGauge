use crate::models::CodexLive;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

pub fn find_latest_session(codex_dir: &Path) -> anyhow::Result<Option<PathBuf>> {
    let sessions_dir = codex_dir.join("sessions");
    if !sessions_dir.exists() {
        return Ok(None);
    }
    let pattern = format!("{}/**/rollout-*.jsonl", sessions_dir.display());
    let pattern = pattern.replace('\\', "/");
    let mut best: Option<(SystemTime, PathBuf)> = None;
    for entry in globwalk::glob(&pattern)? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let mtime = match entry.metadata().and_then(|m| m.modified()) {
            Ok(t) => t,
            Err(_) => continue,
        };
        if best.as_ref().map_or(true, |b| mtime > b.0) {
            best = Some((mtime, entry.path().to_path_buf()));
        }
    }
    Ok(best.map(|(_, p)| p))
}

pub fn read_latest_codex_live(codex_dir: &Path) -> anyhow::Result<Option<CodexLive>> {
    let Some(path) = find_latest_session(codex_dir)? else {
        return Ok(None);
    };
    let (live, _) = crate::codex::session::parse_session_file(&path)?;
    Ok(live)
}
