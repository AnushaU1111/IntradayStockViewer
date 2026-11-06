import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import type { DailySummary } from "@isv/shared";

import {
  formatCompact,
  formatDayLong,
  formatDayShort,
  formatPrice,
  formatRange,
  formatVolume,
  splitDay,
  spread,
  weekdayIndex,
} from "../lib/format";
import { priceScale } from "../lib/scale";

import "./ResultsChart.css";

interface Props {
  symbol: string;
  days: readonly DailySummary[];
  currency: string | null;
  partialDay: string | null;
  focusIndex: number;
  onFocusIndex: (index: number) => void;
}

/** Price axis title per D-43: averages, not daily extremes, with the unit only when the API sends one. */
export function priceAxisTitle(currency: string | null): string {
  return currency === null
    ? "Average of 15-min lows and highs"
    : `Average of 15-min lows and highs (${currency})`;
}

const FALLBACK_WIDTH = 960;
const CHAR = 6.8; // JetBrains Mono at 11px

/**
 * Hand-built SVG (DECISIONS D-55): one capsule per day from average low to
 * average high, a soft band through them, and volume on a shared date axis.
 */
export function ResultsChart({
  symbol,
  days,
  currency,
  partialDay,
  focusIndex,
  onFocusIndex,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [spoken, setSpoken] = useState("");
  const descId = useId();
  const gid = useId().replaceAll(":", "");

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  const n = days.length;
  const focus = days[Math.min(Math.max(focusIndex, 0), n - 1)];
  const last = days[n - 1];
  if (!focus || !last) return null;

  const compact = width < 640;
  const H = compact ? 380 : 460;
  const lows = days.map((d) => d.lowAverage);
  const highs = days.map((d) => d.highAverage);
  const scale = priceScale(Math.min(...lows), Math.max(...highs), compact ? 4 : 5);
  const tagDecimals = scale.max < 10 ? 4 : 2;
  const fmtTick = (v: number) =>
    v.toLocaleString("en-US", {
      minimumFractionDigits: scale.decimals,
      maximumFractionDigits: scale.decimals,
    });
  const fmtTag = (v: number) =>
    v.toLocaleString("en-US", {
      minimumFractionDigits: tagDecimals,
      maximumFractionDigits: tagDecimals,
    });
  const labelChars = Math.max(
    ...scale.ticks.map((t) => fmtTick(t).length),
    fmtTag(scale.max).length,
  );

  const L = compact ? 12 : 20;
  const R = Math.max(56, Math.round(labelChars * CHAR + 26));
  const T = 44;
  const VOL = compact ? 64 : 84;
  const GAP = 26;
  const XAX = 34;
  const RIB = H - T - GAP - VOL - XAX;
  const W = width;
  const PW = W - L - R;
  const slot = PW / n;
  const x = (i: number) => L + (i + 0.5) * slot;
  const y = (v: number) => T + ((scale.max - v) / (scale.max - scale.min)) * RIB;
  const volTop = T + RIB + GAP;
  const vy0 = volTop + VOL;
  const vmax = Math.max(...days.map((d) => d.volume), 1);
  const vh = (v: number) => (v / vmax) * (VOL - 8);
  const barW = Math.min(14, Math.max(3, slot * 0.45));
  const fi = days.indexOf(focus);
  const li = n - 1;
  const lastPartial = last.day === partialDay;

  const highPts = days.map((d, i) => `${x(i)},${y(d.highAverage)}`).join(" ");
  const lowPtsRev = days
    .map((d, i) => `${x(i)},${y(d.lowAverage)}`)
    .reverse()
    .join(" ");

  // Date labels on the first trading day of each week, if there is room.
  const labels: number[] = [];
  let prevWeekday = 8;
  days.forEach((d, i) => {
    const parts = splitDay(d.day);
    const wd = parts ? weekdayIndex(parts) : 0;
    const newWeek = wd <= prevWeekday;
    prevWeekday = wd;
    const lastLabel = labels.at(-1);
    if ((newWeek || i === 0) && (lastLabel === undefined || x(i) - x(lastLabel) >= 64))
      labels.push(i);
  });

  const tags = [focus.highAverage, last.highAverage];
  const tickHidden = (v: number) => tags.some((t) => Math.abs(y(t) - y(v)) < 16);
  const focusLabel = formatDayLong(focus.day);
  const dateTagW = focusLabel.length * CHAR + 16;
  const dateTagX = Math.min(Math.max(x(fi) - dateTagW / 2, L), W - R - dateTagW);

  function move(next: number, announce: boolean) {
    const i = Math.min(Math.max(next, 0), n - 1);
    if (i !== fi) onFocusIndex(i);
    const d = days[i];
    if (announce && d) {
      setSpoken(
        `${formatDayLong(d.day)}${d.day === partialDay ? ", still trading" : ""}: average low ${formatPrice(
          d.lowAverage,
        )}, average high ${formatPrice(d.highAverage)}, volume ${formatVolume(d.volume)}.`,
      );
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const px = ((event.clientX - rect.left) * W) / rect.width;
    move(Math.floor((px - L) / slot), false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next =
      event.key === "ArrowLeft"
        ? fi - 1
        : event.key === "ArrowRight"
          ? fi + 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? li
              : null;
    if (next === null) return; // Tab and everything else pass through: no keyboard trap
    event.preventDefault();
    move(next, true);
  }

  const hiDay = days.reduce((a, b) => (b.highAverage > a.highAverage ? b : a));
  const loDay = days.reduce((a, b) => (b.lowAverage < a.lowAverage ? b : a));
  const unit = currency === null ? "" : ` ${currency}`;

  return (
    <section className="chart-card" aria-label={`${symbol} chart`}>
      <div className="legend" aria-hidden="true">
        <span className="legend-day">
          {focusLabel}
          {focus.day === partialDay && <span className="live-badge">Still trading</span>}
        </span>
        <span>
          <span className="legend-swatch" style={{ background: "var(--gold)" }} />
          <span className="legend-key">Avg high</span>
          <span className="num">{formatPrice(focus.highAverage)}</span>
        </span>
        <span>
          <span className="legend-swatch" style={{ background: "var(--ember)" }} />
          <span className="legend-key">Avg low</span>
          <span className="num">{formatPrice(focus.lowAverage)}</span>
        </span>
        <span>
          <span className="legend-key">Spread</span>
          <span className="num">{formatPrice(spread(focus.lowAverage, focus.highAverage))}</span>
        </span>
        <span>
          <span className="legend-key">Volume</span>
          <span className="num">{formatVolume(focus.volume)}</span>
        </span>
      </div>
      <div
        ref={frameRef}
        className="chart-frame"
        role="group"
        aria-roledescription="chart"
        aria-label={`${symbol}: average daily range and volume. Use the left and right arrow keys to move between days.`}
        aria-describedby={descId}
        tabIndex={0}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onKeyDown={onKeyDown}
      >
        <p className="sr-only" id={descId}>
          {formatRange(days[0]?.day ?? last.day, last.day)}, {n} trading days. Price axis:{" "}
          {priceAxisTitle(currency)}. Volume axis: Volume. Highest average high{" "}
          {formatPrice(hiDay.highAverage)}
          {unit} on {formatDayShort(hiDay.day)}; lowest average low {formatPrice(loDay.lowAverage)}
          {unit} on {formatDayShort(loDay.day)}. The table below lists every day.
        </p>
        <p className="sr-only" aria-live="polite">
          {spoken}
        </p>
        <span className="chart-hint" aria-hidden="true">
          ← → to move between days
        </span>
        <svg viewBox={`0 0 ${W} ${H}`} height={H} aria-hidden="true" data-testid="chart-svg">
          <defs>
            <linearGradient id={`${gid}-band`} x1="0" x2="1">
              <stop offset="0" stopColor="#FF5A1F" />
              <stop offset="1" stopColor="#FFC66E" />
            </linearGradient>
            <linearGradient id={`${gid}-glow`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FF8A3D" stopOpacity="0.22" />
              <stop offset="1" stopColor="#FF5A1F" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${gid}-bar`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFC66E" />
              <stop offset="1" stopColor="#FF5A1F" />
            </linearGradient>
            <linearGradient id={`${gid}-vol`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFC66E" />
              <stop offset="1" stopColor="#FF5A1F" stopOpacity="0.6" />
            </linearGradient>
          </defs>

          <text className="axis-title" x={L} y={T - 22}>
            {priceAxisTitle(currency)}
          </text>
          {scale.ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
              {!tickHidden(v) && (
                <text x={W - R + 12} y={y(v) + 4} fill="var(--dim)">
                  {fmtTick(v)}
                </text>
              )}
            </g>
          ))}
          {labels.map((i) => (
            <line key={i} x1={x(i)} x2={x(i)} y1={T} y2={vy0} stroke="var(--grid)" />
          ))}
          <line
            x1={L}
            x2={W - R}
            y1={T + RIB + GAP / 2}
            y2={T + RIB + GAP / 2}
            stroke="var(--line)"
          />
          <line x1={W - R} x2={W - R} y1={T - 8} y2={vy0 + 4} stroke="var(--line)" />

          <g className="chart-band">
            <polygon
              points={`${highPts} ${x(li)},${T + RIB} ${x(0)},${T + RIB}`}
              fill={`url(#${gid}-glow)`}
            />
            <polygon
              points={`${highPts} ${lowPtsRev}`}
              fill={`url(#${gid}-band)`}
              fillOpacity="0.22"
            />
            <polyline
              points={highPts}
              fill="none"
              stroke="var(--gold)"
              strokeOpacity="0.5"
              strokeWidth="1.2"
            />
          </g>

          {days.map((d, i) => {
            const top = y(d.highAverage);
            const h = Math.max(3, y(d.lowAverage) - top);
            const live = d.day === partialDay;
            return (
              <rect
                key={d.day}
                className="rbar"
                data-day={d.day}
                style={{ animationDelay: `${0.4 + i * 0.025}s` }}
                x={x(i) - barW / 2}
                y={top - (h - (y(d.lowAverage) - top)) / 2}
                width={barW}
                height={h}
                rx={Math.min(barW / 2, h / 2)}
                fill={live ? "var(--live)" : `url(#${gid}-bar)`}
                opacity={i === fi || live ? 1 : 0.82}
              />
            );
          })}

          <text className="axis-title" x={L} y={volTop + 12}>
            Volume
          </text>
          <text x={W - R + 12} y={volTop + 12} fill="var(--dim)">
            {formatCompact(vmax)}
          </text>
          {days.map((d, i) => {
            const live = d.day === partialDay;
            const w = Math.min(14, Math.max(2, slot * 0.56));
            return (
              <rect
                key={d.day}
                className="vbar"
                style={{ animationDelay: `${0.6 + i * 0.03}s` }}
                x={x(i) - w / 2}
                y={vy0 - vh(d.volume)}
                width={w}
                height={Math.max(1, vh(d.volume))}
                rx="1.5"
                fill={live ? "var(--live)" : i === fi ? `url(#${gid}-vol)` : "#3A2A20"}
                fillOpacity={live ? 0.75 : 1}
              />
            );
          })}

          {/* crosshair */}
          <line x1={x(fi)} x2={x(fi)} y1={T - 8} y2={vy0} stroke="#8A7A6E" strokeDasharray="4 4" />
          <line
            x1={L}
            x2={W - R}
            y1={y(focus.highAverage)}
            y2={y(focus.highAverage)}
            stroke="#8A7A6E"
            strokeDasharray="4 4"
          />
          <circle
            cx={x(fi)}
            cy={y(focus.highAverage)}
            r="4.5"
            fill="var(--panel)"
            stroke="var(--gold)"
            strokeWidth="2"
          />
          <circle
            cx={x(fi)}
            cy={y(focus.lowAverage)}
            r="4.5"
            fill="var(--panel)"
            stroke="var(--ember)"
            strokeWidth="2"
          />

          {lastPartial && (
            <>
              <circle
                className="live-dot"
                cx={x(li)}
                cy={y(last.highAverage)}
                r="5"
                fill="var(--live)"
              />
              <text
                className="axis-title"
                x={x(li) - 12}
                y={y(last.highAverage) - 14}
                textAnchor="end"
                fill="var(--live)"
                style={{ fill: "var(--live)" }}
              >
                Still trading
              </text>
            </>
          )}

          {/* axis tags: the latest value, then the focused one on top */}
          <AxisTag
            x={W - R + 4}
            y={y(last.highAverage)}
            w={R - 10}
            label={fmtTag(last.highAverage)}
            bg={lastPartial ? "var(--live)" : "var(--gold)"}
          />
          {fi !== li && (
            <AxisTag
              x={W - R + 4}
              y={y(focus.highAverage)}
              w={R - 10}
              label={fmtTag(focus.highAverage)}
              bg="var(--text)"
            />
          )}

          {labels.map((i) =>
            Math.abs(x(i) - x(fi)) < dateTagW / 2 + 28 ? null : (
              <text key={i} x={x(i)} y={vy0 + 20} fill="var(--dim)" textAnchor="middle">
                {formatDayShort(days[i]?.day ?? "")}
              </text>
            ),
          )}
          <rect x={dateTagX} y={vy0 + 6} width={dateTagW} height="20" rx="4" fill="var(--text)" />
          <text
            x={dateTagX + dateTagW / 2}
            y={vy0 + 20}
            fill="#0B0806"
            textAnchor="middle"
            fontWeight="500"
          >
            {focusLabel}
          </text>
        </svg>
      </div>
    </section>
  );
}

function AxisTag({
  x,
  y,
  w,
  label,
  bg,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  bg: string;
}) {
  return (
    <g>
      <rect x={x} y={y - 10} width={w} height="20" rx="4" fill={bg} />
      <text x={x + 8} y={y + 4} fill="#0B0806" fontWeight="500">
        {label}
      </text>
    </g>
  );
}
