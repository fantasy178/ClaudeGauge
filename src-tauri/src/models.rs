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
    pub fn total(&self) -> u64 {
        self.input + self.output + self.cache_read + self.cache_creation
    }

    pub fn cache_hit_rate(&self) -> f64 {
        let denom = self.input + self.cache_read + self.cache_creation;
        if denom == 0 {
            0.0
        } else {
            self.cache_read as f64 / denom as f64
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct ClaudeHistorical {
    pub today: TokenBucket,
    pub month: TokenBucket,
    pub model_distribution: Vec<(String, u64)>,
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
        if self.today_total == 0 {
            0.0
        } else {
            self.today_cached as f64 / self.today_total as f64
        }
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
        assert!((b.cache_hit_rate() - 0.5).abs() < 1e-9);
    }

    #[test]
    fn token_bucket_cache_hit_rate_zero_division_safe() {
        let b = TokenBucket::default();
        assert_eq!(b.cache_hit_rate(), 0.0);
    }

    #[test]
    fn codex_historical_cache_rate_correct() {
        let h = CodexHistorical { today_total: 1000, today_cached: 400, ..Default::default() };
        assert!((h.today_cache_rate() - 0.4).abs() < 1e-9);
    }
}
