import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
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
    const unlisten = listen("force-refresh", () => {
      refresh();
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [refresh]);

  useEffect(() => {
    if (!rootRef.current) return;
    const h = rootRef.current.scrollHeight + 16;
    getCurrentWindow()
      .setSize(new LogicalSize(256, h))
      .catch(() => {});
  }, [expanded]);

  const hide = () => {
    getCurrentWindow().hide().catch(() => {});
  };

  return (
    <div className="widget" data-tauri-drag-region ref={rootRef}>
      <div className="widget__controls">
        <button
          className="widget__btn"
          title="刷新"
          onClick={() => refresh()}
        >
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
