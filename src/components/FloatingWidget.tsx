import { useEffect, useRef } from "react";
import { bridge } from "../bridge";
import { useUI } from "../store";
import { useHistoricalData } from "../hooks/useHistoricalData";
import { useLiveData } from "../hooks/useLiveData";
import { ClaudeSection } from "./ClaudeSection";
import { CodexSection } from "./CodexSection";

export function FloatingWidget() {
  useLiveData();
  const { refresh } = useHistoricalData();
  const { expanded, toggleExpanded } = useUI();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = bridge.onForceRefresh(() => {
      refresh();
    });
    return unsub;
  }, [refresh]);

  useEffect(() => {
    if (!rootRef.current) return;
    const h = rootRef.current.scrollHeight + 16;
    bridge.setSize(256, h).catch(() => {});
  }, [expanded]);

  const hide = () => {
    bridge.hide().catch(() => {});
  };

  return (
    <div className="widget" ref={rootRef} style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
      <div className="widget__controls" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <button className="widget__btn" title="刷新" onClick={() => refresh()}>
          ⟳
        </button>
        <button
          className="widget__btn"
          title={expanded ? "縮小" : "展開"}
          onClick={toggleExpanded}
        >
          {expanded ? "⊟" : "⊞"}
        </button>
        <button className="widget__btn" title="最小化至匣" onClick={hide}>
          ⊡
        </button>
        <button className="widget__btn" title="關閉" onClick={hide}>
          ×
        </button>
      </div>
      <ClaudeSection />
      <div className="divider" />
      <CodexSection />
    </div>
  );
}
