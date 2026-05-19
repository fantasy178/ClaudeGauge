const MODEL_COLORS: Array<[RegExp, string, string]> = [
  [/sonnet/i, "#7c3aed", "#a78bfa"],
  [/opus/i, "#f59e0b", "#fbbf24"],
  [/haiku/i, "#06b6d4", "#22d3ee"],
  [/.*/, "#6b7280", "#9ca3af"],
];

function colorFor(model: string): string {
  const found = MODEL_COLORS.find(([r]) => r.test(model))!;
  const [, from, to] = found;
  return `linear-gradient(90deg, ${from}, ${to})`;
}

function labelFor(model: string): string {
  return model
    .replace(/^claude /i, "")
    .replace(/-\d{8}$/, "")
    .replace(/\s*\(.*\)$/, "");
}

interface Props {
  distribution: [string, number][];
}

export function ModelDistribution({ distribution }: Props) {
  const total = distribution.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return null;
  return (
    <div
      style={{
        background: "#0f0f1a",
        border: "1px solid #2d2d4e",
        borderRadius: 6,
        padding: 7,
        marginBottom: 5,
      }}
    >
      <div style={{ fontSize: 8, color: "#6b7280", marginBottom: 5 }}>模型分佈</div>
      <div
        style={{
          display: "flex",
          height: 7,
          borderRadius: 4,
          overflow: "hidden",
          marginBottom: 5,
        }}
      >
        {distribution.map(([model, n]) => (
          <div key={model} style={{ flex: n / total, background: colorFor(model) }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {distribution.map(([model, n]) => (
          <span key={model} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              style={{ width: 8, height: 8, borderRadius: 2, background: colorFor(model) }}
            />
            <span style={{ fontSize: 8, color: "#e9d5ff" }}>
              {labelFor(model)} {Math.round((n / total) * 100)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
