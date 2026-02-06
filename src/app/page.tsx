"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import {
  SiNvidia,
  SiPython,
  SiFastapi,
  SiScikitlearn,
  SiSupabase,
  SiClaude,
  SiAmazonwebservices,
  SiReact,
  SiTypescript,
  SiTailwindcss,
  SiMapbox,
  SiXstate,
} from "react-icons/si";
import { TbBrandNetbeans } from "react-icons/tb";
import { FaChartBar } from "react-icons/fa";
import { useEffect, useState, useRef } from "react";
import type { IconType } from "react-icons";

const ParticleGlobe = dynamic(() => import("@/components/ParticleGlobe"), {
  ssr: false,
  loading: () => null,
});

/* ------------------------------------------------------------------ */
/*  Simple letter icon for brands with no react-icon                  */
/* ------------------------------------------------------------------ */
function LetterIcon({ letter, size = 28 }: { letter: string; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center font-mono font-bold"
      style={{ fontSize: size * 0.6, width: size, height: size }}
    >
      {letter}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Tech items for the marquee bars                                   */
/* ------------------------------------------------------------------ */
type TechItem = {
  name: string;
  icon?: IconType;
  letter?: string;
  logo?: string;
};

const leftTech: TechItem[] = [
  { name: "NVIDIA", icon: SiNvidia },
  { name: "Python", icon: SiPython },
  { name: "FastAPI", icon: SiFastapi },
  { name: "NetworkX", icon: TbBrandNetbeans },
  { name: "scikit", icon: SiScikitlearn },
  { name: "Supabase", icon: SiSupabase },
  { name: "Claude", icon: SiClaude },
  { name: "AWS", icon: SiAmazonwebservices },
];

const rightTech: TechItem[] = [
  { name: "React", icon: SiReact },
  { name: "TypeScript", icon: SiTypescript },
  { name: "Tailwind", icon: SiTailwindcss },
  { name: "Mapbox", icon: SiMapbox },
  { name: "Recharts", icon: FaChartBar },
  { name: "XGBoost", icon: SiXstate },
  { name: "CodeRabbit", logo: "/coderabbit.svg" },
  { name: "Dedalus", logo: "/dedalus.svg" },
];

/* ------------------------------------------------------------------ */
/*  Vertical Marquee                                                  */
/* ------------------------------------------------------------------ */
function VerticalMarquee({
  items,
  direction,
}: {
  items: TechItem[];
  direction: "up" | "down";
}) {
  const duped = [...items, ...items, ...items, ...items];

  return (
    <div className="relative h-full overflow-hidden w-16 flex-shrink-0">
      <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-[#0a0a0a] to-transparent z-10 pointer-events-none" />
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#0a0a0a] to-transparent z-10 pointer-events-none" />

      <div
        className="flex flex-col items-center gap-12 py-6"
        style={{
          animation: `${direction === "up" ? "marquee-up" : "marquee-down"} 30s linear infinite`,
        }}
      >
        {duped.map((item, i) => {
          const Icon = item.icon;
          return (
            <div
              key={`${item.name}-${i}`}
              className="group flex flex-col items-center justify-center gap-2 cursor-default w-16"
            >
              {Icon ? (
                <Icon
                  size={28}
                  className="text-[#555] transition-all duration-300 group-hover:text-[#22c55e] group-hover:drop-shadow-[0_0_8px_rgba(34,197,94,0.5)]"
                />
              ) : item.logo ? (
                <img
                  src={item.logo}
                  alt={item.name}
                  width={28}
                  height={28}
                  className="rounded-sm opacity-50 transition-all duration-300 group-hover:opacity-90 group-hover:drop-shadow-[0_0_8px_rgba(34,197,94,0.5)]"
                />
              ) : (
                <LetterIcon letter={item.letter || "?"} size={28} />
              )}
              <span className="text-[8px] font-mono uppercase tracking-wider text-[#444] transition-colors duration-300 group-hover:text-[#22c55e]/70 text-center whitespace-nowrap">
                {item.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Terminal Feed — lines appear one by one like a real terminal       */
/* ------------------------------------------------------------------ */
function TerminalFeed({
  lines,
  delay = 1200,
  initialDelay = 1500,
}: {
  lines: { time: string; msg: string; type: string }[];
  delay?: number;
  initialDelay?: number;
}) {
  const [visibleCount, setVisibleCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const startTimeout = setTimeout(() => {
      const interval = setInterval(() => {
        setVisibleCount((c) => {
          if (c >= lines.length) {
            clearInterval(interval);
            return c;
          }
          return c + 1;
        });
      }, delay);
      return () => clearInterval(interval);
    }, initialDelay);
    return () => clearTimeout(startTimeout);
  }, [lines.length, delay, initialDelay]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleCount]);

  return (
    <div className="flex-1 overflow-hidden relative" style={{ minHeight: 0 }}>
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-hidden"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <div className="space-y-1 flex flex-col justify-end" style={{ minHeight: "100%" }}>
          {lines.slice(0, visibleCount).map((line, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              className="text-[8px] font-mono leading-relaxed flex-shrink-0"
            >
              <span className="text-[#22c55e]/25">{line.time}</span>{" "}
              <span
                className={
                  line.type === "warn"
                    ? "text-amber-400/50"
                    : line.type === "err"
                    ? "text-red-400/50"
                    : line.type === "save"
                    ? "text-[#22c55e]/60"
                    : "text-[#22c55e]/40"
                }
              >
                {line.msg}
              </span>
            </motion.div>
          ))}
          {/* Blinking cursor */}
          {visibleCount < lines.length && (
            <span
              className="inline-block w-1.5 h-3 bg-[#22c55e]/60 ml-0.5 flex-shrink-0"
              style={{ animation: "pulse-dot 1s step-end infinite" }}
            />
          )}
        </div>
      </div>
      <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-black/40 to-transparent pointer-events-none z-10" />
      <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-black/40 to-transparent pointer-events-none z-10" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Operator View Panel (Left)                                        */
/* ------------------------------------------------------------------ */
const eventLog = [
  "14:02:31 — Node 7 load balanced to TX-S-12",
  "14:02:28 — Weather alert: ice storm ETA 36hr",
  "14:02:14 — Reroute path validated ✓",
  "14:01:58 — Demand response signal sent",
  "14:01:42 — Battery reserve at 94% capacity",
  "14:01:31 — Node 3 frequency nominal 60.02Hz",
  "14:01:12 — Grid sync check passed ✓",
  "14:00:55 — Transformer T-19 temp normal",
  "14:00:41 — Solar farm output +12% forecast",
  "14:00:22 — EV fleet charge schedule optimized",
];

const operatorFeed = [
  { time: "14:05:12", msg: "ERCOT freq check: 60.00 Hz nominal", type: "ok" },
  { time: "14:05:01", msg: "Substation S-09 switching complete ✓", type: "ok" },
  { time: "14:04:48", msg: "Wind turbine W-14 yaw adjusted", type: "ok" },
  { time: "14:04:33", msg: "Capacitor bank C-3 engaged", type: "ok" },
  { time: "14:04:19", msg: "Load shed tier 1 on standby", type: "warn" },
  { time: "14:04:02", msg: "Transmission line TL-7 nominal ✓", type: "ok" },
  { time: "14:03:51", msg: "Distributed gen: 1.2 GW online", type: "ok" },
  { time: "14:03:44", msg: "Reserve margin at 14.2% — adequate", type: "ok" },
  { time: "14:03:31", msg: "Ice accretion sensor alert — line 19", type: "warn" },
  { time: "14:03:18", msg: "Voltage regulator VR-5 tap changed", type: "ok" },
  { time: "14:03:02", msg: "Load balancer sync TX-AUSTIN-3 ✓", type: "ok" },
  { time: "14:02:58", msg: "ERCOT signal: demand response active", type: "ok" },
  { time: "14:02:45", msg: "Transformer T-22 temp rising +3°F", type: "warn" },
  { time: "14:02:31", msg: "Node 7 load balanced to TX-S-12", type: "ok" },
  { time: "14:02:28", msg: "Weather alert: ice storm ETA 36hr", type: "warn" },
  { time: "14:02:14", msg: "Reroute path validated ✓", type: "ok" },
  { time: "14:01:58", msg: "Demand response signal sent", type: "ok" },
  { time: "14:01:42", msg: "Battery reserve at 94% capacity", type: "ok" },
  { time: "14:01:31", msg: "Node 3 frequency drift detected", type: "warn" },
  { time: "14:01:12", msg: "Grid sync check passed ✓", type: "ok" },
  { time: "14:00:55", msg: "Solar farm output +12% forecast", type: "ok" },
  { time: "14:00:41", msg: "Node 6 offline — maintenance", type: "err" },
  { time: "14:00:22", msg: "EV fleet charge schedule optimized", type: "ok" },
  { time: "14:00:08", msg: "Peak demand window T-3hr", type: "warn" },
  { time: "13:59:51", msg: "Substation S-14 capacity nominal", type: "ok" },
  { time: "13:59:33", msg: "Wind farm output dropping −8%", type: "warn" },
  { time: "13:59:14", msg: "Breaker B-11 reclosed successfully", type: "ok" },
  { time: "13:58:58", msg: "Thermal limit warning — line TL-3", type: "warn" },
  { time: "13:58:41", msg: "AGC setpoint updated: +45 MW", type: "ok" },
  { time: "13:58:22", msg: "Phase angle diff OK: 0.3°", type: "ok" },
  { time: "13:58:05", msg: "Contingency analysis complete ✓", type: "ok" },
  { time: "13:57:48", msg: "Solar ramp rate: +220 MW/hr", type: "ok" },
  { time: "13:57:31", msg: "SCADA poll cycle 4.2s — normal", type: "ok" },
  { time: "13:57:15", msg: "Ambient temp Austin: 28°F falling", type: "warn" },
  { time: "13:56:58", msg: "Generator G-09 ramping to 340 MW", type: "ok" },
  { time: "13:56:42", msg: "Tie-line flow N-S: 1,205 MW", type: "ok" },
  { time: "13:56:28", msg: "Reactive power balanced ✓", type: "ok" },
  { time: "13:56:11", msg: "Battery storage SOC: 87%", type: "ok" },
  { time: "13:55:54", msg: "Ice storm upgraded — SEV 4 imminent", type: "err" },
  { time: "13:55:38", msg: "Emergency reserves pre-staged", type: "ok" },
];

const citizenFeed = [
  { time: "2:07p", msg: "Blinds auto-closed — sun angle", type: "ok" },
  { time: "2:06p", msg: "Saved $0.18 — HVAC optimization", type: "save" },
  { time: "2:05p", msg: "Pool pump deferred to off-peak", type: "save" },
  { time: "2:04p", msg: "Indoor humidity: 42% — optimal", type: "ok" },
  { time: "2:03p", msg: "Thermostat adjusted to 71°F", type: "ok" },
  { time: "2:01p", msg: "Solar panels generating 4.2 kW", type: "save" },
  { time: "1:58p", msg: "Ice storm alert — pre-cool started", type: "warn" },
  { time: "1:55p", msg: "Dishwasher delayed — peak rate", type: "save" },
  { time: "1:52p", msg: "EV range sufficient: 186 mi", type: "ok" },
  { time: "1:49p", msg: "Ceiling fans auto-on — zone 2", type: "ok" },
  { time: "1:45p", msg: "EV charge scheduled for 2:00 AM", type: "ok" },
  { time: "1:40p", msg: "Saved $0.31 — load shifted", type: "save" },
  { time: "1:36p", msg: "Surge protector: all clear", type: "ok" },
  { time: "1:32p", msg: "Saved $0.42 — off-peak shift", type: "save" },
  { time: "1:28p", msg: "Generator test: PASS", type: "ok" },
  { time: "1:24p", msg: "Garage door sensor: closed ✓", type: "ok" },
  { time: "1:20p", msg: "Battery backup at 78%", type: "ok" },
  { time: "1:15p", msg: "Grid stress detected — reducing load", type: "warn" },
  { time: "1:10p", msg: "Water heater shifted to solar", type: "save" },
  { time: "1:05p", msg: "Smart plug #3 off — standby draw", type: "save" },
  { time: "1:02p", msg: "Smart dryer paused — peak pricing", type: "save" },
  { time: "12:55p", msg: "Air filter status: good (89%)", type: "ok" },
  { time: "12:48p", msg: "Solar export: 1.8 kWh to grid", type: "save" },
  { time: "12:42p", msg: "Lighting auto-dimmed — daylight", type: "save" },
  { time: "12:36p", msg: "Fridge compressor cycle normal", type: "ok" },
  { time: "12:30p", msg: "Water heater pre-heated ✓", type: "ok" },
  { time: "12:24p", msg: "Saved $0.55 — morning optimization", type: "save" },
  { time: "12:18p", msg: "Smart lock: all doors secured", type: "ok" },
  { time: "12:15p", msg: "Monthly savings on track: $14.20", type: "save" },
  { time: "12:08p", msg: "Sprinkler deferred — rain forecast", type: "save" },
  { time: "12:01p", msg: "Outage risk: LOW for next 24hr", type: "ok" },
  { time: "11:54a", msg: "CO detector: all clear ✓", type: "ok" },
  { time: "11:45a", msg: "Neighbor avg usage: 48 kWh/day", type: "ok" },
  { time: "11:38a", msg: "Solar production peaked: 5.1 kW", type: "save" },
  { time: "11:30a", msg: "Battery charged from solar ✓", type: "save" },
  { time: "11:22a", msg: "HVAC filter reminder in 12 days", type: "ok" },
  { time: "11:15a", msg: "Energy score today: A+", type: "save" },
  { time: "11:08a", msg: "Hot water ready — solar heated", type: "save" },
  { time: "11:00a", msg: "Morning report: $1.23 saved so far", type: "save" },
  { time: "10:52a", msg: "All systems nominal ✓", type: "ok" },
];

const gridNodes = [
  { id: "N-01", status: "online" },
  { id: "N-02", status: "online" },
  { id: "N-03", status: "online" },
  { id: "N-04", status: "warn" },
  { id: "N-05", status: "online" },
  { id: "N-06", status: "offline" },
];

function OperatorPanel() {
  const loadData = [32, 45, 38, 52, 61, 78, 72, 85, 91, 80, 68, 55, 48, 63, 77, 88];

  return (
    <div
      className="w-[290px] flex-shrink-0 pointer-events-auto self-center"
      style={{ height: "75vh", animation: "float-left 6s ease-in-out infinite" }}
    >
      <div className="relative bg-black/40 backdrop-blur-md border border-[#22c55e]/20 rounded-lg overflow-hidden transition-all duration-500 hover:border-[#22c55e]/40 hover:shadow-[0_0_30px_rgba(34,197,94,0.08)] h-full flex flex-col">
        {/* Scanline overlay */}
        <div
          className="absolute inset-0 pointer-events-none z-20"
          style={{
            backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(34,197,94,0.015) 2px, rgba(34,197,94,0.015) 4px)",
          }}
        />
        {/* Moving scanline */}
        <div
          className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#22c55e]/30 to-transparent pointer-events-none z-20"
          style={{ animation: "scanline 4s linear infinite" }}
        />

        {/* Terminal header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] flex-shrink-0">
          <div className="flex gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#ff5f57]" />
            <span className="w-2 h-2 rounded-full bg-[#febc2e]" />
            <span className="w-2 h-2 rounded-full bg-[#28c840]" />
          </div>
          <span className="text-[10px] font-mono text-white/30 ml-1">grid-ops-live</span>
          <div className="ml-auto flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full bg-[#22c55e]"
              style={{ animation: "pulse-dot 2s ease-in-out infinite" }}
            />
            <span className="text-[9px] font-mono text-[#22c55e]/60">LIVE</span>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="p-3 space-y-3 flex-1 flex flex-col" style={{ animation: "flicker 8s ease-in-out infinite" }}>

            {/* Grid load chart */}
            <div className="flex-shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">Grid Load — 6hr</span>
                <span className="text-[9px] font-mono text-[#22c55e]/50">MW</span>
              </div>
              <div className="flex items-end gap-[2px] h-14">
                {loadData.map((val, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm origin-bottom"
                    style={{
                      height: `${(val / 100) * 100}%`,
                      background:
                        val > 75
                          ? "rgba(34, 197, 94, 0.6)"
                          : "rgba(34, 197, 94, 0.25)",
                      animation: `bar-grow 0.6s ease-out ${i * 0.05}s both`,
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="h-px bg-[#22c55e]/10 flex-shrink-0" />

            {/* Status rows */}
            <div className="space-y-2 flex-shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-white/25">Region</span>
                <span className="text-[10px] font-mono text-white/60">
                  TX-AUSTIN-3 <span className="text-[#22c55e]">✓</span>{" "}
                  <span className="text-white/30">stable</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-white/25">Predicted surge</span>
                <span className="text-[10px] font-mono text-amber-400/70">+22% @ 15:00</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-white/25">Reroute confidence</span>
                <span className="text-[10px] font-mono text-[#22c55e]/80">94.2%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-white/25">Grid frequency</span>
                <span className="text-[10px] font-mono text-[#22c55e]/80">60.02 Hz</span>
              </div>
            </div>

            <div className="h-px bg-[#22c55e]/10 flex-shrink-0" />

            {/* Node topology */}
            <div className="flex-shrink-0">
              <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">Node Status</span>
              <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 mt-2">
                {gridNodes.map((node) => (
                  <div key={node.id} className="flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        node.status === "online"
                          ? "bg-[#22c55e]"
                          : node.status === "warn"
                          ? "bg-amber-400"
                          : "bg-red-400/60"
                      }`}
                      style={
                        node.status === "online"
                          ? { animation: "pulse-dot 3s ease-in-out infinite" }
                          : node.status === "warn"
                          ? { animation: "pulse-dot 1s ease-in-out infinite" }
                          : {}
                      }
                    />
                    <span className="text-[9px] font-mono text-white/40">{node.id}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="h-px bg-[#22c55e]/10 flex-shrink-0" />

            {/* Threat assessment */}
            <div className="flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">Active Weather Events</span>
                <span className="text-[10px] font-mono text-amber-400/80 font-semibold">2</span>
              </div>
              <div className="space-y-1.5">
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[9px] font-mono text-white/40">Ice storm — Austin metro</span>
                    <span className="text-[9px] font-mono text-amber-400/60">SEV 3</span>
                  </div>
                  <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
                    <div className="h-full rounded-full bg-amber-400/50" style={{ width: "60%" }} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[9px] font-mono text-white/40">Extreme heat — TX south</span>
                    <span className="text-[9px] font-mono text-red-400/60">SEV 4</span>
                  </div>
                  <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
                    <div className="h-full rounded-full bg-red-400/50" style={{ width: "80%" }} />
                  </div>
                </div>
              </div>
            </div>

            <div className="h-px bg-[#22c55e]/10 flex-shrink-0" />

            {/* Terminal feed */}
            <TerminalFeed lines={operatorFeed} delay={1000} initialDelay={1200} />

            <div className="h-px bg-[#22c55e]/10 flex-shrink-0" />

            {/* Action line */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[9px] font-mono text-white/20 uppercase">Action</span>
              <span
                className="text-[10px] font-mono font-semibold text-[#22c55e] tracking-wide"
                style={{ animation: "pulse-glow 2s ease-in-out infinite" }}
              >
                PRE-POSITION RESERVES
              </span>
            </div>

            {/* Enter button */}
            <button
              className="w-full font-mono rounded-md border border-[#22c55e]/30 text-[#22c55e]/70 bg-[#22c55e]/[0.04] hover:bg-[#22c55e]/[0.12] hover:border-[#22c55e]/60 hover:text-[#22c55e] transition-all duration-300 cursor-pointer flex-shrink-0"
              style={{ padding: "14px 0", fontSize: "13px" }}
            >
              Enter Operator View →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Citizen View Panel (Right)                                        */
/* ------------------------------------------------------------------ */
const smartDevices = [
  { name: "Thermostat", status: "active", detail: "72°F" },
  { name: "EV Charger", status: "scheduled", detail: "2:00 AM" },
  { name: "Battery", status: "active", detail: "78%" },
  { name: "Solar Inv.", status: "active", detail: "4.2 kW" },
];

function CitizenPanel() {
  const weekData = [45, 62, 38, 71, 55, 48, 60];
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  const readinessScore = 94;

  return (
    <div
      className="w-[290px] flex-shrink-0 pointer-events-auto self-center"
      style={{ height: "75vh", animation: "float-right 6s ease-in-out infinite" }}
    >
      <div className="relative bg-black/40 backdrop-blur-md border border-[#22c55e]/20 rounded-lg overflow-hidden transition-all duration-500 hover:border-[#22c55e]/40 hover:shadow-[0_0_30px_rgba(34,197,94,0.08)] h-full flex flex-col">
        {/* Scanline overlay */}
        <div
          className="absolute inset-0 pointer-events-none z-20"
          style={{
            backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(34,197,94,0.015) 2px, rgba(34,197,94,0.015) 4px)",
          }}
        />
        {/* Moving scanline */}
        <div
          className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#22c55e]/30 to-transparent pointer-events-none z-20"
          style={{ animation: "scanline 5s linear infinite" }}
        />

        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] flex-shrink-0">
          <span className="text-[11px] font-mono text-white/50">your home</span>
          <span className="text-[10px] font-mono text-white/20">·</span>
          <span className="text-[10px] font-mono text-white/30">78701</span>
          <div className="ml-auto flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full bg-[#22c55e]"
              style={{ animation: "pulse-dot 2s ease-in-out infinite" }}
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="p-3 space-y-3 flex-1 flex flex-col">

            {/* Readiness score */}
            <div className="flex items-center gap-4 flex-shrink-0">
              <div className="relative w-16 h-16 flex-shrink-0">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="3" />
                  <circle
                    cx="32" cy="32" r="28" fill="none"
                    stroke="rgba(34,197,94,0.5)" strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={`${(readinessScore / 100) * 175.9} 175.9`}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[16px] font-mono font-bold text-[#22c55e]">{readinessScore}</span>
                </div>
              </div>
              <div>
                <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest block">Home Readiness</span>
                <span className="text-[11px] font-mono text-white/50 block mt-0.5">Score out of 100</span>
              </div>
            </div>

            <div className="h-px bg-[#22c55e]/10 flex-shrink-0" />

            {/* Status */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[10px] font-mono text-white/25">Status</span>
              <span className="text-[11px] font-mono font-semibold text-[#22c55e] tracking-wide">
                PROTECTED
              </span>
              <span
                className="w-1.5 h-1.5 rounded-full bg-[#22c55e] ml-0.5"
                style={{ animation: "pulse-dot 1.5s ease-in-out infinite" }}
              />
            </div>

            <div className="h-px bg-[#22c55e]/10 flex-shrink-0" />

            {/* Info rows */}
            <div className="space-y-2 flex-shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-white/25">Next risk window</span>
                <span className="text-[10px] font-mono text-amber-400/70">Tue 2/10 — ice storm</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-white/25">Smart actions</span>
                <span className="text-[10px] font-mono text-white/60">3 scheduled</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-white/25">Est. savings</span>
                <span className="text-[10px] font-mono text-[#22c55e]/80">$14.20 this month</span>
              </div>
            </div>

            <div className="h-px bg-[#22c55e]/10 flex-shrink-0" />

            {/* 7 day usage chart — taller */}
            <div className="flex-shrink-0">
              <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">7-Day Usage · kWh</span>
              <div className="flex gap-2 mt-2">
                {weekData.map((val, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[7px] font-mono text-white/20">{val}</span>
                    <div className="w-full h-16 flex items-end">
                      <div
                        className="w-full rounded-sm"
                        style={{
                          height: `${(val / 100) * 100}%`,
                          background: "rgba(34, 197, 94, 0.4)",
                          minHeight: "2px",
                        }}
                      />
                    </div>
                    <span className="text-[8px] font-mono text-white/25">{days[i]}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="h-px bg-[#22c55e]/10 flex-shrink-0" />

            {/* Smart device status */}
            <div className="flex-shrink-0">
              <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">Smart Devices</span>
              <div className="space-y-1.5 mt-2">
                {smartDevices.map((device) => (
                  <div key={device.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          device.status === "active" ? "bg-[#22c55e]" : "bg-amber-400"
                        }`}
                        style={{ animation: "pulse-dot 3s ease-in-out infinite" }}
                      />
                      <span className="text-[10px] font-mono text-white/40">{device.name}</span>
                    </div>
                    <span className="text-[10px] font-mono text-white/60">{device.detail}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="h-px bg-[#22c55e]/10 flex-shrink-0" />

            {/* Notification */}
            <div className="flex-shrink-0 bg-[#22c55e]/[0.04] rounded px-2.5 py-2 border border-[#22c55e]/10">
              <span className="text-[9px] font-mono text-[#22c55e]/70 leading-relaxed">
                ⚡ Pre-cooling activated for Tuesday ice storm. Est. savings: $3.40
              </span>
            </div>

            <div className="h-px bg-[#22c55e]/10 flex-shrink-0" />

            {/* Terminal feed */}
            <TerminalFeed lines={citizenFeed} delay={1400} initialDelay={2000} />

            {/* Enter button */}
            <button
              className="w-full font-mono rounded-md border border-[#22c55e]/30 text-[#22c55e]/70 bg-[#22c55e]/[0.04] hover:bg-[#22c55e]/[0.12] hover:border-[#22c55e]/60 hover:text-[#22c55e] transition-all duration-300 cursor-pointer flex-shrink-0"
              style={{ padding: "14px 0", fontSize: "13px" }}
            >
              Enter Citizen View →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Animated stat counter                                             */
/* ------------------------------------------------------------------ */
function AnimatedStat({
  label,
  value,
  suffix = "",
  prefix = "",
}: {
  label: string;
  value: number;
  suffix?: string;
  prefix?: string;
}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let frame: number;
    const duration = 2000;
    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * value));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <div className="flex items-center gap-3">
      <span
        className="w-1.5 h-1.5 rounded-full bg-[#22c55e]"
        style={{ animation: "pulse-dot 2s ease-in-out infinite" }}
      />
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-sm text-white/90 tabular-nums">
          {prefix}
          {count.toLocaleString()}
          {suffix}
        </span>
        <span className="text-[11px] text-white/30 uppercase tracking-wider">
          {label}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                         */
/* ------------------------------------------------------------------ */
export default function Home() {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0a0a0a]">
      {/* ---- Globe: full-screen background layer ---- */}
      <div className="absolute inset-0 z-0">
        <ParticleGlobe />
      </div>

      {/* ---- UI overlay ---- */}
      <div className="relative z-10 h-full flex flex-col pointer-events-none">
        {/* ---- Top Nav ---- */}
        <motion.nav
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="flex items-center justify-between h-14 border-b border-white/[0.06] flex-shrink-0 pointer-events-auto"
          style={{ paddingLeft: '6rem', paddingRight: '6rem' }}
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
            <span className="text-[15px] font-semibold tracking-tight text-white">
              blackout
            </span>
          </div>
          <div className="flex items-center gap-8">
            {[
              { label: "How it Works", href: "#" },
              { label: "GitHub", href: "https://github.com/nimaibhat/blackout" },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                target={item.href.startsWith("http") ? "_blank" : undefined}
                rel={item.href.startsWith("http") ? "noopener noreferrer" : undefined}
                className="text-[13px] text-white/40 hover:text-[#22c55e] transition-colors duration-200 font-mono"
              >
                {item.label}
              </a>
            ))}
          </div>
        </motion.nav>

        {/* ---- Main content area ---- */}
        <div className="flex-1 flex min-h-0">
          {/* Left marquee bar */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="border-r border-white/[0.06] pointer-events-auto"
          >
            <VerticalMarquee items={leftTech} direction="up" />
          </motion.div>

          {/* Left — Operator View */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="flex items-center pointer-events-auto flex-shrink-0"
            style={{ marginLeft: '3rem' }}
          >
            <OperatorPanel />
          </motion.div>

          {/* Center — globe shows through + tagline */}
          <div className="flex-1 flex flex-col items-center justify-end min-h-0 relative" style={{ paddingBottom: '3rem' }}>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.6 }}
              className="pointer-events-auto"
            >
              <h1 className="text-[22px] font-light tracking-tight text-white/80">
                Predict the grid.{" "}
                <span className="text-[#22c55e]">Protect the people.</span>
              </h1>
              <p className="text-[12px] font-mono text-white/25 tracking-wide text-center mt-2">
                made with <span className="text-red-400/70">&#9829;</span> for TartanHacks 2026
              </p>
            </motion.div>
          </div>

          {/* Right — Citizen View */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="flex items-center pointer-events-auto flex-shrink-0"
            style={{ marginRight: '3rem' }}
          >
            <CitizenPanel />
          </motion.div>

          {/* Right marquee bar */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="border-l border-white/[0.06] pointer-events-auto"
          >
            <VerticalMarquee items={rightTech} direction="down" />
          </motion.div>
        </div>

        {/* ---- Bottom stats bar ---- */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.9 }}
          className="flex items-center justify-center gap-12 h-12 border-t border-white/[0.06] flex-shrink-0 px-16 pointer-events-auto backdrop-blur-sm"
        >
          <AnimatedStat
            value={2400000}
            label="outage-hours prevented"
          />
          <div className="w-px h-4 bg-white/[0.08]" />
          <AnimatedStat value={15} suffix=" day" label="forecast window" />
          <div className="w-px h-4 bg-white/[0.08]" />
          <AnimatedStat value={127} prefix="$" label="avg saved per household" />
        </motion.div>
      </div>
    </main>
  );
}
