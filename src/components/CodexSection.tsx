import type { CSSProperties } from "react";
import { useData, useUI } from "../store";
import { ServiceSection } from "./ServiceSection";
import { UsageBar } from "./UsageBar";

const cardStyle: CSSProperties = {
  background: "#0f0f1a",
  border: "1px solid #1a3a2a",
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

export function CodexSection() {
  const live = useData((s) => s.live.codex);
  const hist = useData((s) => s.history?.codex);
  const expanded = useUI((s) => s.expanded);
  const today = hist?.today_total ?? 0;
  const month = hist?.month_total ?? 0;
  const cacheRate = hist && hist.today_total > 0 ? hist.today_cached / hist.today_total : 0;
  const saved = hist?.today_cached ?? 0;
  const meta = [live?.plan_type, live?.model_name].filter(Boolean).join(" · ") || undefined;

  return (
    <ServiceSection name="CODEX" color="codex" meta={meta}>
      <UsageBar
        label="5H"
        percent={live?.five_hour?.used_percent ?? 0}
        resetsAt={live?.five_hour?.resets_at ?? null}
        color="codex"
      />
      <UsageBar
        label="7D"
        percent={live?.seven_day?.used_percent ?? 0}
        resetsAt={live?.seven_day?.resets_at ?? null}
        color="codex"
      />

      {expanded ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
          <div style={cardStyle}>
            <div style={lbl}>今日</div>
            <div style={val}>{fmt(today)}</div>
          </div>
          <div style={cardStyle}>
            <div style={lbl}>本月</div>
            <div style={val}>{fmt(month)}</div>
          </div>
          <div style={{ ...cardStyle, gridColumn: "1/-1" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 4,
              }}
            >
              <span style={lbl}>快取命中率</span>
              <span style={{ fontSize: 8, color: "#34d399" }}>
                節省 {fmt(saved)}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div
                style={{
                  flex: 1,
                  background: "#1a3a2a",
                  height: 4,
                  borderRadius: 4,
                }}
              >
                <div
                  style={{
                    width: `${cacheRate * 100}%`,
                    height: 4,
                    borderRadius: 4,
                    background: "linear-gradient(90deg,#059669,#34d399)",
                  }}
                />
              </div>
              <span style={{ fontSize: 11, color: "#e9d5ff", fontWeight: 600 }}>
                {Math.round(cacheRate * 100)}%
              </span>
            </div>
          </div>
        </div>
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
            <div style={val}>{fmt(today)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={lbl}>快取命中率</div>
            <div style={{ ...val, color: "#34d399" }}>
              {Math.round(cacheRate * 100)}%
              <span style={{ fontSize: 8, color: "#4b5563", marginLeft: 4 }}>
                節省 {fmt(saved)}
              </span>
            </div>
          </div>
        </div>
      )}
    </ServiceSection>
  );
}
