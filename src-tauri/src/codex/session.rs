use crate::models::{CodexHistorical, CodexLive, RateLimit};
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

pub fn parse_session_file(path: &Path) -> anyhow::Result<(Option<CodexLive>, SessionTokens)> {
    let file = std::fs::File::open(path)?;
    let reader = BufReader::new(file);
    let mut latest_live: Option<CodexLive> = None;
    let mut totals = SessionTokens::default();
    let mut latest_model: Option<String> = None;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }
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

pub fn date_from_filename(name: &str) -> Option<NaiveDate> {
    let rest = name.strip_prefix("rollout-")?;
    let date_part = rest.get(..10)?;
    NaiveDate::parse_from_str(date_part, "%Y-%m-%d").ok()
}

pub fn scan_all_sessions(codex_dir: &Path, now: DateTime<Utc>) -> anyhow::Result<CodexHistorical> {
    let sessions_dir = codex_dir.join("sessions");
    if !sessions_dir.exists() {
        return Ok(CodexHistorical::default());
    }
    let pattern = format!("{}/**/rollout-*.jsonl", sessions_dir.display());
    let pattern = pattern.replace('\\', "/");
    let now_local = now.with_timezone(&Local).date_naive();
    let month_start = NaiveDate::from_ymd_opt(now_local.year(), now_local.month(), 1).unwrap();

    let mut h = CodexHistorical::default();
    for entry in globwalk::glob(&pattern)? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let fname = entry.file_name().to_string_lossy().to_string();
        let date = match date_from_filename(&fname) {
            Some(d) => d,
            None => continue,
        };
        if date < month_start {
            continue;
        }
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
