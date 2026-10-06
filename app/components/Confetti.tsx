import type { CSSProperties } from "react";

const COLORS = ["#2e1065", "#7c3aed", "#a06bff", "#d2b8ff", "#1a7f37"];

const pieces = Array.from({ length: 28 }, (_, i) => {
  const angle = (i / 28) * Math.PI * 2;
  const dist = 90 + (i % 4) * 30;
  return {
    "--dx": `${Math.cos(angle) * dist}px`,
    "--dy": `${Math.sin(angle) * dist}px`,
    "--rot": `${(i % 2 ? 1 : -1) * (180 + i * 20)}deg`,
    background: COLORS[i % COLORS.length],
    animationDelay: `${(i % 3) * 0.04}s`,
  } as CSSProperties;
});

export default function Confetti() {
  return (
    <>
      {pieces.map((style, i) => (
        <span key={i} className="confetti" style={style} />
      ))}
    </>
  );
}
