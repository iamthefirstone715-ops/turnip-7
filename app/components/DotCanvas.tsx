"use client";

import { useEffect, useRef } from "react";

const SPACING = 14;
const DOT_RADIUS = 1.2;
const GATHER_RADIUS = 140;
const GATHER_STRENGTH = 0.6;
const SPRING = 0.08;
const FRICTION = 0.82;

type Dot = {
  x: number;
  y: number;
  ox: number;
  oy: number;
  vx: number;
  vy: number;
};

export default function DotCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dots: Dot[] = [];
    let pointer = { x: -9999, y: -9999, active: false };
    let scrollPulse = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      dots = [];
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      for (let y = SPACING / 2; y < canvas.height; y += SPACING) {
        for (let x = SPACING / 2; x < canvas.width; x += SPACING) {
          // intro: dots burst out from center and spring into the grid
          const sx = cx + (x - cx) * 0.15 + (Math.random() - 0.5) * 60;
          const sy = cy + (y - cy) * 0.15 + (Math.random() - 0.5) * 60;
          dots.push({ x: sx, y: sy, ox: x, oy: y, vx: 0, vy: 0 });
        }
      }
    };
    resize();
    window.addEventListener("resize", resize);

    const setPointer = (clientX: number, clientY: number) => {
      pointer = { x: clientX, y: clientY, active: true };
    };
    const clearPointer = () => {
      pointer.active = false;
    };

    const onMouseMove = (e: MouseEvent) => setPointer(e.clientX, e.clientY);
    const onMouseLeave = () => clearPointer();
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) setPointer(t.clientX, t.clientY);
    };
    const onTouchEnd = () => clearPointer();
    const onWheel = (e: WheelEvent) => {
      scrollPulse = Math.min(scrollPulse + Math.abs(e.deltaY) * 0.02, 40);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseleave", onMouseLeave);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("wheel", onWheel, { passive: true });

    let raf: number;
    const tick = (t: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
      bg.addColorStop(0, "#ece0ff");
      bg.addColorStop(1, "#d2b8ff");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const radius = GATHER_RADIUS + scrollPulse;
      scrollPulse *= 0.92;

      ctx.fillStyle = "#8a5cf6";
      for (const d of dots) {
        if (pointer.active || scrollPulse > 0.5) {
          const dx = pointer.x - d.x;
          const dy = pointer.y - d.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist < radius) {
            const pull = (1 - dist / radius) * GATHER_STRENGTH;
            d.vx += (dx / dist) * pull;
            d.vy += (dy / dist) * pull;
          }
        }

        d.vx += (d.ox - d.x) * SPRING;
        d.vy += (d.oy - d.y) * SPRING;
        d.vx *= FRICTION;
        d.vy *= FRICTION;
        d.x += d.vx;
        d.y += d.vy;

        const wave = Math.sin(t * 0.0012 + d.ox * 0.015 + d.oy * 0.01) * 1.6;
        const pdx = pointer.x - d.x;
        const pdy = pointer.y - d.y;
        const near = pointer.active
          ? Math.max(0, 1 - Math.sqrt(pdx * pdx + pdy * pdy) / radius)
          : 0;

        ctx.beginPath();
        ctx.arc(d.x, d.y + wave, DOT_RADIUS + near * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
