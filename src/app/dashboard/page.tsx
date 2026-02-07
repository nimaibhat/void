"use client";

import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import AlertsPanel from "@/components/AlertsPanel";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface Device {
  name: string;
  icon: string;
  status: string;
  value: string;
}

interface Threat {
  name: string;
  severity: number;
  region: string;
}

interface DashboardProfile {
  name: string;
  zip: string;
  gridRegion: string;
  homeType: string;
  sqft: number;
  devices: Device[];
  threats: Threat[];
  readinessScore: number;
  status: "PROTECTED" | "AT RISK" | "MONITORING";
  nextRiskWindow: string;
  smartActions: number;
  estSavings: number;
}

/* ------------------------------------------------------------------ */
/*  Default profile                                                    */
/* ------------------------------------------------------------------ */
const DEFAULT_PROFILE: DashboardProfile = {
  name: "Martinez Family",
  zip: "78701",
  gridRegion: "ERCOT",
  homeType: "Single Family",
  sqft: 2400,
  devices: [
    { name: "Thermostat", icon: "🌡️", status: "active", value: "72°F" },
    { name: "EV Charger", icon: "🚗", status: "scheduled", value: "2:00 AM" },
    { name: "Battery", icon: "🔋", status: "active", value: "78%" },
    { name: "Solar Inverter", icon: "☀️", status: "active", value: "4.2 kW" },
    { name: "Pool Pump", icon: "🏊", status: "deferred", value: "Off-peak" },
  ],
  threats: [
    { name: "Ice Storm — Austin Metro", severity: 3, region: "TX-AUSTIN-3" },
    { name: "Extreme Heat — TX South", severity: 4, region: "TX-SOUTH-1" },
  ],
  readinessScore: 94,
  status: "PROTECTED",
  nextRiskWindow: "Tue 2/10",
  smartActions: 3,
  estSavings: 14.2,
};

