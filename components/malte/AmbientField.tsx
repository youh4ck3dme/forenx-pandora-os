import { useEffect, useRef, useState } from "react";

type ParticleType = "triangle" | "point" | "glyph";

type AmbientNode = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  angle: number;
  spin: number;
  type: ParticleType;
  glyph: string;
  gold: boolean;
  baseAlpha: number;
  pulsePhase: number;
  pulseSpeed: number;
};

// Procedural micro-tokens referencing Vercel's ASCII/data triangle matrix
const GLYPHS = ["▲", "0x", "::", "Δ", "FRX", "λ", "99"] as const;

function createNode(width: number, height: number): AmbientNode {
  const rand = Math.random();
  const type: ParticleType =
    rand < 0.45 ? "triangle" : rand < 0.8 ? "point" : "glyph";
  const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? "▲";
  const gold = Math.random() < 0.22;

  return {
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.2,
    vy: (Math.random() - 0.5) * 0.16 - 0.02,
    size:
      type === "triangle"
        ? Math.random() * 8 + 4
        : type === "glyph"
          ? 9
          : Math.random() * 1.6 + 0.5,
    angle: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.008,
    type,
    glyph,
    gold,
    baseAlpha: Math.random() * 0.28 + 0.12,
    pulsePhase: Math.random() * Math.PI * 2,
    pulseSpeed: Math.random() * 0.02 + 0.01,
  };
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  angle: number,
  stroke: boolean,
  fill?: string,
) {
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = angle + (i * Math.PI * 2) / 3;
    const px = cx + r * Math.cos(a);
    const py = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.stroke();
  }
}

/**
 * Optimalizované procedurálne animované pozadie s geometrickými trojuholníkmi,
 * konštelačnou sieťou a jemnou ASCII/typografickou maticou (inšpirované Vercel ▲).
 */
