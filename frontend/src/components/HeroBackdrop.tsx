import { useEffect, useRef } from "react";

import { useReducedMotion } from "../hooks/useReducedMotion";

/** Shown before any search. Decorative only; it is never presented as data. */
const IDLE_SERIES = [
  52, 55, 50, 47, 58, 54, 50, 44, 40, 36, 45, 50, 60, 57, 49, 66, 74, 72, 74, 70, 77, 71, 62, 56,
];

function smoothPath(values: readonly number[], width: number, top: number, height: number): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map(
    (v, i) =>
      [(i / Math.max(values.length - 1, 1)) * width, top + ((max - v) / span) * height] as const,
  );
  let d = "";
  pts.forEach(([x, y], i) => {
    const prev = pts[i - 1];
    if (!prev) {
      d = `M${x},${y}`;
      return;
    }
    const cx = (prev[0] + x) / 2;
    d += ` C${cx},${prev[1]} ${cx},${y} ${x},${y}`;
  });
  return d;
}

/**
 * The hero's moving horizon: a glowing line that draws itself, plus rising
 * embers. After a search the line traces that symbol's average highs.
 */
export function HeroBackdrop({ series }: { series: readonly number[] | null }) {
  const values = series && series.length >= 2 ? series : IDLE_SERIES;
  const d = smoothPath(values, 1440, 150, 210);
  return (
    <>
      <Embers />
      <svg
        className="hero-line"
        viewBox="0 0 1440 400"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="hero-stroke" x1="0" x2="1">
            <stop offset="0" stopColor="#FF5A1F" stopOpacity="0" />
            <stop offset="0.25" stopColor="#FF8A3D" />
            <stop offset="0.8" stopColor="#FFC66E" />
            <stop offset="1" stopColor="#F7E7C6" />
          </linearGradient>
          <linearGradient id="hero-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FF8A3D" stopOpacity="0.22" />
            <stop offset="1" stopColor="#FF5A1F" stopOpacity="0" />
          </linearGradient>
          <filter id="hero-glow" x="-5%" y="-50%" width="110%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Keyed by the path, so each new symbol draws its line afresh. */}
        <g key={d}>
          <path className="hero-line-fill" d={`${d} L1440,400 L0,400Z`} fill="url(#hero-fill)" />
          <path
            className="hero-line-stroke"
            d={d}
            pathLength={1000}
            fill="none"
            stroke="url(#hero-stroke)"
            strokeWidth="2.5"
            filter="url(#hero-glow)"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>
    </>
  );
}

interface Ember {
  x: number;
  y: number;
  r: number;
  v: number;
  w: number;
  a: number;
}

/** Rising embers on a canvas. Off for reduced motion, and paused while the hero is out of view. */
function Embers() {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || reduced) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let frame = 0;
    let visible = true;
    const resize = () => {
      w = canvas.width = canvas.offsetWidth * dpr;
      h = canvas.height = canvas.offsetHeight * dpr;
    };
    const spawn = (y?: number): Ember => ({
      x: Math.random() * w,
      y: y ?? h + 10,
      r: (Math.random() * 1.8 + 0.6) * dpr,
      v: (Math.random() * 0.5 + 0.25) * dpr,
      w: Math.random() * Math.PI * 2,
      a: Math.random() * 0.6 + 0.3,
    });
    resize();
    const embers = Array.from({ length: 64 }, () => spawn(Math.random() * h));
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const e of embers) {
        e.y -= e.v;
        e.w += 0.02;
        e.x += Math.sin(e.w) * 0.4;
        const life = Math.max(e.y / h, 0);
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, ${Math.round(150 + life * 60)}, 80, ${e.a * life})`;
        ctx.shadowColor = "rgba(255, 120, 40, 0.9)";
        ctx.shadowBlur = 8 * dpr;
        ctx.fill();
        if (e.y < -10) Object.assign(e, spawn());
      }
      frame = visible ? requestAnimationFrame(tick) : 0;
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible && frame === 0) frame = requestAnimationFrame(tick);
    });
    observer.observe(canvas);
    window.addEventListener("resize", resize);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [reduced]);

  return <canvas ref={ref} className="embers" aria-hidden="true" />;
}
