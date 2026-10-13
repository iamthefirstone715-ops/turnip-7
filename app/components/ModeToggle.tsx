"use client";

import { setMode, useMode } from "../lib/mode";

const PATH_GRID = "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z";
const PATH_CHAT = "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z";

/** One switch between the chat and the button screens. */
export default function ModeToggle() {
  const mode = useMode();
  const next = mode === "chat" ? "buttons" : "chat";
  return (
    <button
      onClick={() => setMode(next)}
      aria-label={`Switch to ${next}`}
      title={`Switch to ${next}`}
      className="btn"
      style={{
        position: "fixed",
        top: 18,
        right: 18,
        zIndex: 20,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: 4,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.8)",
        background: "rgba(236, 224, 255, 0.75)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        boxShadow: "0 10px 30px rgba(76, 29, 149, 0.2)",
        cursor: "pointer",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {(["chat", "buttons"] as const).map((m) => {
        const on = mode === m;
        return (
          <span
            key={m}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 700,
              color: on ? "#fff" : "#2e1065",
              background: on ? "linear-gradient(135deg, #4c1d95, #2e1065)" : "transparent",
              transition: "background 0.25s ease, color 0.25s ease",
            }}
          >
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={m === "chat" ? PATH_CHAT : PATH_GRID} />
            </svg>
            {m === "chat" ? "Chat" : "Buttons"}
          </span>
        );
      })}
    </button>
  );
}
