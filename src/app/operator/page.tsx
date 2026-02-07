"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import OperatorGlobe from "@/components/OperatorGlobe";
import OperatorRightSidebar from "@/components/OperatorRightSidebar";
import CascadeOverlay from "@/components/CascadeOverlay";

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */
interface FocusedLocation {
  lat: number;
  lng: number;
  altitude: number;
}

interface ThreatData {
  id: string;
  icon: string;
  name: string;
  severity: number;
  region: string;
  lat: number;
  lng: number;
}

type GridStatus = "NOMINAL" | "STRESSED" | "CRITICAL" | "CASCADE";

interface RegionSegment {
  name: string;
  status: "nominal" | "stressed" | "critical";
  width: string;
}

interface TickerItem {
  text: string;
  color: string;
}

/* ================================================================== */
/*  MOCK DATA                                                          */
/* ================================================================== */
const THREATS: ThreatData[] = [
  {
    id: "t1",
    icon: "🔴",
    name: "Ice Storm — Austin Metro",
    severity: 3,
    region: "ERCOT",
    lat: 30.27,
    lng: -97.74,
  },
  {
    id: "t2",
    icon: "🔴",
    name: "Extreme Heat — TX South",
    severity: 4,
    region: "ERCOT",
    lat: 27.8,
    lng: -97.4,
  },
  {
    id: "t3",
    icon: "🟡",
    name: "Cold Snap — Northeast",
    severity: 2,
    region: "PJM-NYISO",
    lat: 40.71,
    lng: -74.01,
  },
];

const REGION_SEGMENTS: RegionSegment[] = [
  { name: "ERCOT", status: "critical", width: "30%" },
  { name: "WECC", status: "nominal", width: "25%" },
  { name: "PJM", status: "stressed", width: "25%" },
  { name: "NYISO", status: "nominal", width: "20%" },
];

const TICKER_ITEMS: TickerItem[] = [
  { text: "2,400,000 outage-hours prevented", color: "text-[#22c55e]" },
  { text: "47 crews pre-positioned", color: "text-[#22c55e]" },
  { text: "73% cascade probability — ERCOT", color: "text-[#ef4444]" },
  { text: "Grid frequency: 60.02 Hz", color: "text-[#22c55e]" },
  { text: "Next risk window: 36h 14m", color: "text-[#f59e0b]" },
];

const SEGMENT_COLORS: Record<RegionSegment["status"], string> = {
  nominal: "bg-[#22c55e]",
  stressed: "bg-[#f59e0b]",
  critical: "bg-[#ef4444]",
};

const STATUS_STYLE: Record<GridStatus, { color: string; pulse?: boolean }> = {
  NOMINAL: { color: "text-[#22c55e]" },
  STRESSED: { color: "text-[#f59e0b]" },
  CRITICAL: { color: "text-[#ef4444]" },
  CASCADE: { color: "text-[#dc2626]", pulse: true },
};

const SEVERITY_BADGE: Record<number, { text: string; bg: string; border: string }> = {
  2: { text: "text-[#f59e0b]", bg: "bg-[#f59e0b]/10", border: "border-[#f59e0b]/25" },
  3: { text: "text-[#f97316]", bg: "bg-[#f97316]/10", border: "border-[#f97316]/25" },
  4: { text: "text-[#ef4444]", bg: "bg-[#ef4444]/10", border: "border-[#ef4444]/25" },
};

/* ================================================================== */
/*  HOOKS                                                              */
/* ================================================================== */
function useCurrentTime() {
  const [time, setTime] = useState("");
  useEffect(() => {
    function update() {
      const now = new Date();
      setTime(
        now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) +
          " · " +
          now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })
      );
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

/* ================================================================== */
/*  SMALL COMPONENTS                                                   */
/* ================================================================== */

/* frequency indicator dot */
function FreqDot({ hz }: { hz: number }) {
  const color =
    hz >= 59.95 && hz <= 60.05
      ? "bg-[#22c55e]"
      : hz >= 59.9 && hz <= 60.1
      ? "bg-[#f59e0b]"
      : "bg-[#ef4444]";
  return (
    <span
      className={`w-2 h-2 rounded-full ${color} inline-block`}
      style={{ animation: "pulse-dot 2s ease-in-out infinite" }}
    />
  );
}

/* progress bar */
function ProgressBar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="h-2 rounded-full bg-[#1a1a1a] overflow-hidden w-full">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 1, ease: "easeOut" }}
        className={`h-full rounded-full ${color}`}
      />
    </div>
  );
}

