"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import type { HourlyPrice } from "@/lib/api";

/* ================================================================== */
/*  CONSTANTS                                                          */
/* ================================================================== */
const W = 720;
const H = 240;
const PAD_L = 48;
const PAD_R = 16;
const PAD_T = 20;
const PAD_B = 44;
const CHART_W = W - PAD_L - PAD_R;
const CHART_H = H - PAD_T - PAD_B;

const SPIKE_THRESHOLD = 0.25;
const VALLEY_THRESHOLD = 0.08;

function priceColor(kwh: number): string {
  if (kwh >= SPIKE_THRESHOLD) return "#ef4444";
  if (kwh >= 0.15) return "#f59e0b";
  return "#22c55e";
}

function formatHour(hour: number): string {
  const h = hour % 24;
  if (h === 0) return "12a";
  if (h < 12) return `${h}a`;
  if (h === 12) return "12p";
  return `${h - 12}p`;
}

function formatTime(hour: number): string {
  const h = hour % 24;
  const suffix = h < 12 ? "AM" : "PM";
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}:00 ${suffix}`;
}

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */
export default function PriceForecastChart({
  prices,
  loading,
  zone,
}: {
  prices: HourlyPrice[];
  loading: boolean;
  zone?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Hover handler - MUST be defined before any conditional returns
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || !prices.length) return;
      const rect = svg.getBoundingClientRect();
      const svgX = ((e.clientX - rect.left) / rect.width) * W;
      const idx = Math.round(((svgX - PAD_L) / CHART_W) * (prices.length - 1));
      if (idx >= 0 && idx < prices.length) {
        setHoverIdx(idx);
      } else {
        setHoverIdx(null);
      }
    },
    [prices]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverIdx(null);
  }, []);

  /* ---- Loading / empty states ---- */
  if (loading) {
    return (
      <div className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 h-full min-h-[420px] flex items-center justify-center">
        <span className="text-sm font-mono text-white/30 animate-pulse">
          loading forecast...
        </span>
      </div>
    );
  }

  if (!prices.length) {
    return (
      <div className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 h-full min-h-[420px] flex items-center justify-center">
        <span className="text-sm text-[#555] font-mono">
          Price forecast unavailable
        </span>
      </div>
    );
  }

  /* ---- Derived data ---- */
  const kwhPrices = prices.map((p) => p.consumer_price_kwh);
  const maxP = Math.max(...kwhPrices, SPIKE_THRESHOLD + 0.05);
  const minP = Math.min(...kwhPrices, 0);
  const range = maxP - minP || 0.1;

  const toX = (i: number) => PAD_L + (i / (prices.length - 1)) * CHART_W;
  const toY = (v: number) => PAD_T + (1 - (v - minP) / range) * CHART_H;

  // Stats
  const avg = kwhPrices.reduce((a, b) => a + b, 0) / kwhPrices.length;
  const peakIdx = kwhPrices.indexOf(Math.max(...kwhPrices));
  const lowIdx = kwhPrices.indexOf(Math.min(...kwhPrices));
  const peak = kwhPrices[peakIdx];
  const low = kwhPrices[lowIdx];

  // Find cheapest 3-hour window
  let cheapestWindowStart = 0;
  let cheapestWindowAvg = Infinity;
  for (let i = 0; i <= prices.length - 3; i++) {
    const windowAvg = (kwhPrices[i] + kwhPrices[i + 1] + kwhPrices[i + 2]) / 3;
    if (windowAvg < cheapestWindowAvg) {
      cheapestWindowAvg = windowAvg;
      cheapestWindowStart = i;
    }
  }

  // Find most expensive 3-hour window
  let expensiveWindowStart = 0;
  let expensiveWindowAvg = -Infinity;
  for (let i = 0; i <= prices.length - 3; i++) {
    const windowAvg = (kwhPrices[i] + kwhPrices[i + 1] + kwhPrices[i + 2]) / 3;
    if (windowAvg > expensiveWindowAvg) {
      expensiveWindowAvg = windowAvg;
      expensiveWindowStart = i;
    }
  }

  // Build color-segmented line paths
  const segments: { path: string; color: string }[] = [];
  for (let i = 0; i < prices.length - 1; i++) {
    const x1 = toX(i);
    const y1 = toY(kwhPrices[i]);
    const x2 = toX(i + 1);
    const y2 = toY(kwhPrices[i + 1]);
    const avgPrice = (kwhPrices[i] + kwhPrices[i + 1]) / 2;
    segments.push({
      path: `M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}`,
      color: priceColor(avgPrice),
    });
  }

  // Gradient fill path
  const linePath = prices
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.consumer_price_kwh).toFixed(1)}`
    )
    .join(" ");
  const areaPath = `${linePath} L${toX(prices.length - 1).toFixed(1)},${(
    PAD_T + CHART_H
  ).toFixed(1)} L${PAD_L.toFixed(1)},${(PAD_T + CHART_H).toFixed(1)} Z`;

  // Spike / valley region rects
  const spikeRects: { x: number; w: number }[] = [];
  const valleyRects: { x: number; w: number }[] = [];
  let spikeStart: number | null = null;
  let valleyStart: number | null = null;

  for (let i = 0; i < prices.length; i++) {
    const kwh = kwhPrices[i];
    if (kwh > SPIKE_THRESHOLD) {
      if (spikeStart === null) spikeStart = i;
    } else if (spikeStart !== null) {
      spikeRects.push({ x: toX(spikeStart), w: toX(i) - toX(spikeStart) });
      spikeStart = null;
    }
    if (kwh < VALLEY_THRESHOLD) {
      if (valleyStart === null) valleyStart = i;
    } else if (valleyStart !== null) {
      valleyRects.push({ x: toX(valleyStart), w: toX(i) - toX(valleyStart) });
      valleyStart = null;
    }
  }
  if (spikeStart !== null)
    spikeRects.push({
      x: toX(spikeStart),
      w: toX(prices.length - 1) - toX(spikeStart),
    });
  if (valleyStart !== null)
    valleyRects.push({
      x: toX(valleyStart),
      w: toX(prices.length - 1) - toX(valleyStart),
    });

  // Y-axis ticks
  const yTickCount = 5;
  const yTicks = Array.from({ length: yTickCount }, (_, i) => minP + (range * i) / (yTickCount - 1));

  // Day separator — hour 24
  const daySepX = toX(24);

  // "Now" marker — hour 0
  const nowX = toX(0);
  const nowY = toY(kwhPrices[0]);

  // Average utilization + wind
  const avgUtil = prices.reduce((s, p) => s + p.grid_utilization_pct, 0) / prices.length;
  const avgWind = prices.reduce((s, p) => s + p.wind_gen_factor, 0) / prices.length;

  const hoverPrice = hoverIdx !== null ? prices[hoverIdx] : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.25 }}
      className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 h-full"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-lg font-semibold text-white">
            48-Hour Price Forecast
          </h3>
          <p className="text-xs text-[#52525b] mt-0.5">
            ML + weather model prediction{zone ? ` \u00b7 ${zone} zone` : ""}
          </p>
        </div>
        <div className="flex items-center gap-5 text-xs font-mono">
          <span className="text-[#a1a1aa]">
            Avg{" "}
            <span className="text-white font-semibold">${avg.toFixed(3)}</span>
          </span>
          <span className="text-[#ef4444]">
            Peak{" "}
            <span className="text-white font-semibold">${peak.toFixed(3)}</span>
          </span>
          <span className="text-[#22c55e]">
            Low{" "}
            <span className="text-white font-semibold">${low.toFixed(3)}</span>
          </span>
        </div>
      </div>

      {/* Chart */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <linearGradient id="priceFillGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.12" />
            <stop offset="60%" stopColor="#22c55e" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y-axis grid + labels */}
        {yTicks.map((v, i) => (
          <g key={`y-${i}`}>
            <line
              x1={PAD_L}
              y1={toY(v)}
              x2={W - PAD_R}
              y2={toY(v)}
              stroke="#1a1a1a"
              strokeWidth="1"
            />
            <text
              x={PAD_L - 6}
              y={toY(v) + 3}
              textAnchor="end"
              className="text-[9px] fill-[#3f3f46] font-mono"
            >
              ${v.toFixed(2)}
            </text>
          </g>
        ))}

        {/* Threshold lines */}
        <line
          x1={PAD_L}
          y1={toY(SPIKE_THRESHOLD)}
          x2={W - PAD_R}
          y2={toY(SPIKE_THRESHOLD)}
          stroke="#ef4444"
          strokeWidth="0.5"
          strokeDasharray="4 3"
          opacity="0.4"
        />
        <line
          x1={PAD_L}
          y1={toY(VALLEY_THRESHOLD)}
          x2={W - PAD_R}
          y2={toY(VALLEY_THRESHOLD)}
          stroke="#22c55e"
          strokeWidth="0.5"
          strokeDasharray="4 3"
          opacity="0.4"
        />

        {/* Day separator */}
        <line
          x1={daySepX}
          y1={PAD_T}
          x2={daySepX}
          y2={PAD_T + CHART_H}
          stroke="#27272a"
          strokeWidth="1"
          strokeDasharray="6 4"
        />
        <text
          x={PAD_L + CHART_W * 0.22}
          y={H - 6}
          textAnchor="middle"
          className="text-[10px] fill-[#52525b] font-semibold"
        >
          Today
        </text>
        <text
          x={PAD_L + CHART_W * 0.72}
          y={H - 6}
          textAnchor="middle"
          className="text-[10px] fill-[#52525b] font-semibold"
        >
          Tomorrow
        </text>

        {/* Spike regions */}
        {spikeRects.map((r, i) => (
          <rect
            key={`spike-${i}`}
            x={r.x}
            y={PAD_T}
            width={Math.max(r.w, 2)}
            height={CHART_H}
            fill="rgba(239,68,68,0.06)"
          />
        ))}

        {/* Valley regions */}
        {valleyRects.map((r, i) => (
          <rect
            key={`valley-${i}`}
            x={r.x}
            y={PAD_T}
            width={Math.max(r.w, 2)}
            height={CHART_H}
            fill="rgba(34,197,94,0.06)"
          />
        ))}

        {/* Cheapest window highlight */}
        <rect
          x={toX(cheapestWindowStart)}
          y={PAD_T}
          width={toX(cheapestWindowStart + 3) - toX(cheapestWindowStart)}
          height={CHART_H}
          fill="rgba(34,197,94,0.08)"
          stroke="#22c55e"
          strokeWidth="0.5"
          strokeDasharray="3 2"
          opacity="0.6"
          rx="2"
        />

        {/* Area fill */}
        <path d={areaPath} fill="url(#priceFillGrad)" />

        {/* Color-segmented line */}
        {segments.map((seg, i) => (
          <path
            key={i}
            d={seg.path}
            fill="none"
            stroke={seg.color}
            strokeWidth="2"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Peak marker */}
        <circle
          cx={toX(peakIdx)}
          cy={toY(peak)}
          r="3.5"
          fill="#ef4444"
          stroke="#0a0a0a"
          strokeWidth="1.5"
        />
        <text
          x={toX(peakIdx)}
          y={toY(peak) - 8}
          textAnchor="middle"
          className="text-[8px] fill-[#ef4444] font-mono font-semibold"
        >
          ${peak.toFixed(2)}
        </text>

        {/* Low marker */}
        <circle
          cx={toX(lowIdx)}
          cy={toY(low)}
          r="3.5"
          fill="#22c55e"
          stroke="#0a0a0a"
          strokeWidth="1.5"
        />
        <text
          x={toX(lowIdx)}
          y={toY(low) + 14}
          textAnchor="middle"
          className="text-[8px] fill-[#22c55e] font-mono font-semibold"
        >
          ${low.toFixed(2)}
        </text>

        {/* "Now" animated dot */}
        <circle cx={nowX} cy={nowY} r="4" fill="#22c55e" opacity="0.3">
          <animate
            attributeName="r"
            values="4;8;4"
            dur="2s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.4;0.1;0.4"
            dur="2s"
            repeatCount="indefinite"
          />
        </circle>
        <circle cx={nowX} cy={nowY} r="3" fill="#22c55e" />

        {/* X-axis hour labels */}
        {prices
          .filter((_, i) => i % 6 === 0)
          .map((p) => (
            <text
              key={p.hour}
              x={toX(p.hour)}
              y={PAD_T + CHART_H + 16}
              textAnchor="middle"
              className="text-[9px] fill-[#3f3f46] font-mono"
            >
              {formatHour(p.hour)}
            </text>
          ))}

        {/* Hover crosshair + tooltip */}
        {hoverIdx !== null && hoverPrice && (
          <g>
            {/* Vertical line */}
            <line
              x1={toX(hoverIdx)}
              y1={PAD_T}
              x2={toX(hoverIdx)}
              y2={PAD_T + CHART_H}
              stroke="#52525b"
              strokeWidth="0.5"
              strokeDasharray="3 2"
            />
            {/* Dot */}
            <circle
              cx={toX(hoverIdx)}
              cy={toY(hoverPrice.consumer_price_kwh)}
              r="4"
              fill={priceColor(hoverPrice.consumer_price_kwh)}
              stroke="#0a0a0a"
              strokeWidth="2"
            />
            {/* Tooltip bg */}
            <rect
              x={Math.min(toX(hoverIdx) - 72, W - PAD_R - 148)}
              y={Math.max(PAD_T, toY(hoverPrice.consumer_price_kwh) - 56)}
              width="144"
              height="50"
              rx="6"
              fill="#0a0a0a"
              stroke="#27272a"
              strokeWidth="1"
              opacity="0.95"
            />
            {/* Tooltip text */}
            <text
              x={Math.min(toX(hoverIdx) - 72, W - PAD_R - 148) + 8}
              y={Math.max(PAD_T, toY(hoverPrice.consumer_price_kwh) - 56) + 16}
              className="text-[10px] fill-white font-mono font-bold"
            >
              ${hoverPrice.consumer_price_kwh.toFixed(4)}/kWh
            </text>
            <text
              x={Math.min(toX(hoverIdx) - 72, W - PAD_R - 148) + 8}
              y={Math.max(PAD_T, toY(hoverPrice.consumer_price_kwh) - 56) + 30}
              className="text-[9px] fill-[#a1a1aa] font-mono"
            >
              {formatTime(hoverPrice.hour)} · ${hoverPrice.price_mwh.toFixed(0)}/MWh
            </text>
            <text
              x={Math.min(toX(hoverIdx) - 72, W - PAD_R - 148) + 8}
              y={Math.max(PAD_T, toY(hoverPrice.consumer_price_kwh) - 56) + 43}
              className="text-[9px] fill-[#52525b] font-mono"
            >
              Grid {hoverPrice.grid_utilization_pct.toFixed(0)}% · Wind{" "}
              {(hoverPrice.wind_gen_factor * 100).toFixed(0)}%
            </text>
          </g>
        )}
      </svg>

      {/* Bottom context bar */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#1a1a1a]">
        {/* Legend */}
        <div className="flex items-center gap-4 text-[10px] text-[#52525b]">
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-0.5 rounded-full bg-[#22c55e]" />
            &lt; $0.08
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-0.5 rounded-full bg-[#f59e0b]" />
            $0.08–$0.25
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-0.5 rounded-full bg-[#ef4444]" />
            &gt; $0.25
          </span>
        </div>

        {/* Grid + wind stats */}
        <div className="flex items-center gap-5 text-[10px] font-mono">
          <span className="text-[#52525b]">
            Grid Load{" "}
            <span
              className={
                avgUtil > 85
                  ? "text-[#ef4444]"
                  : avgUtil > 65
                  ? "text-[#f59e0b]"
                  : "text-[#22c55e]"
              }
            >
              {avgUtil.toFixed(0)}%
            </span>
          </span>
          <span className="text-[#52525b]">
            Wind Gen{" "}
            <span className="text-[#3b82f6]">
              {(avgWind * 100).toFixed(0)}%
            </span>
          </span>
          <span className="text-[#52525b]">
            Best window{" "}
            <span className="text-[#22c55e]">
              {formatHour(prices[cheapestWindowStart].hour)}–
              {formatHour(prices[cheapestWindowStart + 2].hour + 1)}
            </span>
          </span>
        </div>
      </div>
    </motion.div>
  );
}
