"use client";

import { useEffect, useRef } from "react";

const SPACING = 14;
const DOT_RADIUS = 1.2;
const GATHER_RADIUS = 140;
const GATHER_STRENGTH = 0.6;
const SPRING = 0.08;
const FRICTION = 0.82;
const TAU = Math.PI * 2;

// Intro: a ripple travels outward from the centre; each dot blooms in as it passes.
const RIPPLE_MS_PER_PX = 0.55;
const BLOOM_MS = 700;
const RISE_PX = 10;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
const easeOutBack = (p: number) => {
  const c1 = 1.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};

export default function DotCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let last = start;
    let w = 0;
    let h = 0;
    let n = 0;
    let introEnd = 0;
    let ox = new Float32Array(0);
    let oy = new Float32Array(0);
    let x = new Float32Array(0);
    let y = new Float32Array(0);
    let vx = new Float32Array(0);
    let vy = new Float32Array(0);
    let delay = new Float32Array(0);
    const pointer = { x: -9999, y: -9999, active: false };
    let scrollPulse = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cols = Math.ceil((w - SPACING / 2) / SPACING);
      const rows = Math.ceil((h - SPACING / 2) / SPACING);
      n = cols * rows;
      ox = new Float32Array(n);
      oy = new Float32Array(n);
      x = new Float32Array(n);
      y = new Float32Array(n);
      vx = new Float32Array(n);
      vy = new Float32Array(n);
      delay = new Float32Array(n);

      const cx = w / 2;
      const cy = h / 2;
      let maxDelay = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const px = SPACING / 2 + c * SPACING;
          const py = SPACING / 2 + r * SPACING;
          ox[i] = px;
          oy[i] = py;
          // start slightly pulled in so the grid settles outward with the ripple
          x[i] = cx + (px - cx) * 0.94;
          y[i] = cy + (py - cy) * 0.94;
          delay[i] = Math.hypot(px - cx, py - cy) * RIPPLE_MS_PER_PX;
          if (delay[i] > maxDelay) maxDelay = delay[i];
        }
      }
      introEnd = reduceMotion ? 0 : maxDelay + BLOOM_MS;
    };
    resize();
    window.addEventListener("resize", resize);

    const onMouseMove = (e: MouseEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
    };
    const clearPointer = () => {
      pointer.active = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) {
        pointer.x = t.clientX;
        pointer.y = t.clientY;
        pointer.active = true;
      }
    };
    const onWheel = (e: WheelEvent) => {
      scrollPulse = Math.min(scrollPulse + Math.abs(e.deltaY) * 0.02, 40);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseleave", clearPointer);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", clearPointer);
    window.addEventListener("wheel", onWheel, { passive: true });

    ctx.fillStyle = "#8a5cf6";
    let raf: number;
    const tick = (now: number) => {
      // Physics is scaled by elapsed time so it feels the same at 60, 120 or 144 Hz.
      const dt = Math.min(now - last, 32);
      last = now;
      const k = dt / 16.667;
      const elapsed = now - start;
      const intro = elapsed < introEnd;
      const fr = Math.pow(FRICTION, k);
      const radius = GATHER_RADIUS + scrollPulse;
      const r2 = radius * radius;
      const active = pointer.active || scrollPulse > 0.5;
      scrollPulse *= Math.pow(0.92, k);
      const waveT = reduceMotion ? 0 : now * 0.0012;
      const waveAmp = reduceMotion ? 0 : 1.6;

      ctx.clearRect(0, 0, w, h); // background is a CSS gradient, so no full-screen fill each frame

      // One path and one fill for every dot (radii can differ inside a single path).
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        let px = x[i];
        let py = y[i];
        let near = 0;

        if (active) {
          const dx = pointer.x - px;
          const dy = pointer.y - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < r2) {
            const dist = Math.sqrt(d2) || 1;
            near = 1 - dist / radius;
            const pull = near * GATHER_STRENGTH * k;
            vx[i] += (dx / dist) * pull;
            vy[i] += (dy / dist) * pull;
          }
        }

        vx[i] = (vx[i] + (ox[i] - px) * SPRING * k) * fr;
        vy[i] = (vy[i] + (oy[i] - py) * SPRING * k) * fr;
        px += vx[i] * k;
        py += vy[i] * k;
        x[i] = px;
        y[i] = py;

        let scale = 1;
        let lift = 0;
        if (intro) {
          const p = clamp01((elapsed - delay[i]) / BLOOM_MS);
          if (p === 0) continue;
          scale = easeOutBack(p);
          lift = (1 - easeOutCubic(p)) * RISE_PX;
        }

        const rad = (DOT_RADIUS + (pointer.active ? near * 1.6 : 0)) * scale;
        const cy = py + lift + Math.sin(waveT + ox[i] * 0.015 + oy[i] * 0.01) * waveAmp;
        ctx.moveTo(px + rad, cy);
        ctx.arc(px, cy, rad, 0, TAU);
      }
      ctx.fill();

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseleave", clearPointer);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", clearPointer);
      window.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        background: "linear-gradient(180deg, #ece0ff 0%, #d2b8ff 100%)",
      }}
    />
  );
}
