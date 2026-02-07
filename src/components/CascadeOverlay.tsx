"use client";

import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  Fragment,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { SimulationSession } from "@/hooks/useRealtimeSession";

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */
export interface CascadeOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  region?: string;
  scenario?: string;
  scenarioKey?: string;
  session?: SimulationSession | null;
}

type NodeState = "healthy" | "stressed" | "overloaded" | "failed";

interface SimNode {
  id: string;
  x: number;
  y: number;
}

interface SimEdge {
  from: string;
  to: string;
  major: boolean;
}

/* ================================================================== */
/*  NODE DATA — 55 substations, ~Texas geography                      */
/* ================================================================== */
const N: [string, number, number][] = [
  // El Paso (2)
  ["ELP-01", 50, 270], ["ELP-02", 80, 295],
  // Midland (2)
  ["MID-01", 140, 305], ["MID-02", 170, 288],
  // West TX (5)
  ["WTX-01", 152, 222], ["WTX-02", 192, 238], ["WTX-03", 168, 255],
  ["WTX-04", 198, 255], ["WTX-05", 142, 260],
  // Lubbock (3)
  ["LBK-01", 232, 150], ["LBK-02", 258, 165], ["LBK-03", 250, 188],
  // Abilene (1)
  ["ABI-01", 305, 228],
  // Waco (1)
  ["WCO-01", 392, 270],
  // Dallas (8)
  ["DAL-01", 455, 114], ["DAL-02", 485, 124], ["DAL-03", 470, 144],
  ["DAL-04", 500, 134], ["DAL-05", 450, 134], ["DAL-06", 515, 120],
  ["DAL-07", 480, 160], ["DAL-08", 505, 104],
  // Tyler (1)
  ["TYL-01", 558, 174],
  // Bryan/College Station (1)
  ["BRY-01", 520, 305],
  // Austin (8)
  ["ATX-01", 405, 315], ["ATX-02", 435, 320], ["ATX-03", 420, 340],
  ["ATX-04", 450, 335], ["ATX-05", 405, 348], ["ATX-06", 430, 305],
  ["ATX-07", 460, 345], ["ATX-08", 390, 330],
  // San Antonio (6)
  ["SAT-01", 365, 390], ["SAT-02", 390, 400], ["SAT-03", 375, 415],
  ["SAT-04", 355, 405], ["SAT-05", 395, 390], ["SAT-06", 370, 432],
  // Houston (10)
  ["HOU-01", 570, 355], ["HOU-02", 600, 365], ["HOU-03", 580, 380],
  ["HOU-04", 605, 385], ["HOU-05", 560, 375], ["HOU-06", 620, 375],
  ["HOU-07", 585, 400], ["HOU-08", 555, 392], ["HOU-09", 600, 345],
  ["HOU-10", 630, 395],
  // Beaumont (1)
  ["BEA-01", 665, 385],
  // Corpus Christi (3)
  ["CRP-01", 415, 465], ["CRP-02", 440, 475], ["CRP-03", 430, 492],
  // Valley (3)
  ["VLY-01", 360, 505], ["VLY-02", 380, 520], ["VLY-03", 370, 538],
];

const NODES: SimNode[] = N.map(([id, x, y]) => ({ id, x, y }));
const NODE_MAP: Record<string, SimNode> = Object.fromEntries(
  NODES.map((n) => [n.id, n])
);