/* animated number */
function AnimCount({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let frame: number;
    const dur = 1000;
    const start = performance.now();
    function tick(now: number) {
      const p = Math.min((now - start) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setCount(Math.round(e * value));
      if (p < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span className={className}>{count.toLocaleString()}</span>;
}

/* ================================================================== */
/*  LEFT SIDEBAR CARDS                                                 */
/* ================================================================== */

function GridStatusCard({ status }: { status: GridStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-6 space-y-3">
      <span className="text-xs uppercase tracking-widest text-[#52525b] font-semibold block mb-3">
        National Grid Status
      </span>
      <span
        className={`block text-3xl font-bold ${style.color} ${
          style.pulse ? "animate-pulse" : ""
        }`}
      >
        {status}
      </span>

      {/* segmented bar */}
      <div className="flex h-3 rounded-full overflow-hidden gap-px mt-4">
        {REGION_SEGMENTS.map((seg) => (
          <div
            key={seg.name}
            className={`${SEGMENT_COLORS[seg.status]}`}
            style={{ width: seg.width }}
          />
        ))}
      </div>
      <div className="flex text-[10px] font-mono text-[#52525b]">
        {REGION_SEGMENTS.map((seg) => (
          <span key={seg.name} style={{ width: seg.width }}>
            {seg.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function ThreatsCard({
  threats,
  onFocus,
  focusedId,
}: {
  threats: ThreatData[];
  onFocus: (t: ThreatData) => void;
  focusedId: string | null;
}) {
  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-6 space-y-3">
      <span className="text-xs uppercase tracking-widest text-[#52525b] font-semibold block mb-3">
        Active Weather Events
      </span>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-[#52525b]">events tracked</span>
        <span className="text-4xl font-mono font-bold text-white leading-none">
          {threats.length}
        </span>
      </div>

      <div className="space-y-2 pt-1">
        {threats.map((t) => {
          const sev = SEVERITY_BADGE[t.severity] || SEVERITY_BADGE[2];
          const isFocused = focusedId === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onFocus(t)}
              className={`w-full flex items-center gap-3 min-h-[44px] px-3 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                isFocused
                  ? "bg-[#1a1a1a] border border-[#333]"
                  : "hover:bg-[#111] border border-transparent"
              }`}
            >
              <span className="text-sm leading-none flex-shrink-0">{t.icon}</span>
              <span className="text-sm text-white flex-1">{t.name}</span>
              <span
                className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${sev.bg} ${sev.text} ${sev.border}`}
              >
                SEV {t.severity}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CascadeProbabilityCard() {
  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-6 space-y-3">
      <span className="text-xs uppercase tracking-widest text-[#52525b] font-semibold block mb-3">
        Cascade Probability
      </span>
      <span className="block text-7xl font-mono font-bold text-[#ef4444] leading-none">
        73%
      </span>
      <span className="text-sm text-[#52525b] block">ERCOT region</span>

      {/* Thicker progress bar */}
      <div className="h-3 rounded-full bg-[#1a1a1a] overflow-hidden w-full mt-2">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: "73%" }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="h-full rounded-full bg-[#ef4444]"
        />
      </div>

      {/* Population stat (merged from removed PopulationCard) */}
      <div className="pt-3 mt-2 border-t border-[#1a1a1a]">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-[#52525b]">Households exposed</span>
          <span className="text-2xl font-mono font-bold text-[#f59e0b]">2.4M</span>
        </div>
        <span className="text-xs text-[#3f3f46] block mt-1">
          TX: 1.8M · NE: 0.4M · CA: 0.2M
        </span>
      </div>

      <span className="text-xs text-[#3f3f46] block">
        Based on 2,000-bus simulation
      </span>
    </div>
  );
}

/* ================================================================== */
/*  BOTTOM TICKER                                                      */
/* ================================================================== */
function BottomTicker({ items }: { items: TickerItem[] }) {
  /* duplicate for seamless loop */
  const duped = [...items, ...items, ...items];
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 h-12 bg-[#111111] border-t border-[#1a1a1a] overflow-hidden flex items-center">
      <div
        className="flex items-center gap-10 whitespace-nowrap"
        style={{ animation: "ticker-scroll 40s linear infinite" }}
      >
        {duped.map((item, i) => (
          <span key={i} className={`text-xs font-mono ${item.color} flex items-center gap-2`}>
            <span className="text-[8px]">●</span>
            {item.text}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  PAGE                                                               */
/* ================================================================== */
export default function OperatorPage({
  children,
}: {
  children?: ReactNode;
}) {
  const time = useCurrentTime();
  const gridHz = 60.02;
  const gridStatus: GridStatus = "STRESSED";

  const [focusedLocation, setFocusedLocation] = useState<FocusedLocation | null>(null);
  const [focusedThreatId, setFocusedThreatId] = useState<string | null>(null);
  const [isCascadeOpen, setIsCascadeOpen] = useState(false);

  const handleFocusThreat = useCallback((t: ThreatData) => {
    setFocusedThreatId(t.id);
    setFocusedLocation({ lat: t.lat, lng: t.lng, altitude: 1.8 });
  }, []);

  return (
    <div className="h-screen w-screen bg-[#0a0a0a] flex flex-col overflow-hidden">
      {/* ============================================================ */}
      {/*  COMMAND BAR                                                  */}
      {/* ============================================================ */}
      <header className="h-16 flex-shrink-0 bg-[#111111] border-b border-[#1a1a1a] flex items-center px-5 gap-4 z-50">
        {/* Left */}
        <Link
          href="/"
          className="inline-flex items-center justify-center h-11 px-4 rounded-lg border border-[#3f3f46] text-sm text-[#a1a1aa] hover:text-white hover:border-[#22c55e]/50 transition-colors flex-shrink-0"
        >
          ← Back
        </Link>

        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-2 h-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
          <span className="text-[15px] font-semibold tracking-tight text-white">
            blackout
          </span>
        </div>

        <div className="w-px h-6 bg-[#27272a] flex-shrink-0" />

        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs uppercase tracking-widest font-semibold text-[#f59e0b] border border-[#f59e0b]/25 bg-[#f59e0b]/[0.06] flex-shrink-0">
          Operator View
        </span>

        {/* Center */}
        <div className="flex-1 flex items-center justify-center gap-3 min-w-0">
          <span className="text-sm text-[#a1a1aa] truncate hidden lg:block">
            SCENARIO: Winter Storm Uri — Feb 13, 2021 T-48h
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span
              className="w-1.5 h-1.5 rounded-full bg-[#22c55e]"
              style={{ animation: "pulse-dot 1.5s ease-in-out infinite" }}
            />
            <span className="text-xs font-mono text-[#22c55e]">LIVE SIMULATION</span>
          </div>
        </div>

        {/* Right */}
        <span className="text-sm font-mono text-[#a1a1aa] hidden md:block flex-shrink-0">
          {time}
        </span>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <FreqDot hz={gridHz} />
          <span className="text-sm font-mono text-white">{gridHz.toFixed(2)} Hz</span>
        </div>

        <button
          onClick={() => setIsCascadeOpen(true)}
          className="h-11 px-4 rounded-lg bg-[#22c55e] text-white text-sm font-semibold hover:bg-[#16a34a] transition-colors cursor-pointer flex-shrink-0"
        >
          Run Simulation
        </button>

        <button className="w-11 h-11 rounded-lg border border-[#3f3f46] flex items-center justify-center text-[#a1a1aa] hover:text-white hover:border-[#52525b] transition-colors cursor-pointer flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>

      {/* ============================================================ */}
      {/*  MAIN BODY                                                    */}
      {/* ============================================================ */}
      <div className="flex-1 flex min-h-0">
        {/* ---- LEFT SIDEBAR ---- */}
        <aside
          className="w-[352px] flex-shrink-0 border-r border-[#1a1a1a] overflow-y-auto p-5 space-y-5 hidden lg:block"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}
        >
          <GridStatusCard status={gridStatus} />
          <ThreatsCard
            threats={THREATS}
            onFocus={handleFocusThreat}
            focusedId={focusedThreatId}
          />
          <CascadeProbabilityCard />
        </aside>

        {/* ---- CENTER GLOBE ---- */}
        <main className="flex-1 relative min-w-0 bg-[#0a0a0a]">
          <OperatorGlobe
            focusedLocation={focusedLocation}
            onSelectCity={(city) => setFocusedThreatId(city.id)}
            onDeselectCity={() => {
              setFocusedThreatId(null);
              setFocusedLocation(null);
            }}
          />
        </main>

        {/* ---- RIGHT SIDEBAR ---- */}
        <OperatorRightSidebar
          onFocusLocation={(loc) =>
            setFocusedLocation({
              lat: loc.lat,
              lng: loc.lng,
              altitude: loc.altitude ?? 1.5,
            })
          }
        />
      </div>

      {/* ============================================================ */}
      {/*  BOTTOM TICKER                                                */}
      {/* ============================================================ */}
      <BottomTicker items={TICKER_ITEMS} />

      {/* Cascade Simulation Overlay */}
      <CascadeOverlay
        isOpen={isCascadeOpen}
        onClose={() => setIsCascadeOpen(false)}
      />
    </div>
  );
}
