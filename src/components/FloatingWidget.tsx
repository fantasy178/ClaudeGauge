import { useEffect, useRef, useState } from "react";
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
  const [opacity, setOpacityState] = useState(1.0);
  const [pinned, setPinnedState] = useState(false);

  useEffect(() => {
    bridge.getConfig().then((c) => {
      setOpacityState(c.opacity ?? 1.0);
      setPinnedState(c.pinned ?? false);
    });
  }, []);

  const changeOpacity = (v: number) => {
    const clamped = Math.max(0.3, Math.min(1.0, v));
    setOpacityState(clamped);
    bridge.setOpacity(clamped).catch(() => {});
  };

  const togglePinned = () => {
    const next = !pinned;
    setPinnedState(next);
    bridge.setPinned(next).catch(() => {});
  };

  useEffect(() => {
    const unsub = bridge.onForceRefresh(() => {
      refresh();
    });
    return unsub;
  }, [refresh]);

  useEffect(() => {
    if (!rootRef.current) return;
    const el = rootRef.current;
    let pending = false;
    const update = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const h = el.getBoundingClientRect().height + 16;
          bridge.setSize(256, h).catch(() => {});
          pending = false;
        });
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hide = () => {
    bridge.hide().catch(() => {});
  };

  return (
    <div
      className="widget"
      ref={rootRef}
      style={{
        WebkitAppRegion: pinned ? "no-drag" : "drag",
      } as React.CSSProperties}
    >
      <div
        className="widget__controls"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <input
          className="widget__slider"
          type="range"
          min={30}
          max={100}
          step={5}
          value={Math.round(opacity * 100)}
          onChange={(e) => changeOpacity(+e.target.value / 100)}
          title={`透明度 ${Math.round(opacity * 100)}%`}
        />
        <button
          className={`widget__btn ${pinned ? "widget__btn--active" : ""}`}
          title={pinned ? "解除釘選" : "釘選位置"}
          onClick={togglePinned}
        >
          {pinned ? "📌" : "📍"}
        </button>
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