/* ------------------------------------------------------------------ */
/*  Animated ring                                                      */
/* ------------------------------------------------------------------ */
function ReadinessRing({
  score,
  size = 120,
}: {
  score: number;
  size?: number;
}) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const r = (size - 12) / 2;
  const circumference = 2 * Math.PI * r;

  useEffect(() => {
    let frame: number;
    const duration = 1000;
    const start = performance.now();
    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedScore(Math.round(eased * score));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [score]);

  const strokeDash = (animatedScore / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        className="-rotate-90"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#1a1a1a"
          strokeWidth="6"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#22c55e"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${strokeDash} ${circumference}`}
          style={{ transition: "stroke-dasharray 0.1s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-5xl font-bold font-mono text-white">
          {animatedScore}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Animated counter                                                   */
/* ------------------------------------------------------------------ */
function AnimatedNumber({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  className = "",
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let frame: number;
    const duration = 1200;
    const start = performance.now();
    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(eased * value);
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <span className={className}>
      {prefix}
      {decimals > 0 ? count.toFixed(decimals) : Math.round(count)}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Sparkline                                                          */
/* ------------------------------------------------------------------ */
function Sparkline({ data, className = "" }: { data: number[]; className?: string }) {
  const width = 160;
  const height = 48;
  const padding = 2;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = padding + (i / (data.length - 1)) * (width - padding * 2);
      const y = height - padding - ((v - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke="#22c55e"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Status badge                                                       */
/* ------------------------------------------------------------------ */
function StatusBadge({ status }: { status: DashboardProfile["status"] }) {
  const config = {
    PROTECTED: { bg: "bg-[#22c55e]/15", text: "text-[#22c55e]", border: "border-[#22c55e]/25" },
    "AT RISK": { bg: "bg-[#ef4444]/15", text: "text-[#ef4444]", border: "border-[#ef4444]/25" },
    MONITORING: { bg: "bg-[#f59e0b]/15", text: "text-[#f59e0b]", border: "border-[#f59e0b]/25" },
  };
  const c = config[status];

  return (
    <span
      className={`inline-flex items-center justify-center px-4 h-9 rounded-full text-sm font-semibold tracking-wide border ${c.bg} ${c.text} ${c.border}`}
    >
      {status}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Severity badge                                                     */
/* ------------------------------------------------------------------ */
function SeverityBadge({ severity }: { severity: number }) {
  const config: Record<number, { text: string; bg: string; border: string }> = {
    2: { text: "text-[#f59e0b]", bg: "bg-[#f59e0b]/10", border: "border-[#f59e0b]/25" },
    3: { text: "text-[#f97316]", bg: "bg-[#f97316]/10", border: "border-[#f97316]/25" },
    4: { text: "text-[#ef4444]", bg: "bg-[#ef4444]/10", border: "border-[#ef4444]/25" },
  };
  const c = config[severity] || config[2];

  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${c.bg} ${c.text} ${c.border}`}
    >
      SEV {severity}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Placeholder section                                                */
/* ------------------------------------------------------------------ */
function PlaceholderSection({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#333] bg-[#111111]/50 flex items-center justify-center min-h-[280px]">
      <span className="text-sm text-[#555] font-mono">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Current time hook                                                  */
/* ------------------------------------------------------------------ */
function useCurrentTime() {
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    function update() {
      const now = new Date();
      setTime(
        now.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        }) +
          " · " +
          now.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })
      );
    }
    update();
    const id = setInterval(update, 10_000);
    return () => clearInterval(id);
  }, []);

  return time;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default function DashboardPage() {
  const profile = DEFAULT_PROFILE;
  const time = useCurrentTime();
  const savingsHistory = [8.4, 9.1, 11.3, 10.8, 12.5, 13.1, 14.2];

  // Countdown to next risk window (mock: 36h 14m from now)
  const [countdown, setCountdown] = useState("36h 14m");
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let totalMinutes = 36 * 60 + 14;
    countdownRef.current = setInterval(() => {
      totalMinutes -= 1;
      if (totalMinutes <= 0) {
        setCountdown("0h 0m");
        if (countdownRef.current) clearInterval(countdownRef.current);
        return;
      }
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      setCountdown(`${h}h ${m}m`);
    }, 60_000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0a] overflow-auto">
      {/* ============================================================ */}
      {/*  TOP BAR                                                      */}
      {/* ============================================================ */}
      <header className="sticky top-0 z-40 w-full h-16 border-b border-[#1a1a1a] bg-[#0a0a0a]/90 backdrop-blur-md">
        <div className="max-w-[1400px] mx-auto h-full flex items-center justify-between px-6">
          {/* Left: back + logo */}
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex items-center justify-center h-11 px-4 rounded-lg border border-[#333] text-sm text-[#a1a1aa] hover:text-white hover:border-[#555] transition-colors"
            >
              ← Back
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
              <span className="text-[15px] font-semibold tracking-tight text-white">
                blackout
              </span>
            </div>
          </div>

          {/* Center: profile + location */}
          <span className="text-base text-[#a1a1aa] hidden sm:block">
            {profile.name} · Austin, TX
          </span>

          {/* Right: date/time */}
          <span className="text-sm font-mono text-[#a1a1aa]">{time}</span>
        </div>
      </header>

      {/* ============================================================ */}
      {/*  DASHBOARD BODY                                               */}
      {/* ============================================================ */}
      <main className="max-w-[1400px] mx-auto px-6 py-8 space-y-8">
        {/* ---------------------------------------------------------- */}
        {/*  ROW 1 — KEY METRICS                                        */}
        {/* ---------------------------------------------------------- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Card 1: Readiness Score */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-8 flex flex-col items-center gap-5"
          >
            <ReadinessRing score={profile.readinessScore} />
            <span className="text-sm text-[#a1a1aa]">out of 100</span>
            <StatusBadge status={profile.status} />
          </motion.div>

          {/* Card 2: Next Risk Window */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-8 flex flex-col gap-3"
          >
            <span className="text-xs uppercase tracking-widest text-[#71717a] font-semibold">
              Next Risk
            </span>
            <span className="text-4xl font-bold text-white tracking-tight">
              {profile.nextRiskWindow}
            </span>
            <span className="text-base text-[#a1a1aa]">
              {profile.threats[0]?.name}
            </span>
            <SeverityBadge severity={profile.threats[0]?.severity ?? 2} />
            <span className="text-lg font-mono text-[#22c55e] mt-auto">
              {countdown} away
            </span>
          </motion.div>

          {/* Card 3: Estimated Savings */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-8 flex flex-col gap-3"
          >
            <span className="text-xs uppercase tracking-widest text-[#71717a] font-semibold">
              Savings This Month
            </span>
            <AnimatedNumber
              value={profile.estSavings}
              prefix="$"
              decimals={2}
              className="text-5xl font-bold font-mono text-[#22c55e]"
            />
            <span className="text-sm text-[#22c55e]/70 flex items-center gap-1">
              <span>↑</span> 12% vs last month
            </span>
            <Sparkline
              data={savingsHistory}
              className="w-full h-12 mt-auto opacity-60"
            />
          </motion.div>

          {/* Card 4: Smart Actions */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-8 flex flex-col gap-3"
          >
            <span className="text-xs uppercase tracking-widest text-[#71717a] font-semibold">
              Smart Actions
            </span>
            <AnimatedNumber
              value={profile.smartActions}
              className="text-5xl font-bold font-mono text-white"
            />
            <span className="text-base text-[#a1a1aa]">actions scheduled</span>
            <button className="mt-auto w-full h-11 rounded-lg border border-[#22c55e]/40 text-[#22c55e] text-sm font-semibold hover:bg-[#22c55e]/10 hover:border-[#22c55e]/60 transition-all cursor-pointer">
              View Schedule →
            </button>
          </motion.div>
        </div>

        {/* ---------------------------------------------------------- */}
        {/*  ROW 2 — Price Forecast + Smart Devices                     */}
        {/* ---------------------------------------------------------- */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <PlaceholderSection label="Price Forecast" />
          </div>
          <div className="lg:col-span-2">
            <PlaceholderSection label="Smart Devices" />
          </div>
        </div>

        {/* ---------------------------------------------------------- */}
        {/*  ROW 3 — Appliance Timeline + Alerts                        */}
        {/* ---------------------------------------------------------- */}
        <div className="grid grid-cols-1 lg:grid-cols-9 gap-6">
          <div className="lg:col-span-5">
            <PlaceholderSection label="Appliance Timeline" />
          </div>
          <div className="lg:col-span-4">
            <AlertsPanel />
          </div>
        </div>
      </main>
    </div>
  );
}
