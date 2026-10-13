import type { CSSProperties } from "react";

export const field: CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  marginBottom: 10,
  borderRadius: 10,
  border: "1px solid rgba(76, 29, 149, 0.3)",
  background: "rgba(255, 255, 255, 0.65)",
  color: "#3a2568",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};
export const select: CSSProperties = { ...field, cursor: "pointer", appearance: "auto" };

export const card: CSSProperties = {
  width: 480,
  maxWidth: "calc(100vw - 32px)",
  padding: "24px 28px",
  borderRadius: 16,
  background: "rgba(236, 224, 255, 0.55)",
  border: "1px solid rgba(255, 255, 255, 0.7)",
  backdropFilter: "blur(2px)",
  WebkitBackdropFilter: "blur(2px)",
  boxShadow: "0 20px 50px rgba(122, 60, 220, 0.2)",
  fontFamily: "system-ui, sans-serif",
  boxSizing: "border-box",
};

export const primaryBtn: CSSProperties = {
  width: "100%",
  padding: "12px 0",
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 15,
  color: "#fff",
  background: "linear-gradient(135deg, #4c1d95, #2e1065)",
};
