import { ReactNode } from "react";

export default function GlassCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="anim-scale-in"
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        translate: "-50% -50%",
        width: 340,
        padding: "32px 28px",
        borderRadius: 20,
        background: "rgba(255, 255, 255, 0.32)",
        border: "1px solid rgba(255, 255, 255, 0.85)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        boxShadow:
          "0 24px 60px rgba(76, 29, 149, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.8)",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {children}
    </div>
  );
}
