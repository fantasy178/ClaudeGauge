import type { ReactNode } from "react";
import "./ServiceSection.css";

interface Props {
  name: "CLAUDE" | "CODEX";
  color: "claude" | "codex";
  meta?: string;
  children: ReactNode;
}

export function ServiceSection({ name, color, meta, children }: Props) {
  return (
    <section className={`service service--${color}`}>
      <header className="service__head">
        <span className="service__dot" />
        <span className="service__name">{name}</span>
        {meta && <span className="service__meta">{meta}</span>}
      </header>
      {children}
    </section>
  );
}
