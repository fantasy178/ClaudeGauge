use serde_json::{json, Value};
use std::path::Path;

const HOOK_MARKER: &str = "claudegauge-hook";

pub fn ensure_stop_hook(claude_dir: &Path) -> anyhow::Result<()> {
    if !claude_dir.exists() {
        std::fs::create_dir_all(claude_dir)?;
    }
    let settings_path = claude_dir.join("settings.json");
    let mut root: Value = if settings_path.exists() {
        let txt = std::fs::read_to_string(&settings_path)?;
        if txt.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(&txt)?
        }
    } else {
        json!({})
    };

    if !root.get("hooks").map_or(false, |v| v.is_object()) {
        root["hooks"] = json!({});
    }
    let hooks_obj = root["hooks"].as_object_mut().unwrap();
    let stop_arr = hooks_obj
        .entry("Stop".to_string())
        .or_insert_with(|| json!([]));
    let arr = stop_arr
        .as_array_mut()
        .ok_or_else(|| anyhow::anyhow!("hooks.Stop must be an array"))?;

    let already = arr.iter().any(|h| {
        h.get("hooks")
            .and_then(Value::as_array)
            .map_or(false, |inner| {
                inner
                    .iter()
                    .any(|x| x.get("comment").and_then(Value::as_str) == Some(HOOK_MARKER))
            })
    });
    if already {
        return Ok(());
    }

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

pub fn remove_stop_hook(claude_dir: &Path) -> anyhow::Result<()> {
    let settings_path = claude_dir.join("settings.json");
    if !settings_path.exists() {
        return Ok(());
    }
    let txt = std::fs::read_to_string(&settings_path)?;
    if txt.trim().is_empty() {
        return Ok(());
    }
    let mut root: Value = serde_json::from_str(&txt)?;
    if let Some(stop_arr) = root.pointer_mut("/hooks/Stop").and_then(Value::as_array_mut) {
        stop_arr.retain(|h| {
            !h.get("hooks")
                .and_then(Value::as_array)
                .map_or(false, |inner| {
                    inner
                        .iter()
                        .any(|x| x.get("comment").and_then(Value::as_str) == Some(HOOK_MARKER))
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
        assert_eq!(count, 1);
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
        std::fs::write(
            dir.path().join("settings.json"),
            serde_json::to_string_pretty(&existing).unwrap(),
        )
        .unwrap();
        ensure_stop_hook(dir.path()).unwrap();
        remove_stop_hook(dir.path()).unwrap();
        let txt = std::fs::read_to_string(dir.path().join("settings.json")).unwrap();
        assert!(!txt.contains(HOOK_MARKER));
        assert!(txt.contains("echo other"));
    }
}