/* ================================================================== */
/*  EDGE DATA                                                          */
/* ================================================================== */
const ED: [string, string, boolean?][] = [
  // El Paso
  ["ELP-01", "ELP-02"],
  // Midland
  ["MID-01", "MID-02"],
  // West TX
  ["WTX-01", "WTX-02"], ["WTX-01", "WTX-03"], ["WTX-02", "WTX-04"],
  ["WTX-03", "WTX-04"], ["WTX-03", "WTX-05"], ["WTX-05", "WTX-01"],
  // Lubbock
  ["LBK-01", "LBK-02"], ["LBK-02", "LBK-03"],
  // Dallas
  ["DAL-01", "DAL-02"], ["DAL-01", "DAL-05"], ["DAL-02", "DAL-03"],
  ["DAL-02", "DAL-04"], ["DAL-03", "DAL-07"], ["DAL-04", "DAL-06"],
  ["DAL-05", "DAL-03"], ["DAL-06", "DAL-08"], ["DAL-08", "DAL-02"],
  // Austin
  ["ATX-01", "ATX-02"], ["ATX-01", "ATX-08"], ["ATX-02", "ATX-04"],
  ["ATX-03", "ATX-05"], ["ATX-03", "ATX-02"], ["ATX-04", "ATX-07"],
  ["ATX-05", "ATX-08"], ["ATX-06", "ATX-01"], ["ATX-06", "ATX-02"],
  // San Antonio
  ["SAT-01", "SAT-02"], ["SAT-01", "SAT-04"], ["SAT-02", "SAT-03"],
  ["SAT-02", "SAT-05"], ["SAT-03", "SAT-04"], ["SAT-05", "SAT-06"],
  ["SAT-03", "SAT-06"],
  // Houston
  ["HOU-01", "HOU-02"], ["HOU-01", "HOU-05"], ["HOU-02", "HOU-03"],
  ["HOU-02", "HOU-09"], ["HOU-03", "HOU-04"], ["HOU-03", "HOU-07"],
  ["HOU-04", "HOU-06"], ["HOU-05", "HOU-08"], ["HOU-06", "HOU-10"],
  ["HOU-07", "HOU-08"], ["HOU-09", "HOU-06"], ["HOU-04", "HOU-10"],
  // Corpus Christi
  ["CRP-01", "CRP-02"], ["CRP-02", "CRP-03"],
  // Valley
  ["VLY-01", "VLY-02"], ["VLY-02", "VLY-03"],
  // Inter-cluster (major transmission)
  ["MID-01", "ELP-02", true],
  ["WTX-01", "MID-02", true],
  ["WTX-02", "LBK-01"],
  ["WTX-02", "ABI-01", true],
  ["LBK-03", "ABI-01"],
  ["ABI-01", "WCO-01", true],
  ["WCO-01", "ATX-01", true],
  ["WCO-01", "DAL-07", true],
  ["DAL-04", "TYL-01", true],
  ["TYL-01", "HOU-09", true],
  ["HOU-01", "BRY-01", true],
  ["BRY-01", "ATX-07", true],
  ["ATX-05", "SAT-01"],
  ["ATX-03", "SAT-05"],
  ["SAT-06", "CRP-01", true],
  ["CRP-03", "VLY-01"],
  ["SAT-06", "VLY-01"],
  ["HOU-10", "BEA-01", true],
];

const EDGES: SimEdge[] = ED.map(([from, to, major]) => ({
  from,
  to,
  major: !!major,
}));

/* ================================================================== */
/*  CASCADE TIMELINE                                                   */
/* ================================================================== */
const CASCADE: { time: number; id: string; state: NodeState }[] = [
  // T-36h: West TX stress
  { time: 2.0, id: "WTX-01", state: "stressed" },
  { time: 2.1, id: "WTX-02", state: "stressed" },
  { time: 2.2, id: "WTX-03", state: "stressed" },
  { time: 2.3, id: "WTX-04", state: "stressed" },
  { time: 2.4, id: "WTX-05", state: "stressed" },
  // T-24h: Overload
  { time: 4.0, id: "WTX-01", state: "overloaded" },
  { time: 4.1, id: "WTX-02", state: "overloaded" },
  { time: 4.2, id: "WTX-03", state: "overloaded" },
  { time: 4.3, id: "WTX-04", state: "overloaded" },
  { time: 4.4, id: "WTX-05", state: "overloaded" },
  // First failure
  { time: 5.0, id: "WTX-04", state: "failed" },
  { time: 5.3, id: "MID-01", state: "stressed" },
  { time: 5.5, id: "MID-02", state: "stressed" },
  // Cascade wave 1
  { time: 6.0, id: "WTX-03", state: "failed" },
  { time: 6.3, id: "ABI-01", state: "stressed" },
  { time: 6.5, id: "WTX-01", state: "failed" },
  { time: 6.7, id: "LBK-01", state: "stressed" },
  // Cascade wave 2
  { time: 7.0, id: "WTX-05", state: "failed" },
  { time: 7.3, id: "MID-01", state: "overloaded" },
  { time: 7.5, id: "WTX-02", state: "failed" },
  { time: 7.7, id: "MID-02", state: "overloaded" },
  // Cascade wave 3
  { time: 8.0, id: "MID-01", state: "failed" },
  { time: 8.3, id: "LBK-01", state: "overloaded" },
  { time: 8.5, id: "MID-02", state: "failed" },
  { time: 8.7, id: "ABI-01", state: "overloaded" },
  // Cascade wave 4
  { time: 9.0, id: "LBK-01", state: "failed" },
  { time: 9.3, id: "LBK-02", state: "stressed" },
  { time: 9.5, id: "ABI-01", state: "failed" },
  { time: 9.7, id: "WCO-01", state: "stressed" },
  // Cascade wave 5
  { time: 10.0, id: "WCO-01", state: "overloaded" },
  { time: 10.5, id: "WCO-01", state: "failed" },
  { time: 10.7, id: "ATX-01", state: "stressed" },
  { time: 10.8, id: "ATX-08", state: "stressed" },
  // Cascade wave 6 — reaches Austin & San Antonio
  { time: 11.0, id: "ATX-08", state: "failed" },
  { time: 11.2, id: "ATX-05", state: "stressed" },
  { time: 11.5, id: "ATX-05", state: "failed" },
  { time: 11.7, id: "ATX-03", state: "stressed" },
  { time: 11.8, id: "SAT-01", state: "stressed" },
  { time: 12.0, id: "ATX-03", state: "failed" },
  { time: 12.3, id: "SAT-01", state: "overloaded" },
  { time: 12.5, id: "SAT-01", state: "failed" },
];

