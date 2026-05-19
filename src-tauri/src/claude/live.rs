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
        session_started_at: None,
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
