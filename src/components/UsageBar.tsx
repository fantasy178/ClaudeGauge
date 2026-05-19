import "./UsageBar.css";

interface Props {
  label: string;
  percent: number;
  resetsAt: string | null;
  color: "claude" | "codex";
}

function formatResetTime(resetsAt: string | null, kind: "5h" | "7d"): string {
  if (!resetsAt) return "";
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return "";
  if (kind === "5h") {
    return (
      "resets " +
      date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    );
  }
  const diffMs = date.getTime() - Date.now();
  const totalMin = Math.max(0, Math.floor(diffMs / 60000));
  const d = Math.floor(totalMin / (60 * 24));
  const h = Math.floor((totalMin % (60 * 24)) / 60);
  return `resets ${d}d${h}h`;
}

export function UsageBar({ label, percent, resetsAt, color }: Props) {
  const kind: "5h" | "7d" = label === "5H" ? "5h" : "7d";
  return (
    <div className={`usage-bar usage-bar--${color}`}>
      <div className="usage-bar__row">
        <span className="usage-bar__label">{label}</span>
        <span className="usage-bar__meta">
          <span className="usage-bar__pct">{percent.toFixed(0)}%</span>
          <span className="usage-bar__reset">{formatResetTime(resetsAt, kind)}</span>
        </span>
      </div>
      <div className="usage-bar__track">
        <div
          className="usage-bar__fill"
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}
