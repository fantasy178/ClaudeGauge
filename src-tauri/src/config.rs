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
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claudegauge")
        .join("config.json")
}

pub fn load() -> AppConfig {
    let p = config_path();
    if !p.exists() {
        return AppConfig::default();
    }
    std::fs::read_to_string(&p)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save(cfg: &AppConfig) -> anyhow::Result<()> {
    let p = config_path();
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
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