/* ================================================================== */
/*  IMPACT METRIC TYPE                                                 */
/* ================================================================== */
interface ImpactMetric {
  label: string;
  without: { value: number; fmt: (n: number) => string; desc: string };
  withBo: { value: number; fmt: (n: number) => string; desc: string };
  delta: string;
}

/* ================================================================== */
/*  STATE COLORS                                                       */
/* ================================================================== */
const STATE_COLORS: Record<NodeState, string> = {
  healthy: "#22c55e",
  stressed: "#f59e0b",
  overloaded: "#ef4444",
  failed: "#ef4444",
};

/* ================================================================== */
/*  HOOKS                                                              */
/* ================================================================== */
function useCountUp(target: number, duration: number, active: boolean) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!active) {
      setValue(0);
      return;
    }
    const start = Date.now();
    const dur = duration * 1000;
    let raf: number;

    const frame = () => {
      const p = Math.min((Date.now() - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, active]);

  return value;
}

/* ================================================================== */
/*  METRIC ROW (Phase 2)                                               */
/* ================================================================== */
function MetricRow({
  metric,
  index,
  leftActive,
  rightActive,
  deltaActive,
}: {
  metric: ImpactMetric;
  index: number;
  leftActive: boolean;
  rightActive: boolean;
  deltaActive: boolean;
}) {
  const leftVal = useCountUp(metric.without.value, 2, leftActive);
  const rightVal = useCountUp(metric.withBo.value, 2, rightActive);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.15 }}
      className="flex items-stretch gap-4"
    >
      {/* Left — WITHOUT */}
      <motion.div
        animate={{ opacity: leftActive ? 1 : 0.3 }}
        className="flex-1 bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 hover:border-[#ef4444]/30 transition-colors"
      >
        <p className="text-xs uppercase tracking-widest text-[#71717a] mb-2">
          {metric.label}
        </p>
        <p className="text-4xl lg:text-5xl font-mono font-bold text-[#ef4444]">
          {leftActive ? metric.without.fmt(leftVal) : "—"}
        </p>
        <p className="text-sm text-[#a1a1aa] mt-2">{metric.without.desc}</p>
      </motion.div>

      {/* Delta badge */}
      <div className="w-[80px] flex items-center justify-center flex-shrink-0">
        <AnimatePresence>
          {deltaActive && (
            <motion.span
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 15 }}
              className="bg-[#22c55e]/15 text-[#22c55e] text-sm font-bold px-3 py-1.5 rounded-full whitespace-nowrap border border-[#22c55e]/20"
            >
              {metric.delta}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Right — WITH */}
      <motion.div
        animate={{ opacity: rightActive ? 1 : 0.3 }}
        className="flex-1 bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 hover:border-[#22c55e]/30 transition-colors"
      >
        <p className="text-xs uppercase tracking-widest text-[#71717a] mb-2">
          {metric.label}
        </p>
        <p className="text-4xl lg:text-5xl font-mono font-bold text-[#22c55e]">
          {rightActive ? metric.withBo.fmt(rightVal) : "—"}
        </p>
        <p className="text-sm text-[#a1a1aa] mt-2">{metric.withBo.desc}</p>
      </motion.div>
    </motion.div>
  );
}

