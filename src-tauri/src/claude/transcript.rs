use crate::models::{ClaudeHistorical, TokenBucket};
use chrono::{DateTime, Datelike, Local, TimeZone, Utc};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;

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
    let today_start = Local
        .with_ymd_and_hms(now_local.year(), now_local.month(), now_local.day(), 0, 0, 0)
        .single()
        .unwrap();
    let month_start = Local
        .with_ymd_and_hms(now_local.year(), now_local.month(), 1, 0, 0, 0)
        .single()
        .unwrap();

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
    let projects_dir = claude_dir.join("projects");
    if !projects_dir.exists() {
        return Ok(Vec::new());
    }
    let pattern = format!("{}/**/*.jsonl", projects_dir.display());
    let pattern = pattern.replace('\\', "/");
    let mut all = Vec::new();
    for entry in globwalk::glob(&pattern)? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
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
        for l in lines {
            writeln!(f, "{}", l).unwrap();
        }
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
        let f = make_jsonl(&[
            "not json",
            r#"{"timestamp":"2026-05-20T10:00:00Z","message":{"model":"X","usage":{"input_tokens":5}}}"#,
        ]);
        let recs = parse_transcript_file(f.path()).unwrap();
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].input, 5);
    }

    #[test]
    fn aggregate_filters_today_and_month() {
        let now = Utc.with_ymd_and_hms(2026, 5, 20, 12, 0, 0).unwrap();
        let today_record = MessageRecord {
            timestamp: Utc.with_ymd_and_hms(2026, 5, 20, 10, 0, 0).unwrap(),
            model: "Sonnet".into(),
            input: 100,
            output: 50,
            cache_read: 0,
            cache_creation: 0,
        };
        let earlier_month = MessageRecord {
            timestamp: Utc.with_ymd_and_hms(2026, 5, 1, 8, 0, 0).unwrap(),
            model: "Opus".into(),
            input: 200,
            output: 100,
            cache_read: 0,
            cache_creation: 0,
        };
        let last_month = MessageRecord {
            timestamp: Utc.with_ymd_and_hms(2026, 4, 30, 8, 0, 0).unwrap(),
            model: "Sonnet".into(),
            input: 999,
            output: 999,
            cache_read: 0,
            cache_creation: 0,
        };
        let h = aggregate_records(&[today_record, earlier_month, last_month], now);
        assert_eq!(h.today.input, 100);
        assert_eq!(h.today.output, 50);
        assert_eq!(h.month.input, 300);
        assert_eq!(h.month.output, 150);
        assert_eq!(h.model_distribution.len(), 2);
    }
}
