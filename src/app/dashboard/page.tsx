"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AlertsPanel, { type AlertData } from "@/components/AlertsPanel";
import EnhancedSmartDevicesPanel from "@/components/EnhancedSmartDevicesPanel";
import XRPLWalletPanel from "@/components/XRPLWalletPanel";
import { supabase } from "@/lib/supabase";
import { useRealtimeAlerts, type LiveAlert } from "@/hooks/useRealtimeAlerts";
import { useRealtimeSession } from "@/hooks/useRealtimeSession";
import { fetchRecommendations, type HourlyPrice, type ConsumerRecommendation } from "@/lib/api";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface Device {
  name: string;
  icon: string;
  status: string;
  value: string;
  brand?: string;
  model?: string;
  type?: string;
}

interface Threat {
  name: string;
  severity: number;
  region: string;
}

interface DashboardProfile {
  name: string;
  location: string;
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
  enodeUserId: string | null;
  profileId: string | null;
}

/* ------------------------------------------------------------------ */
/*  Default Martinez profile UUID (first row in Supabase)              */
/* ------------------------------------------------------------------ */
const DEFAULT_PROFILE_ID = "e2bfe115-5417-4d25-bac6-d5e299d8c6f5";

const EMPTY_PROFILE: DashboardProfile = {
  name: "",
  location: "",
  zip: "",
  gridRegion: "ERCOT",
  homeType: "Single Family",
  sqft: 2400,
  devices: [
    { name: "Carrier Infinity HVAC", icon: "🌡️", status: "active", value: "72°F", brand: "Carrier", model: "Infinity System", type: "thermostat" },
    { name: "Tesla Powerwall", icon: "🔋", status: "active", value: "78%", brand: "Tesla", model: "Powerwall", type: "battery" },
    { name: "SolarEdge HD-Wave Inverter", icon: "☀️", status: "active", value: "5.2 kW", brand: "SolarEdge", model: "HD-Wave", type: "solar_inverter" },
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
  enodeUserId: null,
  profileId: null,
};

/* ------------------------------------------------------------------ */
/*  Map Supabase row → DashboardProfile                                */
/* ------------------------------------------------------------------ */
const DEVICE_ICON_MAP: Record<string, string> = {
  thermostat: "🌡️",
  ev_charger: "🚗",
  battery: "🔋",
  solar_inverter: "☀️",
  smart_plug: "🔌",
  smart_water_heater: "🌡️",
  dryer: "🔌",
  pool_pump: "🏊",
  generator: "⚡",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSupabaseRow(row: any): DashboardProfile {
  const devices: Device[] = (row.smart_devices ?? []).map(
    (d: { type: string; name: string; brand?: string; model?: string; level_pct?: number; capacity_kw?: number; level?: string; note?: string }) => ({
      name: d.name,
      icon: DEVICE_ICON_MAP[d.type] ?? "⚙️",
      status: "active",
      value:
        d.level_pct != null ? `${d.level_pct}%` :
        d.capacity_kw != null ? `${d.capacity_kw} kW` :
        d.level ?? d.note ?? "on",
      brand: d.brand,
      model: d.model,
      type: d.type,
    })
  );

  const threats: Threat[] = (row.active_threats ?? []).map(
    (t: { event: string; area: string; severity: number }) => ({
      name: `${t.event} — ${t.area}`,
      severity: t.severity,
      region: t.area,
    })
  );

  const statusNorm = (row.status ?? "").toUpperCase();
  let status: DashboardProfile["status"] = "MONITORING";
  if (statusNorm === "PROTECTED") status = "PROTECTED";
  else if (statusNorm === "AT RISK") status = "AT RISK";

  const nextRisk = row.next_risk_window ?? "";
  const nextRiskShort = nextRisk.split("–")[0]?.trim() || nextRisk.split("—")[0]?.trim() || nextRisk;

  return {
    name: row.name,
    location: [row.city, row.state].filter(Boolean).join(", ") || `ZIP ${row.zip_code}`,
    zip: row.zip_code,
    gridRegion: row.grid_region,
    homeType: row.home_type,
    sqft: row.square_footage ?? 0,
    devices,
    threats,
    readinessScore: row.readiness_score ?? 0,
    status,
    nextRiskWindow: nextRiskShort,
    smartActions: (row.smart_actions ?? []).length,
    estSavings: Number(row.estimated_savings_dollars) || 0,
    enodeUserId: row.enode_user_id ?? null,
    profileId: row.id ?? null,
  };
}

/* ------------------------------------------------------------------ */
/*  Map LiveAlert → AlertData                                          */
/* ------------------------------------------------------------------ */
const LIVE_SEVERITY_MAP: Record<string, AlertData["severity"]> = {
  critical: "critical",
  warning: "warning",
  optimization: "optimization",
};

function mapLiveAlert(la: LiveAlert): AlertData {
  const severity = LIVE_SEVERITY_MAP[la.severity] ?? "warning";
  const ago = Math.max(
    0,
    Math.round((Date.now() - new Date(la.created_at).getTime()) / 60000)
  );
  return {
    id: la.id,
    severity,
    title: la.title,
    description: la.description,
    timestamp: ago === 0 ? "just now" : `${ago}m ago`,
    action:
      severity === "optimization"
        ? { label: "Accept →", variant: "primary" }
        : severity === "critical"
          ? { label: "View Details →", variant: "primary" }
          : undefined,
  };
}

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
/*  Price Forecast Chart (48-hour SVG sparkline)                       */
/* ------------------------------------------------------------------ */
function PriceForecastChart({
  prices,
  loading,
}: {
  prices: HourlyPrice[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 min-h-[280px] flex items-center justify-center">
        <span className="text-sm font-mono text-white/30 animate-pulse">
          loading forecast...
        </span>
      </div>
    );
  }

  if (!prices.length) {
    return (
      <div className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 min-h-[280px] flex items-center justify-center">
        <span className="text-sm text-[#555] font-mono">
          Price forecast unavailable
        </span>
      </div>
    );
  }

  const W = 600;
  const H = 180;
  const PAD_X = 40;
  const PAD_Y = 24;

  const kwhPrices = prices.map((p) => p.consumer_price_kwh);
  const maxP = Math.max(...kwhPrices, 0.3);
  const minP = Math.min(...kwhPrices, 0);
  const range = maxP - minP || 0.1;

  const toX = (i: number) =>
    PAD_X + (i / (prices.length - 1)) * (W - PAD_X * 2);
  const toY = (v: number) =>
    PAD_Y + (1 - (v - minP) / range) * (H - PAD_Y * 2);

  // Build the main line path
  const linePath = prices
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.consumer_price_kwh).toFixed(1)}`)
    .join(" ");

  // Gradient fill area
  const areaPath =
    linePath +
    ` L${toX(prices.length - 1).toFixed(1)},${(H - PAD_Y).toFixed(1)}` +
    ` L${PAD_X.toFixed(1)},${(H - PAD_Y).toFixed(1)} Z`;

  // Spike regions (>$0.25) and valley regions (<$0.08)
  const spikeRects: { x: number; w: number }[] = [];
  const valleyRects: { x: number; w: number }[] = [];

  let spikeStart: number | null = null;
  let valleyStart: number | null = null;

  for (let i = 0; i < prices.length; i++) {
    const kwh = prices[i].consumer_price_kwh;
    if (kwh > 0.25) {
      if (spikeStart === null) spikeStart = i;
    } else if (spikeStart !== null) {
      spikeRects.push({ x: toX(spikeStart), w: toX(i) - toX(spikeStart) });
      spikeStart = null;
    }
    if (kwh < 0.08) {
      if (valleyStart === null) valleyStart = i;
    } else if (valleyStart !== null) {
      valleyRects.push({ x: toX(valleyStart), w: toX(i) - toX(valleyStart) });
      valleyStart = null;
    }
  }
  if (spikeStart !== null)
    spikeRects.push({ x: toX(spikeStart), w: toX(prices.length - 1) - toX(spikeStart) });
  if (valleyStart !== null)
    valleyRects.push({ x: toX(valleyStart), w: toX(prices.length - 1) - toX(valleyStart) });

  // Stats
  const avg = kwhPrices.reduce((a, b) => a + b, 0) / kwhPrices.length;
  const peak = Math.max(...kwhPrices);
  const low = Math.min(...kwhPrices);

  // Y-axis labels
  const yTicks = [minP, minP + range * 0.33, minP + range * 0.66, maxP];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.25 }}
      className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 min-h-[280px]"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">
          48-Hour Price Forecast
        </h3>
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="text-[#a1a1aa]">
            Avg <span className="text-white">${avg.toFixed(2)}</span>
          </span>
          <span className="text-[#ef4444]">
            Peak <span className="text-white">${peak.toFixed(2)}</span>
          </span>
          <span className="text-[#22c55e]">
            Low <span className="text-white">${low.toFixed(2)}</span>
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y-axis grid lines + labels */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD_X}
              y1={toY(v)}
              x2={W - PAD_X}
              y2={toY(v)}
              stroke="#1a1a1a"
              strokeWidth="1"
            />
            <text
              x={PAD_X - 4}
              y={toY(v) + 3}
              textAnchor="end"
              className="text-[8px] fill-[#52525b]"
            >
              ${v.toFixed(2)}
            </text>
          </g>
        ))}

        {/* Spike regions (red) */}
        {spikeRects.map((r, i) => (
          <rect
            key={`spike-${i}`}
            x={r.x}
            y={PAD_Y}
            width={Math.max(r.w, 2)}
            height={H - PAD_Y * 2}
            fill="rgba(239,68,68,0.08)"
          />
        ))}

        {/* Valley regions (green) */}
        {valleyRects.map((r, i) => (
          <rect
            key={`valley-${i}`}
            x={r.x}
            y={PAD_Y}
            width={Math.max(r.w, 2)}
            height={H - PAD_Y * 2}
            fill="rgba(34,197,94,0.08)"
          />
        ))}

        {/* Area fill */}
        <path d={areaPath} fill="url(#priceGrad)" />

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke="#22c55e"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* X-axis hour labels (every 6 hours) */}
        {prices
          .filter((_, i) => i % 6 === 0)
          .map((p, i) => (
            <text
              key={i}
              x={toX(p.hour)}
              y={H - 4}
              textAnchor="middle"
              className="text-[8px] fill-[#52525b]"
            >
              {p.hour % 24 === 0
                ? "12a"
                : p.hour % 24 < 12
                  ? `${p.hour % 24}a`
                  : p.hour % 24 === 12
                    ? "12p"
                    : `${(p.hour % 24) - 12}p`}
            </text>
          ))}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-[10px] text-[#71717a]">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-[rgba(239,68,68,0.3)]" />
          Spike (&gt;$0.25)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-[rgba(34,197,94,0.3)]" />
          Valley (&lt;$0.08)
        </span>
        <span className="ml-auto font-mono text-[#52525b]">$/kWh</span>
      </div>
    </motion.div>
  );
}

/* SmartDevicesPanel — replaced by EnhancedSmartDevicesPanel component */

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
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <span className="text-sm font-mono text-white/30">loading dashboard...</span>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const profileId = searchParams.get("id") || DEFAULT_PROFILE_ID;

  const [profile, setProfile] = useState<DashboardProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [priceData, setPriceData] = useState<HourlyPrice[]>([]);
  const [priceLoading, setPriceLoading] = useState(true);
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [recommendation, setRecommendation] = useState<ConsumerRecommendation | null>(null);
  const [enodeUserId, setEnodeUserId] = useState<string | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>("hh-martinez");
  const time = useCurrentTime();

  // Build savings history from optimized_schedule or use defaults
  const savingsHistory = recommendation?.optimized_schedule?.length
    ? recommendation.optimized_schedule.map((s) => s.savings)
    : [8.4, 9.1, 11.3, 10.8, 12.5, 13.1, 14.2];

  // Realtime live alerts from orchestrated simulations
  const { liveAlerts } = useRealtimeAlerts(profile.gridRegion);

  // Realtime session — when operator runs a sim, switch scenario
  const { session: liveSession } = useRealtimeSession();
  const scenario = liveSession?.scenario ?? "live";

  // Derive householdId from profile name
  const deriveHouseholdId = (name: string): string | null => {
    const lower = name.toLowerCase();
    if (lower.includes("martinez")) return "hh-martinez";
    if (lower.includes("chen")) return "hh-chen";
    if (lower.includes("sharma")) return "hh-sharma";
    return null;
  };

  // Fetch profile from Supabase (always — no hardcoded fallback)
  useEffect(() => {
    setLoading(true);
    supabase
      .from("consumer_profiles")
      .select("*")
      .eq("id", profileId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          console.error("Failed to fetch profile:", error);
        } else {
          const mapped = mapSupabaseRow(data);
          setProfile(mapped);
          setEnodeUserId(mapped.enodeUserId);
          setHouseholdId(deriveHouseholdId(mapped.name));
        }
        setLoading(false);
      });
  }, [profileId]);

  // Fetch backend recommendations — re-runs when scenario changes (live → sim)
  useEffect(() => {
    if (loading) return;
    fetchRecommendations(profileId, profile.gridRegion, scenario)
      .then((rec) => {
        setRecommendation(rec);
        setProfile((prev) => ({
          ...prev,
          readinessScore: rec.readiness_score ?? prev.readinessScore,
          status: (rec.status === "PROTECTED" ? "PROTECTED"
            : rec.status === "AT_RISK" ? "AT RISK"
            : "MONITORING") as DashboardProfile["status"],
          estSavings: rec.total_savings ?? prev.estSavings,
          nextRiskWindow: rec.next_risk_window
            ? rec.next_risk_window.split("–")[0]?.trim() || rec.next_risk_window
            : prev.nextRiskWindow,
        }));
      })
      .catch((err) => console.error("Failed to fetch recommendations:", err));
  }, [profileId, profile.gridRegion, scenario, loading]);

  // Fetch price forecast + smart alerts — re-runs when scenario changes
  useEffect(() => {
    setPriceLoading(true);
    const alertUrl = `/api/alerts?profileId=${profileId}&scenario=${scenario}`;

    fetch(alertUrl)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          if (data.prices?.length) setPriceData(data.prices);
          if (data.alerts?.length) setAlerts(data.alerts);
        }
      })
      .catch((err) => console.error("Failed to fetch alerts:", err))
      .finally(() => setPriceLoading(false));
  }, [profileId, scenario]);

  // Handle alert accept action
  const handleAlertAction = useCallback(
    async (alertId: string) => {
      try {
        const res = await fetch("/api/alerts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alertId, profileId }),
        });
        const data = await res.json();
        if (data.ok) {
          // Mark alert as resolved in local state
          setAlerts((prev) =>
            prev.map((a) =>
              a.id === alertId
                ? { ...a, severity: "resolved" as const, action: undefined }
                : a
            )
          );
          // Update savings with the amount added
          if (data.savings > 0) {
            setProfile((prev) => ({
              ...prev,
              estSavings: Math.round((prev.estSavings + data.savings) * 100) / 100,
            }));
          }
        }
      } catch (err) {
        console.error("Failed to accept alert:", err);
      }
    },
    [profileId]
  );

  // Countdown to next risk — derive from price spike in forecast data
  const [countdown, setCountdown] = useState("—");
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Find first price spike (>$0.25/kWh) in forecast
    const spikeHour = priceData.find((p) => p.consumer_price_kwh > 0.25)?.hour;
    let totalMinutes = spikeHour != null ? spikeHour * 60 : 36 * 60 + 14;

    const fmt = (mins: number) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h}h ${m}m`;
    };
    setCountdown(fmt(totalMinutes));

    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      totalMinutes -= 1;
      if (totalMinutes <= 0) {
        setCountdown("0h 0m");
        if (countdownRef.current) clearInterval(countdownRef.current);
        return;
      }
      setCountdown(fmt(totalMinutes));
    }, 60_000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [priceData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <span className="text-sm font-mono text-white/30 animate-pulse">loading profile...</span>
      </div>
    );
  }

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
                void
              </span>
            </div>
          </div>

          {/* Center: profile + location */}
          <span className="text-base text-[#a1a1aa] hidden sm:block">
            {profile.name} · {profile.location}
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
            <PriceForecastChart prices={priceData} loading={priceLoading} />
          </div>
          <div className="lg:col-span-2">
            {/* Only show Enode devices, no hardcoded devices */}
            <EnhancedSmartDevicesPanel
              devices={[]}
              enodeUserId={enodeUserId}
              onEnodeUserIdChange={setEnodeUserId}
              profileId={profileId}
            />
          </div>
        </div>

        {/* ---------------------------------------------------------- */}
        {/*  ROW 3 — XRPL Rewards                                      */}
        {/* ---------------------------------------------------------- */}
        <div className="grid grid-cols-1 gap-6">
          <XRPLWalletPanel householdId={householdId} profileId={profileId} />
        </div>

        {/* ---------------------------------------------------------- */}
        {/*  ROW 4 — Alerts                                             */}
        {/* ---------------------------------------------------------- */}
        <div className="grid grid-cols-1 gap-6">
          <AlertsPanel
            alerts={[...liveAlerts.map(mapLiveAlert), ...alerts]}
            onAction={handleAlertAction}
          />
        </div>
      </main>
    </div>
  );
}