/* ================================================================== */
/*  PHASE 1 — CASCADE SIMULATION                                      */
/* ================================================================== */
function CascadeSimulation({
  onComplete,
  region,
  scenario,
}: {
  onComplete: () => void;
  region: string;
  scenario: string;
}) {
  const [simTime, setSimTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const lastTick = useRef(0);
  const completeCalled = useRef(false);

  // Auto-start after 1s
  useEffect(() => {
    const t = setTimeout(() => setIsPlaying(true), 1000);
    return () => clearTimeout(t);
  }, []);

  // Simulation loop
  useEffect(() => {
    if (!isPlaying) return;
    lastTick.current = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      const delta = ((now - lastTick.current) / 1000) * speed;
      lastTick.current = now;
      setSimTime((prev) => {
        const next = Math.min(prev + delta, 15);
        if (next >= 15) {
          setIsPlaying(false);
        }
        return next;
      });
    }, 50);
    return () => clearInterval(interval);
  }, [isPlaying, speed]);

  // Auto-transition to Phase 2 after hold
  useEffect(() => {
    if (simTime >= 15 && !completeCalled.current) {
      completeCalled.current = true;
      const t = setTimeout(onComplete, 3000);
      return () => clearTimeout(t);
    }
  }, [simTime, onComplete]);

  // Derive node states from timeline
  const nodeStates = useMemo(() => {
    const states: Record<string, NodeState> = {};
    NODES.forEach((n) => {
      states[n.id] = "healthy";
    });
    CASCADE.forEach((e) => {
      if (simTime >= e.time) states[e.id] = e.state;
    });
    return states;
  }, [simTime]);

  // Edge color
  const getEdgeColor = useCallback(
    (from: string, to: string): string => {
      const sf = nodeStates[from];
      const st = nodeStates[to];
      if (sf === "failed" || st === "failed") return "#3f3f46";
      if (sf === "overloaded" || st === "overloaded") return "#ef4444";
      if (sf === "stressed" || st === "stressed") return "#f59e0b";
      return "#22c55e";
    },
    [nodeStates]
  );

  const isDisconnected = useCallback(
    (from: string, to: string) =>
      nodeStates[from] === "failed" || nodeStates[to] === "failed",
    [nodeStates]
  );

  // Active shockwaves
  const shockwaves = useMemo(
    () =>
      CASCADE.filter(
        (e) =>
          e.state === "failed" && simTime >= e.time && simTime < e.time + 2
      ).map((e) => ({ ...NODE_MAP[e.id], id: e.id })),
    [simTime]
  );

  // Stats
  const failedCount = useMemo(
    () => CASCADE.filter((e) => e.state === "failed" && simTime >= e.time).length,
    [simTime]
  );
  const loadShed = Math.round((failedCount / 14) * 23400);
  const popAffected = Math.round((failedCount / 14) * 2400000);
  const cascadeDepth =
    failedCount === 0
      ? 0
      : failedCount <= 1
        ? 1
        : failedCount <= 5
          ? 2
          : failedCount <= 8
            ? 3
            : failedCount <= 9
              ? 4
              : failedCount <= 10
                ? 5
                : 6;
  const simHours =
    simTime >= 12 ? 0 : Math.max(0, Math.round(48 * (1 - simTime / 12)));

  // Overlay text
  const overlayInfo = useMemo(() => {
    if (simTime < 2)
      return { text: "T-48h: Grid Nominal", color: "#22c55e", pulse: false };
    if (simTime < 4)
      return { text: "T-36h: Demand Rising", color: "#f59e0b", pulse: false };
    if (simTime < 7)
      return { text: "T-24h: First Failure", color: "#ef4444", pulse: false };
    if (simTime < 12)
      return { text: "\u26A0 CASCADE IN PROGRESS", color: "#ef4444", pulse: true };
    return {
      text: `CASCADE COMPLETE \u2014 ${failedCount} substations failed`,
      color: "#ef4444",
      pulse: false,
    };
  }, [simTime, failedCount]);

  const handleReset = () => {
    setSimTime(0);
    setIsPlaying(false);
    completeCalled.current = false;
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header + Controls */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-white">
            Cascade Simulation
          </h2>
          <p className="text-sm text-[#a1a1aa] mt-1">
            {region} &middot; 2,000-bus synthetic grid &middot; {scenario}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Speed */}
          <div className="flex items-center gap-1.5">
            {[1, 2, 4].map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`h-9 px-3 rounded-full text-xs font-mono font-semibold transition-colors cursor-pointer ${
                  speed === s
                    ? "bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30"
                    : "bg-[#1a1a1a] text-[#71717a] border border-[#1a1a1a] hover:border-[#3f3f46]"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
          <button
            onClick={handleReset}
            className="h-12 px-4 rounded-lg border border-[#3f3f46] text-sm text-white font-medium hover:border-[#71717a] transition-colors cursor-pointer"
          >
            \u23EE Reset
          </button>
          <button
            onClick={() => {
              if (simTime >= 15) handleReset();
              setIsPlaying(!isPlaying);
            }}
            className="h-12 px-5 rounded-lg bg-[#22c55e] text-white text-sm font-semibold hover:bg-[#16a34a] transition-colors cursor-pointer"
          >
            {isPlaying ? "\u23F8 Pause" : "\u25B6 Play"}
          </button>
        </div>
      </div>

      {/* Canvas + Stats */}
      <div className="flex flex-1 gap-5 min-h-0">
        {/* SVG Canvas */}
        <div className="flex-1 relative bg-[#0a0a0a] rounded-xl border border-[#1a1a1a] overflow-hidden min-h-0">
          {/* Overlay text */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
            <span
              className="text-sm font-mono font-bold px-4 py-2 rounded-full bg-black/70 backdrop-blur-sm border border-white/5"
              style={{
                color: overlayInfo.color,
                animation: overlayInfo.pulse
                  ? "pulse-glow 1s ease-in-out infinite"
                  : undefined,
              }}
            >
              {overlayInfo.text}
            </span>
          </div>

          <svg
            viewBox="0 0 750 570"
            className="w-full h-full"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Edges */}
            {EDGES.map((edge, i) => {
              const from = NODE_MAP[edge.from];
              const to = NODE_MAP[edge.to];
              if (!from || !to) return null;
              const color = getEdgeColor(edge.from, edge.to);
              const disc = isDisconnected(edge.from, edge.to);
              return (
                <line
                  key={i}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={color}
                  strokeWidth={edge.major ? 2.5 : 1.5}
                  strokeDasharray={
                    disc ? "4 4" : color === "#22c55e" ? "4 4" : "none"
                  }
                  strokeOpacity={disc ? 0.25 : color === "#22c55e" ? 0.35 : 0.7}
                  style={
                    !disc && color === "#22c55e"
                      ? { animation: "dash-flow 1s linear infinite" }
                      : undefined
                  }
                />
              );
            })}

            {/* Shockwaves (SMIL) */}
            {shockwaves.map((sw) => (
              <circle
                key={`sw-${sw.id}`}
                cx={sw.x}
                cy={sw.y}
                r={7}
                fill="none"
                stroke="#ef4444"
                strokeWidth={1.5}
              >
                <animate
                  attributeName="r"
                  from="7"
                  to="40"
                  dur="1.5s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  from="0.6"
                  to="0"
                  dur="1.5s"
                  repeatCount="indefinite"
                />
              </circle>
            ))}

            {/* Nodes */}
            {NODES.map((node) => {
              const state = nodeStates[node.id];
              const isFailed = state === "failed";
              return (
                <g key={node.id}>
                  {/* Ambient glow for non-healthy */}
                  {state !== "healthy" && !isFailed && (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={12}
                      fill={STATE_COLORS[state]}
                      opacity={0.12}
                    />
                  )}
                  {/* Failed glow */}
                  {isFailed && (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={12}
                      fill="#ef4444"
                      opacity={0.2}
                    />
                  )}
                  {/* Node circle */}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={7}
                    fill={isFailed ? "#0a0a0a" : STATE_COLORS[state]}
                    stroke={isFailed ? "#ef4444" : "none"}
                    strokeWidth={isFailed ? 2 : 0}
                  />
                  {/* Label */}
                  <text
                    x={node.x}
                    y={node.y + 18}
                    textAnchor="middle"
                    fill="#52525b"
                    fontSize={8}
                    fontFamily="monospace"
                  >
                    {node.id}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Stats sidebar */}
        <div className="w-48 flex-shrink-0 flex flex-col gap-3">
          {[
            {
              label: "Sim Time",
              value: `T-${simHours}h`,
              color: "#ffffff",
            },
            {
              label: "Nodes Failed",
              value: failedCount.toString(),
              color: failedCount > 0 ? "#ef4444" : "#ffffff",
            },
            {
              label: "Load Shed",
              value: `${loadShed.toLocaleString()} MW`,
              color: loadShed > 0 ? "#ef4444" : "#ffffff",
            },
            {
              label: "Pop. Affected",
              value:
                popAffected >= 1_000_000
                  ? `${(popAffected / 1_000_000).toFixed(1)}M`
                  : popAffected.toLocaleString(),
              color: popAffected > 0 ? "#f59e0b" : "#ffffff",
            },
            {
              label: "Cascade Depth",
              value: cascadeDepth.toString(),
              color: "#ffffff",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-[#0a0a0a] rounded-lg p-4 border border-[#1a1a1a]"
            >
              <p className="text-[10px] uppercase tracking-widest text-[#71717a] mb-1.5">
                {stat.label}
              </p>
              <p
                className="text-2xl font-mono font-bold"
                style={{ color: stat.color }}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  PHASE 2 — IMPACT ANALYSIS                                         */
/* ================================================================== */
function buildMetricsFromOutcomes(wo: { total_affected_customers: number; peak_price_mwh: number; blackout_duration_hours: number; cascade_steps: number; failed_nodes: number }, wi: { total_affected_customers: number; peak_price_mwh: number; blackout_duration_hours: number; cascade_steps: number; failed_nodes: number }, customersSaved: number, priceReductionPct: number, cascadeReductionPct: number): ImpactMetric[] {
  const pctDelta = (a: number, b: number) => {
    if (a === 0) return b > 0 ? `+${b}` : "—";
    const pct = Math.round(((a - b) / a) * 100);
    return pct > 0 ? `↓ ${pct}%` : pct < 0 ? `↑ ${Math.abs(pct)}%` : "—";
  };

  return [
    {
      label: "CUSTOMERS AFFECTED",
      without: { value: wo.total_affected_customers, fmt: (n) => n.toLocaleString(), desc: "without early warning" },
      withBo: { value: wi.total_affected_customers, fmt: (n) => n.toLocaleString(), desc: `${customersSaved.toLocaleString()} saved` },
      delta: pctDelta(wo.total_affected_customers, wi.total_affected_customers),
    },
    {
      label: "SUBSTATIONS FAILED",
      without: { value: wo.failed_nodes, fmt: (n) => n.toString(), desc: "cascading failure" },
      withBo: { value: wi.failed_nodes, fmt: (n) => n.toString(), desc: "isolated, cascade prevented" },
      delta: pctDelta(wo.failed_nodes, wi.failed_nodes),
    },
    {
      label: "PEAK PRICE",
      without: { value: wo.peak_price_mwh, fmt: (n) => `$${n.toLocaleString()}/MWh`, desc: "market cap hit" },
      withBo: { value: wi.peak_price_mwh, fmt: (n) => `$${Math.round(n).toLocaleString()}/MWh`, desc: "demand-responsive pricing" },
      delta: `↓ ${Math.round(priceReductionPct)}%`,
    },
    {
      label: "BLACKOUT DURATION",
      without: { value: wo.blackout_duration_hours, fmt: (n) => `${n.toFixed(1)}h`, desc: "total blackout hours" },
      withBo: { value: wi.blackout_duration_hours, fmt: (n) => `${n.toFixed(1)}h`, desc: "reduced via load management" },
      delta: pctDelta(wo.blackout_duration_hours, wi.blackout_duration_hours),
    },
    {
      label: "CASCADE DEPTH",
      without: { value: wo.cascade_steps, fmt: (n) => `${n} steps`, desc: "cascade propagation" },
      withBo: { value: wi.cascade_steps, fmt: (n) => `${n} steps`, desc: "early crew intervention" },
      delta: `↓ ${Math.round(cascadeReductionPct)}%`,
    },
  ];
}

function ImpactAnalysis({
  active,
  region,
  scenario,
  scenarioKey,
  onClose,
}: {
  active: boolean;
  region: string;
  scenario: string;
  scenarioKey?: string;
  onClose: () => void;
}) {
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const [showDelta, setShowDelta] = useState(false);
  const [metrics, setMetrics] = useState<ImpactMetric[]>([]);
  const [loadingOutcomes, setLoadingOutcomes] = useState(false);

  // Fetch outcomes from backend when active
  useEffect(() => {
    if (!active) {
      setShowLeft(false);
      setShowRight(false);
      setShowDelta(false);
      return;
    }

    const key = scenarioKey || "uri";
    setLoadingOutcomes(true);

    fetch(`/api/backend/utility/outcomes?scenario=${key}`)
      .then((r) => r.json())
      .then((res) => {
        const data = res.data;
        if (data?.without_blackout && data?.with_blackout) {
          setMetrics(
            buildMetricsFromOutcomes(
              data.without_blackout,
              data.with_blackout,
              data.customers_saved,
              data.price_reduction_pct,
              data.cascade_reduction_pct,
            )
          );
        }
      })
      .catch((err) => console.error("Failed to fetch outcomes:", err))
      .finally(() => {
        setLoadingOutcomes(false);
        // Stagger reveal animations
        setTimeout(() => setShowLeft(true), 500);
        setTimeout(() => setShowRight(true), 1000);
        setTimeout(() => setShowDelta(true), 1500);
      });
  }, [active, scenarioKey]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
      {/* Header */}
      <div className="mb-6 flex-shrink-0">
        <h2 className="text-2xl font-bold text-white">Impact Analysis</h2>
        <p className="text-sm text-[#a1a1aa] mt-1">
          {scenario} &mdash; {region}
        </p>
      </div>

      {loadingOutcomes ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="w-4 h-4 rounded-full bg-[#22c55e] mx-auto animate-pulse shadow-[0_0_20px_rgba(34,197,94,0.4)]" />
            <p className="text-sm font-mono text-[#52525b]">Computing impact analysis...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Column headers */}
          <div className="flex items-stretch gap-4 mb-6 flex-shrink-0">
            <motion.div
              animate={{ opacity: showLeft ? 1 : 0.3, x: showLeft ? 0 : -20 }}
              transition={{ duration: 0.5 }}
              className="flex-1 border-t-4 border-[#ef4444] rounded-xl p-5 bg-[rgba(239,68,68,0.03)]"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{"\u274C"}</span>
                <span className="text-xl font-bold text-[#ef4444]">
                  WITHOUT BLACKOUT
                </span>
              </div>
            </motion.div>
            <div className="w-[80px] flex-shrink-0" />
            <motion.div
              animate={{ opacity: showRight ? 1 : 0.3, x: showRight ? 0 : 20 }}
              transition={{ duration: 0.5 }}
              className="flex-1 border-t-4 border-[#22c55e] rounded-xl p-5 bg-[rgba(34,197,94,0.03)]"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{"\u2705"}</span>
                <span className="text-xl font-bold text-[#22c55e]">
                  WITH BLACKOUT
                </span>
              </div>
            </motion.div>
          </div>

          {/* Metric rows */}
          <div className="space-y-4 mb-8 flex-shrink-0">
            {metrics.map((m, i) => (
              <MetricRow
                key={m.label}
                metric={m}
                index={i}
                leftActive={showLeft}
                rightActive={showRight}
                deltaActive={showDelta}
              />
            ))}
          </div>
        </>
      )}

      {/* Footer */}
      <div className="flex flex-col items-center gap-3 mt-auto pb-4 flex-shrink-0">
        <motion.button
          whileHover={{ scale: 1.02 }}
          onClick={onClose}
          className="h-[52px] px-10 rounded-xl bg-[#22c55e] text-white text-lg font-semibold hover:bg-[#16a34a] hover:shadow-[0_0_30px_rgba(34,197,94,0.25)] transition-all cursor-pointer"
        >
          Return to Dashboard &rarr;
        </motion.button>
        <p className="text-xs text-[#52525b]">
          Simulation based on ACTIVSg2000 synthetic grid model
        </p>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  PIPELINE STEP STATUS                                               */
/* ================================================================== */
type StepStatus = "pending" | "running" | "completed";

interface PipelineStep {
  label: string;
  status: StepStatus;
  metrics?: { label: string; value: string }[];
}

function PipelineStepRow({ step, index }: { step: PipelineStep; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className={`flex items-center gap-4 px-5 py-4 rounded-xl border transition-colors ${
        step.status === "running"
          ? "bg-[#22c55e]/[0.04] border-[#22c55e]/20"
          : step.status === "completed"
            ? "bg-[#111111] border-[#1a1a1a]"
            : "bg-[#0a0a0a] border-[#1a1a1a]/50"
      }`}
    >
      {/* Status indicator */}
      <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
        {step.status === "pending" && (
          <div className="w-3 h-3 rounded-full bg-[#3f3f46]" />
        )}
        {step.status === "running" && (
          <div
            className="w-5 h-5 rounded-full border-2 border-[#22c55e] border-t-transparent"
            style={{ animation: "spin 1s linear infinite" }}
          />
        )}
        {step.status === "completed" && (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="10" fill="#22c55e" fillOpacity="0.15" />
            <path d="M6 10.5L8.5 13L14 7.5" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {/* Label */}
      <span
        className={`text-sm font-medium flex-1 ${
          step.status === "pending"
            ? "text-[#52525b]"
            : step.status === "running"
              ? "text-white"
              : "text-[#a1a1aa]"
        }`}
      >
        {step.label}
      </span>

      {/* Metrics */}
      {step.status === "completed" && step.metrics && (
        <div className="flex items-center gap-3">
          {step.metrics.map((m) => (
            <span
              key={m.label}
              className="text-xs font-mono text-[#22c55e] bg-[#22c55e]/[0.08] px-2.5 py-1 rounded-md border border-[#22c55e]/15"
            >
              {m.label}: {m.value}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/* ================================================================== */
/*  LIVE PIPELINE                                                      */
/* ================================================================== */
const STATUS_ORDER = ["running", "cascade_done", "prices_done", "alerts_done", "completed"];

function getStepStatus(sessionStatus: string, completesAt: string): StepStatus {
  const currentIdx = STATUS_ORDER.indexOf(sessionStatus);
  const completesIdx = STATUS_ORDER.indexOf(completesAt);
  if (currentIdx < 0) return "pending";
  if (currentIdx >= completesIdx) return "completed";
  if (currentIdx === completesIdx - 1) return "running";
  return "pending";
}

function LivePipeline({
  session,
  onViewAnalysis,
}: {
  session: SimulationSession | null | undefined;
  onViewAnalysis: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  // Elapsed timer
  useEffect(() => {
    if (!session?.created_at) {
      setElapsed(0);
      return;
    }
    const start = new Date(session.created_at).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session?.created_at]);

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-3 h-3 rounded-full bg-[#3f3f46] mx-auto" />
          <p className="text-sm font-mono text-[#52525b]">Waiting for simulation...</p>
          <p className="text-xs text-[#3f3f46]">Click &ldquo;Run Simulation&rdquo; to start the orchestration pipeline</p>
        </div>
      </div>
    );
  }

  const status = session.status;
  const isCompleted = status === "completed";
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  const steps: PipelineStep[] = [
    {
      label: "Demand Analysis",
      status: getStepStatus(status, "cascade_done"),
    },
    {
      label: "Cascade Simulation",
      status: getStepStatus(status, "cascade_done"),
      metrics:
        getStepStatus(status, "cascade_done") === "completed"
          ? [
              { label: "Failed", value: `${session.total_failed_nodes ?? 0} nodes` },
              { label: "Depth", value: `${session.cascade_depth ?? 0}` },
              { label: "Shed", value: `${Math.round(session.total_load_shed_mw ?? 0)} MW` },
            ]
          : undefined,
    },
    {
      label: "Price Forecast",
      status: getStepStatus(status, "prices_done"),
      metrics:
        getStepStatus(status, "prices_done") === "completed"
          ? [
              { label: "Peak", value: `$${Math.round(session.peak_price_mwh ?? 0)}/MWh` },
              { label: "Avg", value: `$${Math.round(session.avg_price_mwh ?? 0)}/MWh` },
            ]
          : undefined,
    },
    {
      label: "Alert Generation",
      status: getStepStatus(status, "alerts_done"),
      metrics:
        getStepStatus(status, "alerts_done") === "completed"
          ? [{ label: "Alerts", value: `${session.alerts_generated ?? 0}` }]
          : undefined,
    },
    {
      label: "Crew Dispatch",
      status: getStepStatus(status, "completed"),
      metrics:
        getStepStatus(status, "completed") === "completed"
          ? [
              { label: "Crews", value: `${session.crews_dispatched ?? 0}` },
              { label: "Avg ETA", value: `${Math.round(session.avg_eta_minutes ?? 0)} min` },
            ]
          : undefined,
    },
  ];

  const completedCount = steps.filter((s) => s.status === "completed").length;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="mb-6 flex-shrink-0">
        <h2 className="text-2xl font-bold text-white">Live Pipeline</h2>
        <p className="text-sm text-[#a1a1aa] mt-1">
          Real-time orchestration progress &middot; {session.scenario} &middot; {session.grid_region}
        </p>
      </div>

      {/* Elapsed + Progress */}
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-widest text-[#52525b]">Elapsed</span>
          <span className="text-lg font-mono font-bold text-white">
            {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-widest text-[#52525b]">Progress</span>
          <span className="text-lg font-mono font-bold text-white">{completedCount}/5</span>
          <div className="w-32 h-2 rounded-full bg-[#1a1a1a] overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-[#22c55e]"
              initial={{ width: 0 }}
              animate={{ width: `${(completedCount / 5) * 100}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-3 flex-1">
        {steps.map((step, i) => (
          <PipelineStepRow key={step.label} step={step} index={i} />
        ))}
      </div>

      {/* Completion card */}
      {isCompleted && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mt-6 flex-shrink-0 bg-[#22c55e]/[0.04] border border-[#22c55e]/20 rounded-xl p-6 flex items-center justify-between"
        >
          <div>
            <p className="text-sm font-semibold text-[#22c55e]">Pipeline Complete</p>
            <p className="text-xs text-[#a1a1aa] mt-1">
              {session.total_failed_nodes ?? 0} nodes failed &middot; {session.crews_dispatched ?? 0} crews dispatched &middot; {session.alerts_generated ?? 0} alerts sent
            </p>
          </div>
          <button
            onClick={onViewAnalysis}
            className="h-11 px-5 rounded-lg bg-[#22c55e] text-white text-sm font-semibold hover:bg-[#16a34a] transition-colors cursor-pointer"
          >
            View Impact Analysis &rarr;
          </button>
        </motion.div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  MAIN OVERLAY                                                       */
/* ================================================================== */
export default function CascadeOverlay({
  isOpen,
  onClose,
  region = "ERCOT",
  scenario = "Winter Storm Uri",
  scenarioKey,
  session,
}: CascadeOverlayProps) {
  const [activeTab, setActiveTab] = useState<"simulation" | "pipeline" | "analysis">(
    "simulation"
  );

  // Reset tab when overlay opens
  useEffect(() => {
    if (isOpen) setActiveTab("simulation");
  }, [isOpen]);

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // SVG cascade complete → transition to pipeline tab
  const handleSimComplete = useCallback(() => {
    setActiveTab("pipeline");
  }, []);

  // Pipeline complete → auto-transition to analysis after delay
  const pipelineAutoTransitioned = useRef(false);
  useEffect(() => {
    if (activeTab !== "pipeline") {
      pipelineAutoTransitioned.current = false;
      return;
    }
    if (session?.status === "completed" && !pipelineAutoTransitioned.current) {
      pipelineAutoTransitioned.current = true;
      const t = setTimeout(() => setActiveTab("analysis"), 5000);
      return () => clearTimeout(t);
    }
  }, [activeTab, session?.status]);

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: "simulation", label: "Cascade Simulation" },
    { key: "pipeline", label: "Live Pipeline" },
    { key: "analysis", label: "Impact Analysis" },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.40)", backdropFilter: "blur(12px)" }}
          onClick={onClose}
        >
          {/* Modal panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-6xl mx-auto h-[90vh] flex flex-col p-8 overflow-hidden"
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-6 right-6 z-20 w-12 h-12 rounded-lg flex items-center justify-center text-[#71717a] hover:text-white hover:bg-[#1a1a1a] transition-colors cursor-pointer text-xl"
            >
              {"\u2715"}
            </button>

            {/* Tabs */}
            <div className="flex items-center gap-3 mb-6 flex-shrink-0">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`h-12 w-[200px] rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                    activeTab === tab.key
                      ? "border-2 border-[#22c55e] text-[#22c55e] bg-[#22c55e]/10"
                      : "border border-[#3f3f46] text-[#a1a1aa] hover:border-[#71717a]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content */}
            {activeTab === "simulation" && (
              <CascadeSimulation
                onComplete={handleSimComplete}
                region={region}
                scenario={scenario}
              />
            )}
            {activeTab === "pipeline" && (
              <LivePipeline
                session={session}
                onViewAnalysis={() => setActiveTab("analysis")}
              />
            )}
            {activeTab === "analysis" && (
              <ImpactAnalysis
                active
                region={region}
                scenario={scenario}
                scenarioKey={scenarioKey}
                onClose={onClose}
              />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
