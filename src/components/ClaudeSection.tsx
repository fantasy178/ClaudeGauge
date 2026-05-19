import type { CSSProperties } from "react";
import { useData, useUI } from "../store";
import { ServiceSection } from "./ServiceSection";
import { UsageBar } from "./UsageBar";
import { ModelDistribution } from "./ModelDistribution";

const cardStyle: CSSProperties = {
  background: "#0f0f1a",
  border: "1px solid #2d2d4e",
  borderRadius: 6,
  padding: 7,
};
const lbl: CSSProperties = { fontSize: 8, color: "#6b7280", marginBottom: 2 };
const val: CSSProperties = { fontSize: 11, color: "#e9d5ff", fontWeight: 600 };

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export function ClaudeSection() {
  const live = useData((s) => s.live.claude);
  const hist = useData((s) => s.history?.claude);
  const expanded = useUI((s) => s.expanded);
  const bucket = hist?.today;
  const monthBucket = hist?.month;

  const todayTotal = bucket
    ? bucket.input + bucket.output + bucket.cache_read + bucket.cache_creation
    : 0;
  const monthTotal = monthBucket
    ? monthBucket.input + monthBucket.output + monthBucket.cache_read + monthBucket.cache_creation
    : 0;
  const cacheDenom = bucket ? bucket.input + bucket.cache_read + bucket.cache_creation : 0;
  const cacheRate = bucket && cacheDenom > 0 ? bucket.cache_read / cacheDenom : 0;
  const savedTokens = bucket ? bucket.cache_read : 0;

  return (
    <ServiceSection
      name="CLAUDE"
      color="claude"
      meta={live?.model_name ?? undefined}
    >
      <UsageBar
        label="5H"
        percent={live?.five_hour?.used_percent ?? 0}
        resetsAt={live?.five_hour?.resets_at ?? null}
        color="claude"
      />
      <UsageBar
        label="7D"
        percent={live?.seven_day?.used_percent ?? 0}
        resetsAt={live?.seven_day?.resets_at ?? null}
        color="claude"
      />

      {expanded ? (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 5,
              marginBottom: 5,
            }}
          >
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
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 4,
              }}
            >
              <span style={lbl}>快取命中率</span>
              <span style={{ fontSize: 8, color: "#a78bfa" }}>
                節省 {fmt(savedTokens)}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div
                style={{
                  flex: 1,
                  background: "#2d2d4e",
                  height: 4,
                  borderRadius: 4,
                }}
              >
                <div
                  style={{
                    width: `${cacheRate * 100}%`,
                    height: 4,
                    borderRadius: 4,
                    background: "linear-gradient(90deg,#7c3aed,#a78bfa)",
                  }}
                />
              </div>
              <span style={{ fontSize: 11, color: "#e9d5ff", fontWeight: 600 }}>
                {Math.round(cacheRate * 100)}%
              </span>
            </div>
          </div>
        </>
      ) : (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div>
            <div style={lbl}>今日</div>
            <div style={val}>{fmt(todayTotal)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={lbl}>快取命中率</div>
            <div style={{ ...val, color: "#a78bfa" }}>
              {Math.round(cacheRate * 100)}%
              <span style={{ fontSize: 8, color: "#4b5563", marginLeft: 4 }}>
                節省 {fmt(savedTokens)}
              </span>
            </div>
          </div>
        </div>
      )}
    </ServiceSection>
  );
}