export function AmbientField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.classList.contains("dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reduce =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : {
            matches: false,
            addEventListener: () => {},
            removeEventListener: () => {},
          };
    let frame = 0;
    let running = false;
    let nodes: AmbientNode[] = [];
    const mouse = { x: -2000, y: -2000, active: false };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = window.innerWidth;
      const height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.max(
        42,
        Math.min(96, Math.round((width * height) / 20000)),
      );
      if (nodes.length !== count) {
        nodes = Array.from({ length: count }, () => createNode(width, height));
      }
    };

    const draw = (moving: boolean) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      context.clearRect(0, 0, width, height);

      // Jemný interaktívny spotlight pod kurzorom v tmavom režime
      if (dark && mouse.active) {
        const glow = context.createRadialGradient(
          mouse.x,
          mouse.y,
          0,
          mouse.x,
          mouse.y,
          180,
        );
        glow.addColorStop(0, "rgba(64, 214, 206, 0.045)");
        glow.addColorStop(0.6, "rgba(255, 199, 0, 0.015)");
        glow.addColorStop(1, "rgba(0, 0, 0, 0)");
        context.fillStyle = glow;
        context.fillRect(mouse.x - 180, mouse.y - 180, 360, 360);
      }

      // Konštelačná sieť - spojnice medzi blízkymi uzlami
      const maxDist = Math.min(width, height) * 0.16;
      const maxDistSq = maxDist * maxDist;
      const nLen = nodes.length;

      for (let i = 0; i < nLen; i++) {
        const p1 = nodes[i];
        if (!p1) continue;
        for (let j = i + 1; j < nLen; j++) {
          const p2 = nodes[j];
          if (!p2) continue;
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const distSq = dx * dx + dy * dy;

          if (distSq < maxDistSq) {
            const factor = 1 - distSq / maxDistSq;
            const lineAlpha = factor * (dark ? 0.11 : 0.05);
            context.strokeStyle =
              p1.gold || p2.gold
                ? `rgba(255, 199, 0, ${lineAlpha})`
                : dark
                  ? `rgba(64, 214, 206, ${lineAlpha})`
                  : `rgba(15, 23, 42, ${lineAlpha})`;
            context.lineWidth = 0.75;
            context.beginPath();
            context.moveTo(p1.x, p1.y);
            context.lineTo(p2.x, p2.y);
            context.stroke();
          }
        }
      }

      // Vykreslenie geometrických trojuholníkov, bodov a micro-tokenov
      context.font = "10px 'Space Mono', ui-monospace, monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";

      for (const p of nodes) {
        if (!p) continue;

        if (moving) {
          p.x += p.vx;
          p.y += p.vy;
          p.angle += p.spin;
          p.pulsePhase += p.pulseSpeed;

          // Jemné interaktívne odpudzovanie pri priblížení kurzora
          if (mouse.active) {
            const mx = p.x - mouse.x;
            const my = p.y - mouse.y;
            const mDistSq = mx * mx + my * my;
            if (mDistSq < 14400 && mDistSq > 1) {
              const mDist = Math.sqrt(mDistSq);
              const force = (1 - mDist / 120) * 0.35;
              p.x += (mx / mDist) * force * 2;
              p.y += (my / mDist) * force * 2;
            }
          }

          // Plynulé obtekanie hraníc obrazovky
          if (p.x < -16) p.x = width + 16;
          else if (p.x > width + 16) p.x = -16;
          if (p.y < -16) p.y = height + 16;
          else if (p.y > height + 16) p.y = -16;
        }

        const pulse = 0.85 + 0.15 * Math.sin(p.pulsePhase);
        const alpha = Math.min(
          1,
          Math.max(0, p.baseAlpha * pulse * (dark ? 0.85 : 0.45)),
        );

        if (p.type === "triangle") {
          const strokeColor = p.gold
            ? `rgba(255, 199, 0, ${alpha * 0.85})`
            : dark
              ? `rgba(64, 214, 206, ${alpha * 0.85})`
              : `rgba(15, 23, 42, ${alpha * 0.7})`;
          const fillColor = p.gold
            ? `rgba(255, 199, 0, ${alpha * 0.08})`
            : dark
              ? `rgba(64, 214, 206, ${alpha * 0.06})`
              : `rgba(15, 23, 42, ${alpha * 0.04})`;

          context.strokeStyle = strokeColor;
          context.lineWidth = 1;
          drawTriangle(context, p.x, p.y, p.size, p.angle, true, fillColor);

          // Vnútorný fraktálový delta trojuholník pre väčšie tvary (Vercel motív)
          if (p.size > 8) {
            drawTriangle(
              context,
              p.x,
              p.y,
              p.size * 0.42,
              p.angle + Math.PI,
              true,
            );
          }
        } else if (p.type === "glyph") {
          context.fillStyle = p.gold
            ? `rgba(255, 199, 0, ${alpha * 0.9})`
            : dark
              ? `rgba(255, 255, 255, ${alpha * 0.75})`
              : `rgba(15, 23, 42, ${alpha * 0.65})`;
          context.fillText(p.glyph, p.x, p.y);
        } else {
          // Bodový uzol
          context.fillStyle = p.gold
            ? `rgba(255, 199, 0, ${alpha})`
            : dark
              ? `rgba(64, 214, 206, ${alpha})`
              : `rgba(15, 23, 42, ${alpha * 0.75})`;
          context.beginPath();
          context.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          context.fill();
        }
      }
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    const start = () => {
      if (running || reduce.matches || document.hidden) return;
      running = true;
      frame = requestAnimationFrame(loop);
    };

    const loop = () => {
      if (!running) return;
      draw(true);
      frame = requestAnimationFrame(loop);
    };

    const onPointerMove = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
    };

    const onPointerLeave = () => {
      mouse.active = false;
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    const onReduce = () => {
      stop();
      draw(false);
      start();
    };

    resize();
    draw(false);
    start();

    const onResize = () => {
      resize();
      if (!running) draw(false);
    };

    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    reduce.addEventListener("change", onReduce);

    return () => {
      stop();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      reduce.removeEventListener("change", onReduce);
    };
  }, [dark]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden
    />
  );
}
