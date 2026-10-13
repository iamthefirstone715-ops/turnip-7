import type { CSSProperties, ReactNode } from "react";

// Stroke icons (24px grid, Lucide-style paths) so nothing relies on emoji.
const PATHS = {
  phone: "M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2",
  wifi: "M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 20h.01",
  zap: "M13 2 3 14h9l-1 8 10-12h-9l1-8z",
  tv: "M3 7h18v12H3zM8 3l4 4 4-4",
  send: "M7 17 17 7M8 7h9v9",
  receive: "M17 7 7 17M16 17H7V8",
  repeat: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  check: "M20 6 9 17l-5-5",
  undo: "M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  user: "M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  hash: "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, color = "currentColor", strokeWidth = 2 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d={PATHS[name]} />
    </svg>
  );
}

export const CATEGORY_ICON: Record<string, IconName> = { airtime: "phone", data: "wifi", electricity: "zap", tv: "tv" };

/** Visible field label (placeholders alone are not labels). */
export function Label({ children, htmlFor, aside }: { children: ReactNode; htmlFor?: string; aside?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "0 0 6px", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "#5b3fa3" }}>
      <span>{children}</span>
      {aside && <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0, textTransform: "none" }}>{aside}</span>}
    </label>
  );
}

/** A tinted group so related fields read as one block. */
export const panel: CSSProperties = {
  padding: "12px 12px 2px",
  marginBottom: 12,
  borderRadius: 14,
  background: "rgba(255, 255, 255, 0.35)",
  border: "1px solid rgba(76, 29, 149, 0.12)",
};

const TONES = {
  good: { bg: "rgba(26, 127, 55, 0.12)", fg: "#1a7f37" },
  wait: { bg: "rgba(180, 83, 9, 0.12)", fg: "#b45309" },
  back: { bg: "rgba(37, 99, 235, 0.12)", fg: "#1d4ed8" },
  muted: { bg: "rgba(46, 16, 101, 0.08)", fg: "#5b3fa3" },
};
export type Tone = keyof typeof TONES;

export const toneOf = (status: string): Tone =>
  /paid|completed|delivered|active/i.test(status) ? "good" : /processing|pending|held/i.test(status) ? "wait" : /refund/i.test(status) ? "back" : "muted";

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = TONES[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: t.bg, color: t.fg, whiteSpace: "nowrap" }}>
      {tone === "wait" && <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: t.fg }} />}
      {children}
    </span>
  );
}

/** Round icon tile for list rows and headers. */
export function IconTile({ name, tone = "muted", size = 38 }: { name: IconName; tone?: Tone; size?: number }) {
  const t = TONES[tone];
  return (
    <span style={{ width: size, height: size, borderRadius: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", background: t.bg, color: t.fg, flexShrink: 0 }}>
      <Icon name={name} size={Math.round(size * 0.47)} />
    </span>
  );
}

export type Step = { label: string; detail?: ReactNode; state: "done" | "active" | "todo" | "back" };

/** Vertical progress: what has happened to the money, and what happens next. */
export function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, textAlign: "left" }}>
      {steps.map((s, i) => {
        const color = s.state === "done" ? "#1a7f37" : s.state === "active" ? "#5b3fa3" : s.state === "back" ? "#1d4ed8" : "rgba(46, 16, 101, 0.3)";
        return (
          <li key={s.label} className="anim-fade-up" style={{ display: "flex", gap: 12, animationDelay: `${i * 0.12}s` }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: `2px solid ${color}`,
                  background: s.state === "done" ? color : s.state === "back" ? color : "rgba(255,255,255,0.7)",
                  color: "#fff",
                  transition: "background 0.3s ease, border-color 0.3s ease",
                }}
              >
                {s.state === "done" ? <Icon name="check" size={14} strokeWidth={3} /> : s.state === "back" ? <Icon name="undo" size={13} strokeWidth={3} /> : s.state === "active" ? <span className="spinner" style={{ width: 12, height: 12 }} /> : null}
              </span>
              {i < steps.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 18, background: s.state === "done" ? "#1a7f37" : "rgba(46, 16, 101, 0.15)", transition: "background 0.3s ease" }} />}
            </div>
            <div style={{ paddingBottom: i < steps.length - 1 ? 14 : 0, minWidth: 0 }}>
              <p style={{ margin: "3px 0 2px", fontSize: 14, fontWeight: 700, color: s.state === "todo" ? "rgba(46, 16, 101, 0.45)" : "#2e1065" }}>{s.label}</p>
              {s.detail && <div style={{ fontSize: 12, color: "#5b3fa3", lineHeight: 1.45, overflowWrap: "anywhere" }}>{s.detail}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
