"use client"

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  HiOutlineBolt,
  HiOutlineBellAlert,
  HiOutlineShieldCheck,
  HiOutlineUserGroup,
  HiOutlineExclamationTriangle,
  HiOutlineChevronRight,
  HiOutlineArrowTrendingUp,
  HiOutlineArrowTrendingDown,
  HiOutlineClock,
  HiOutlineMapPin,
  HiOutlineXMark,
  HiOutlineArrowPath,
  HiOutlineEye,
  HiOutlineMap,
  HiOutlineChartBar,
  HiOutlineWrench,
  HiOutlineLightBulb,
} from "react-icons/hi2";

/* ═══════════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════════ */

type RiskLevel = "normal" | "monitoring" | "elevated" | "critical";
type TabType = "overview" | "map" | "analytics" | "operations";

interface Region {
  id: string;
  name: string;
  riskLevel: RiskLevel;
  load: number;
  capacity: number;
  frequency: number;
  price: number;
  cascadeProb: number;
  crewsDeployed: number;
  alerts: number;
  position: { x: number; y: number };
}

interface Substation {
  id: string;
  name: string;
  region: string;
  load: number;
  capacity: number;
  status: string;
  lastMaintenance: string;
}

interface Crew {
  id: string;
  location: string;
  crews: number;
  status: string;
  eta: string;
  region: string;
  priority: string;
}

interface ActivityEvent {
  id: number;
  time: string;
  message: string;
  type: string;
  region?: string;
}

/* ═══════════════════════════════════════════════════════════════════════
   MOCK DATA
   ═══════════════════════════════════════════════════════════════════════ */

const regions: Region[] = [
  { id: "ERCOT", name: "Texas (ERCOT)", riskLevel: "critical", load: 78, capacity: 85, frequency: 59.97, price: 142.5, cascadeProb: 34, crewsDeployed: 47, alerts: 5, position: { x: 35, y: 62 } },
  { id: "CAISO", name: "California (CAISO)", riskLevel: "elevated", load: 71, capacity: 80, frequency: 60.01, price: 68.2, cascadeProb: 12, crewsDeployed: 18, alerts: 2, position: { x: 5, y: 40 } },
  { id: "PJM", name: "Mid-Atlantic (PJM)", riskLevel: "normal", load: 55, capacity: 78, frequency: 60.0, price: 35.8, cascadeProb: 3, crewsDeployed: 12, alerts: 0, position: { x: 68, y: 32 } },
  { id: "NYISO", name: "New York (NYISO)", riskLevel: "normal", load: 52, capacity: 70, frequency: 60.02, price: 41.3, cascadeProb: 2, crewsDeployed: 8, alerts: 0, position: { x: 76, y: 18 } },
  { id: "MISO", name: "Midwest (MISO)", riskLevel: "monitoring", load: 64, capacity: 82, frequency: 60.01, price: 32.1, cascadeProb: 8, crewsDeployed: 15, alerts: 1, position: { x: 48, y: 28 } },
  { id: "SPP", name: "South Plains (SPP)", riskLevel: "normal", load: 45, capacity: 65, frequency: 60.0, price: 28.7, cascadeProb: 1, crewsDeployed: 6, alerts: 0, position: { x: 38, y: 45 } },
  { id: "ISONE", name: "New England (ISO-NE)", riskLevel: "normal", load: 38, capacity: 55, frequency: 60.01, price: 44.9, cascadeProb: 2, crewsDeployed: 4, alerts: 0, position: { x: 84, y: 10 } },
  { id: "WECC", name: "Western (WECC)", riskLevel: "monitoring", load: 58, capacity: 90, frequency: 60.0, price: 36.4, cascadeProb: 5, crewsDeployed: 10, alerts: 1, position: { x: 14, y: 22 } },
];

const connections: [string, string][] = [
  ["WECC", "CAISO"],
  ["WECC", "SPP"],
  ["SPP", "ERCOT"],
  ["SPP", "MISO"],
  ["MISO", "PJM"],
  ["MISO", "ERCOT"],
  ["PJM", "NYISO"],
  ["NYISO", "ISONE"],
];

const substations: Substation[] = [
  { id: "S-01", name: "Austin Central", region: "ERCOT", load: 92, capacity: 100, status: "critical", lastMaintenance: "Jan 15" },
  { id: "S-02", name: "Houston North", region: "ERCOT", load: 87, capacity: 100, status: "stressed", lastMaintenance: "Feb 20" },
  { id: "S-03", name: "Dallas West", region: "ERCOT", load: 81, capacity: 100, status: "stressed", lastMaintenance: "Mar 10" },
  { id: "S-04", name: "San Antonio Hub", region: "ERCOT", load: 76, capacity: 100, status: "monitoring", lastMaintenance: "Jan 28" },
  { id: "S-05", name: "El Paso Grid", region: "ERCOT", load: 68, capacity: 100, status: "normal", lastMaintenance: "Apr 05" },
  { id: "S-06", name: "Corpus Christi", region: "ERCOT", load: 71, capacity: 100, status: "monitoring", lastMaintenance: "Feb 14" },
  { id: "S-07", name: "LA Basin", region: "CAISO", load: 74, capacity: 100, status: "monitoring", lastMaintenance: "Mar 22" },
  { id: "S-08", name: "Bay Area Hub", region: "CAISO", load: 68, capacity: 100, status: "monitoring", lastMaintenance: "Jan 30" },
  { id: "S-09", name: "San Diego Metro", region: "CAISO", load: 54, capacity: 100, status: "normal", lastMaintenance: "Apr 12" },
  { id: "S-10", name: "PJM Central", region: "PJM", load: 51, capacity: 100, status: "normal", lastMaintenance: "Mar 15" },
  { id: "S-11", name: "NYC Grid", region: "NYISO", load: 55, capacity: 100, status: "normal", lastMaintenance: "Feb 28" },
  { id: "S-12", name: "Chicago Loop", region: "MISO", load: 66, capacity: 100, status: "monitoring", lastMaintenance: "Mar 05" },
  { id: "S-13", name: "Detroit Hub", region: "MISO", load: 48, capacity: 100, status: "normal", lastMaintenance: "Apr 18" },
  { id: "S-14", name: "Boston Metro", region: "ISONE", load: 42, capacity: 100, status: "normal", lastMaintenance: "Feb 10" },
  { id: "S-15", name: "Denver Grid", region: "WECC", load: 56, capacity: 100, status: "normal", lastMaintenance: "Mar 28" },
  { id: "S-16", name: "Phoenix Central", region: "WECC", load: 62, capacity: 100, status: "monitoring", lastMaintenance: "Jan 20" },
];

const predictionData = [
  { hour: "Now", probability: 22 },
  { hour: "3h", probability: 31 },
  { hour: "6h", probability: 42 },
  { hour: "9h", probability: 62 },
  { hour: "12h", probability: 74 },
  { hour: "15h", probability: 58 },
  { hour: "18h", probability: 45 },
  { hour: "21h", probability: 35 },
  { hour: "24h", probability: 28 },
  { hour: "27h", probability: 36 },
  { hour: "30h", probability: 48 },
  { hour: "33h", probability: 58 },
  { hour: "36h", probability: 63 },
  { hour: "39h", probability: 48 },
  { hour: "42h", probability: 36 },
  { hour: "45h", probability: 28 },
  { hour: "48h", probability: 22 },
];

const splitOutcomeData = [
  { metric: "Outage Hours", without: 12400, withPrev: 2100, unit: "hrs", pctChange: 83 },
  { metric: "Lives at Risk", without: 340, withPrev: 12, unit: "", pctChange: 96 },
  { metric: "Consumer Cost", without: 2.4, withPrev: 0.38, unit: "B", pctChange: 84 },
  { metric: "Grid Stability", without: 72, withPrev: 94, unit: "%", pctChange: 31 },
];

const crewData: Crew[] = [
  { id: "C-01", location: "West TX → Austin Corridor", crews: 12, status: "en-route", eta: "4hr", region: "ERCOT", priority: "high" },
  { id: "C-02", location: "Houston Staging Area", crews: 8, status: "staged", eta: "Ready", region: "ERCOT", priority: "high" },
  { id: "C-03", location: "Dallas Mobile Gen", crews: 6, status: "deployed", eta: "On-site", region: "ERCOT", priority: "medium" },
  { id: "C-04", location: "LA Basin Reserves", crews: 5, status: "standby", eta: "On call", region: "CAISO", priority: "medium" },
  { id: "C-05", location: "Hospital Gen Staging", crews: 16, status: "en-route", eta: "6hr", region: "ERCOT", priority: "high" },
  { id: "C-06", location: "Chicago Emergency", crews: 4, status: "standby", eta: "On call", region: "MISO", priority: "low" },
];

const activityFeed: ActivityEvent[] = [
  { id: 1, time: "14:12:01", message: "Cascade simulation complete — ERCOT 2000-bus model loaded", type: "success", region: "ERCOT" },
  { id: 2, time: "14:11:48", message: "Weather model updated — 48hr continental forecast refreshed", type: "info" },
  { id: 3, time: "14:11:35", message: "ERCOT reserve margin dropping — 14.2% → 11.8%", type: "warning", region: "ERCOT" },
  { id: 4, time: "14:11:22", message: "47 crews repositioned — West TX to Austin corridor", type: "success", region: "ERCOT" },
  { id: 5, time: "14:11:09", message: "ERCOT wholesale spike predicted — $142/MWh @ 15:00", type: "warning", region: "ERCOT" },
  { id: 6, time: "14:10:55", message: "Substation S-01 load 92% — approaching critical threshold", type: "critical", region: "ERCOT" },
  { id: 7, time: "14:10:42", message: "Heating load forecast +40% — next 12hr window", type: "warning" },
  { id: 8, time: "14:10:28", message: "Cascade depth-4 scenario simulated — 4,200 MW at risk", type: "critical", region: "ERCOT" },
  { id: 9, time: "14:10:15", message: "Ice accretion sensors active — 23 transmission lines monitored", type: "info" },
  { id: 10, time: "14:10:01", message: "6 alternate paths validated for TL-19 contingency", type: "success" },
  { id: 11, time: "14:09:48", message: "Emergency generators pre-staged at 12 hospital sites", type: "success", region: "ERCOT" },
  { id: 12, time: "14:09:35", message: "ERCOT frequency 59.97 Hz — below nominal, monitoring", type: "warning", region: "ERCOT" },
];

/* ═══════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════ */

const riskStyles: Record<RiskLevel, { bg: string; border: string; text: string; dot: string }> = {
  critical: { bg: "bg-[#ef4444]/15", border: "border-[#ef4444]/40", text: "text-[#ef4444]", dot: "bg-[#ef4444]" },
  elevated: { bg: "bg-[#f97316]/15", border: "border-[#f97316]/40", text: "text-[#f97316]", dot: "bg-[#f97316]" },
  monitoring: { bg: "bg-[#f59e0b]/15", border: "border-[#f59e0b]/40", text: "text-[#f59e0b]", dot: "bg-[#f59e0b]" },
  normal: { bg: "bg-[#22c55e]/15", border: "border-[#22c55e]/40", text: "text-[#22c55e]", dot: "bg-[#22c55e]" },
};

function loadBarColor(load: number) {
  if (load >= 85) return "bg-[#ef4444]";
  if (load >= 70) return "bg-[#f59e0b]";
  if (load >= 55) return "bg-[#eab308]";
  return "bg-[#22c55e]";
}

function loadTextColor(load: number) {
  if (load >= 85) return "text-[#ef4444]";
  if (load >= 70) return "text-[#f59e0b]";
  if (load >= 55) return "text-[#eab308]";
  return "text-[#22c55e]";
}

function statusText(s: string) {
  if (s === "critical") return "text-[#ef4444]";
  if (s === "stressed") return "text-[#f97316]";
  if (s === "monitoring" || s === "elevated") return "text-[#f59e0b]";
  return "text-[#22c55e]";
}

function crewStatusStyle(s: string) {
  if (s === "deployed") return "bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/25";
  if (s === "en-route") return "bg-[#3b82f6]/15 text-[#3b82f6] border border-[#3b82f6]/25";
  if (s === "staged") return "bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/25";
  return "bg-[#333]/50 text-[#a1a1aa] border border-[#333]";
}

function eventTypeStyle(t: string) {
  if (t === "critical") return { dot: "bg-[#ef4444]", text: "text-[#ef4444]" };
  if (t === "warning") return { dot: "bg-[#f59e0b]", text: "text-[#f59e0b]" };
  if (t === "success") return { dot: "bg-[#22c55e]", text: "text-[#22c55e]" };
  return { dot: "bg-[#3b82f6]", text: "text-[#3b82f6]" };
}

/* ═══════════════════════════════════════════════════════════════════════
   SMALL COMPONENTS
   ═══════════════════════════════════════════════════════════════════════ */

function StatusDot({ status, pulse = false }: { status: string; pulse?: boolean }) {
  const color =
    status === "critical" || status === "stressed"
      ? "bg-[#ef4444]"
      : status === "monitoring" || status === "elevated"
        ? "bg-[#f59e0b]"
        : "bg-[#22c55e]";
  return (
    <span className="relative inline-flex h-3 w-3 shrink-0">
      {pulse && <span className={`absolute inset-0 rounded-full ${color} animate-ping opacity-40`} />}
      <span className={`relative inline-flex h-3 w-3 rounded-full ${color}`} />
    </span>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#111111] border border-[#1a1a1a] rounded-xl ${className}`}>
      {children}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PredictionTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value as number;
  const color = val >= 60 ? "text-[#ef4444]" : val >= 40 ? "text-[#f59e0b]" : "text-[#22c55e]";
  return (
    <div className="bg-[#111111] border border-[#333] rounded-xl px-5 py-3 shadow-2xl">
      <p className="text-sm text-[#a1a1aa] mb-1">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{val}% probability</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   HEADER WITH TABS
   ═══════════════════════════════════════════════════════════════════════ */

function DashboardHeader({
  time,
  activeTab,
  onTabChange,
}: {
  time: Date;
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}) {
  const totalAlerts = regions.reduce((a, r) => a + r.alerts, 0);
  const maxRisk = Math.max(...regions.map((r) => r.cascadeProb));
  const totalCrews = regions.reduce((a, r) => a + r.crewsDeployed, 0);
  const avgLoad = Math.round(regions.reduce((a, r) => a + r.load, 0) / regions.length);
  const overallHealth = 100 - Math.round(avgLoad * 0.6 + maxRisk * 0.4);
  const healthColor = overallHealth >= 75 ? "text-[#22c55e]" : overallHealth >= 50 ? "text-[#f59e0b]" : "text-[#ef4444]";

  const timeStr = time.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const tabs: { id: TabType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "overview", label: "Overview", icon: HiOutlineChartBar },
    { id: "map", label: "Risk Map", icon: HiOutlineMap },
    { id: "analytics", label: "Analytics", icon: HiOutlineArrowTrendingUp },
    { id: "operations", label: "Operations", icon: HiOutlineWrench },
  ];

  return (
    <header className="sticky top-0 z-40 w-full bg-[#0a0a0a]/90 backdrop-blur-md border-b border-[#1a1a1a]">
      <div className="max-w-[1400px] mx-auto px-6">
        {/* Top bar */}
        <div className="h-20 flex items-center justify-between border-b border-[#1a1a1a]/60">
          {/* Left: Brand */}
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex items-center justify-center h-11 px-4 rounded-lg border border-[#333] text-sm text-[#a1a1aa] hover:text-white hover:border-[#555] transition-colors"
            >
              ← Back
            </Link>
            <div className="flex items-center gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
              <span className="text-[15px] font-semibold tracking-tight text-white">blackout</span>
            </div>
            <span className="w-px h-6 bg-[#333]" />
            <span className="text-base text-[#a1a1aa] font-medium">Operator Dashboard</span>
          </div>

          {/* Center: Key metrics */}
          <div className="hidden lg:flex items-center gap-8">
            <div className="flex items-center gap-3">
              <HiOutlineShieldCheck className={`w-5 h-5 ${healthColor}`} />
              <div>
                <p className="text-xs text-[#71717a]">Grid Health</p>
                <p className={`text-lg font-bold ${healthColor}`}>{overallHealth}%</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <HiOutlineBellAlert className={`w-5 h-5 ${totalAlerts > 0 ? "text-[#ef4444]" : "text-[#71717a]"}`} />
              <div>
                <p className="text-xs text-[#71717a]">Active Alerts</p>
                <p className={`text-lg font-bold ${totalAlerts > 0 ? "text-[#ef4444]" : "text-white"}`}>{totalAlerts}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <HiOutlineExclamationTriangle className={`w-5 h-5 ${maxRisk >= 30 ? "text-[#ef4444]" : maxRisk >= 10 ? "text-[#f59e0b]" : "text-[#22c55e]"}`} />
              <div>
                <p className="text-xs text-[#71717a]">Peak Risk</p>
                <p className={`text-lg font-bold ${maxRisk >= 30 ? "text-[#ef4444]" : maxRisk >= 10 ? "text-[#f59e0b]" : "text-[#22c55e]"}`}>{maxRisk}%</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <HiOutlineUserGroup className="w-5 h-5 text-[#3b82f6]" />
              <div>
                <p className="text-xs text-[#71717a]">Active Crews</p>
                <p className="text-lg font-bold text-[#3b82f6]">{totalCrews}</p>
              </div>
            </div>
          </div>

          {/* Right: Clock */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22c55e] opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#22c55e]" />
              </span>
              <span className="text-sm text-[#22c55e] font-medium">LIVE</span>
            </div>
            <span className="text-base font-mono text-[#a1a1aa] tabular-nums">{timeStr} EST</span>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex items-center gap-2 py-3">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg border transition-all duration-200 cursor-pointer ${
                  isActive
                    ? "bg-[#1a1a1a] text-white border-[#333]"
                    : "text-[#a1a1aa] hover:text-white hover:bg-[#1a1a1a]/50 border-transparent"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   OVERVIEW TAB
   ═══════════════════════════════════════════════════════════════════════ */

function OverviewTab() {
  const criticalRegions = regions.filter((r) => r.riskLevel === "critical" || r.riskLevel === "elevated");

  return (
    <div className="space-y-8">
      {/* Critical Alerts Banner */}
      {criticalRegions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card className="p-8 border-l-4 border-l-[#ef4444]">
            <div className="flex items-start gap-5">
              <HiOutlineExclamationTriangle className="w-8 h-8 text-[#ef4444] shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="text-2xl font-bold text-[#ef4444] mb-2">Critical Regions Detected</h3>
                <p className="text-base text-[#a1a1aa] mb-5">
                  {criticalRegions.length} region{criticalRegions.length > 1 ? "s" : ""} requiring immediate attention
                </p>
                <div className="flex flex-wrap gap-3">
                  {criticalRegions.map((region) => (
                    <div key={region.id} className="flex items-center gap-3 px-5 py-3 rounded-lg bg-[#1a1a1a] border border-[#333]">
                      <StatusDot status={region.riskLevel} pulse />
                      <span className="text-base font-semibold text-white">{region.id}</span>
                      <span className="text-sm text-[#a1a1aa]">{region.cascadeProb}% risk</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Region Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {regions.slice(0, 4).map((region, i) => (
          <motion.div
            key={region.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 + i * 0.05 }}
          >
            <Card className="p-8">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <StatusDot status={region.riskLevel} pulse={region.riskLevel === "critical"} />
                  <h3 className="text-xl font-bold text-white">{region.id}</h3>
                </div>
                {region.alerts > 0 && (
                  <span className="text-xs bg-[#ef4444]/15 text-[#ef4444] px-3 py-1.5 rounded-full font-semibold border border-[#ef4444]/25">
                    {region.alerts} alert{region.alerts > 1 ? "s" : ""}
                  </span>
                )}
              </div>

              <div className="space-y-5">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-[#a1a1aa]">Load</span>
                    <span className={`text-2xl font-bold font-mono ${loadTextColor(region.load)}`}>
                      {region.load}%
                    </span>
                  </div>
                  <div className="w-full h-3 bg-[#1a1a1a] rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${loadBarColor(region.load)}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${(region.load / region.capacity) * 100}%` }}
                      transition={{ duration: 1 }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-[#71717a] font-semibold mb-1">Cascade Risk</p>
                    <p className={`text-xl font-bold ${riskStyles[region.riskLevel].text}`}>
                      {region.cascadeProb}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-widest text-[#71717a] font-semibold mb-1">Price</p>
                    <p className={`text-xl font-bold ${region.price > 100 ? "text-[#ef4444]" : "text-white"}`}>
                      ${region.price}
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Recent Activity */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <Card className="p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">Recent Activity</h2>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22c55e] opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#22c55e]" />
              </span>
              <span className="text-sm text-[#22c55e] font-medium">Live Updates</span>
            </div>
          </div>

          <div className="space-y-2">
            {activityFeed.slice(0, 6).map((event) => {
              const style = eventTypeStyle(event.type);
              return (
                <div
                  key={event.id}
                  className="flex items-start gap-4 p-4 rounded-lg hover:bg-[#1a1a1a]/60 transition-colors"
                >
                  <span className={`mt-2 w-2.5 h-2.5 rounded-full shrink-0 ${style.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-base text-white/90 leading-relaxed mb-1">{event.message}</p>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-[#71717a] font-mono">{event.time}</span>
                      {event.region && (
                        <span className="text-sm text-[#71717a] bg-[#1a1a1a] px-2.5 py-0.5 rounded border border-[#333]">
                          {event.region}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAP TAB
   ═══════════════════════════════════════════════════════════════════════ */

function MapTab({
  selectedRegion,
  onSelectRegion,
}: {
  selectedRegion: string | null;
  onSelectRegion: (id: string | null) => void;
}) {
  const selectedData = regions.find((r) => r.id === selectedRegion);

  return (
    <div className="space-y-6">
      {/* Legend */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">National Cascade Risk Map</h2>
          <div className="flex items-center gap-6 text-sm text-[#a1a1aa]">
            {(["normal", "monitoring", "elevated", "critical"] as RiskLevel[]).map((level) => (
              <div key={level} className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${riskStyles[level].dot}`} />
                <span className="capitalize">{level}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Map */}
        <Card className="xl:col-span-2 p-0 overflow-hidden">
          <div className="relative" style={{ minHeight: 600 }}>
            {/* Background */}
            <div
              className="absolute inset-0 opacity-[0.03]"
              style={{
                backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)",
                backgroundSize: "40px 40px",
              }}
            />

            {/* Faint US outline */}
            <svg className="absolute inset-0 w-full h-full opacity-[0.05]" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path
                d="M 10,15 Q 30,10 50,12 Q 70,10 90,18 L 92,35 Q 88,45 85,55 L 78,65 Q 65,72 55,75 Q 45,78 35,80 Q 25,75 20,68 L 15,55 Q 8,40 10,15 Z"
                fill="none"
                stroke="#555"
                strokeWidth="0.4"
              />
            </svg>

            {/* Connection lines */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              {connections.map(([from, to], i) => {
                const f = regions.find((r) => r.id === from)!;
                const t = regions.find((r) => r.id === to)!;
                const active = from === selectedRegion || to === selectedRegion;
                return (
                  <line
                    key={i}
                    x1={f.position.x + 5}
                    y1={f.position.y + 4}
                    x2={t.position.x + 5}
                    y2={t.position.y + 4}
                    stroke={active ? "rgba(59,130,246,0.4)" : "rgba(85,85,85,0.25)"}
                    strokeWidth={active ? "0.3" : "0.15"}
                    strokeDasharray={active ? "" : "2 2"}
                  />
                );
              })}
            </svg>

            {/* Region nodes */}
            {regions.map((region) => {
              const style = riskStyles[region.riskLevel];
              const isSelected = region.id === selectedRegion;
              return (
                <motion.button
                  key={region.id}
                  onClick={() => onSelectRegion(isSelected ? null : region.id)}
                  className={`absolute z-10 text-left transition-all duration-200 rounded-xl border px-4 py-3.5 cursor-pointer
                    ${isSelected
                      ? `${style.bg} ${style.border} shadow-xl ring-2 ring-white/10`
                      : "bg-[#1a1a1a] border-[#333] hover:bg-[#222] hover:border-[#555]"
                    }`}
                  style={{ left: `${region.position.x}%`, top: `${region.position.y}%` }}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <StatusDot status={region.riskLevel} pulse={region.riskLevel === "critical"} />
                    <span className={`text-base font-bold tracking-wide ${isSelected ? style.text : "text-white"}`}>
                      {region.id}
                    </span>
                    {region.alerts > 0 && (
                      <span className="text-xs bg-[#ef4444]/20 text-[#ef4444] px-2 py-0.5 rounded-full font-semibold">
                        {region.alerts}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-20 h-2 bg-[#0a0a0a] rounded-full overflow-hidden">
                      <motion.div
                        className={`h-full rounded-full ${loadBarColor(region.load)}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${(region.load / region.capacity) * 100}%` }}
                        transition={{ duration: 0.8 }}
                      />
                    </div>
                    <span className="text-sm text-[#d4d4d8] font-mono font-semibold">{region.load}%</span>
                  </div>
                </motion.button>
              );
            })}

            {/* Crew markers */}
            {crewData
              .filter((c) => c.status === "deployed" || c.status === "en-route")
              .map((crew) => {
                const r = regions.find((reg) => reg.id === crew.region);
                if (!r) return null;
                return (
                  <div
                    key={crew.id}
                    className="absolute z-5 pointer-events-none"
                    style={{ left: `${r.position.x + 12}%`, top: `${r.position.y + 9}%` }}
                  >
                    <div className="flex items-center gap-1.5 opacity-80">
                      <div className="w-5 h-5 rounded-full bg-[#3b82f6]/25 border border-[#3b82f6]/40 flex items-center justify-center">
                        <HiOutlineUserGroup className="w-3 h-3 text-[#3b82f6]" />
                      </div>
                      <span className="text-xs text-[#3b82f6]/80 font-semibold">{crew.crews}</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>

        {/* Region detail */}
        <div>
          <AnimatePresence mode="wait">
            {selectedData ? (
              <motion.div
                key={selectedData.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <Card className="p-8 space-y-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-xl font-bold text-white mb-2">{selectedData.name}</h3>
                      <span
                        className={`inline-flex text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full border ${riskStyles[selectedData.riskLevel].bg} ${riskStyles[selectedData.riskLevel].text} ${riskStyles[selectedData.riskLevel].border}`}
                      >
                        {selectedData.riskLevel}
                      </span>
                    </div>
                    <button
                      onClick={() => onSelectRegion(null)}
                      className="text-[#71717a] hover:text-white transition-colors p-1 cursor-pointer"
                    >
                      <HiOutlineXMark className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: "Load", value: `${selectedData.load}%`, color: loadTextColor(selectedData.load) },
                      { label: "Cascade Risk", value: `${selectedData.cascadeProb}%`, color: riskStyles[selectedData.riskLevel].text },
                      { label: "Frequency", value: `${selectedData.frequency} Hz`, color: selectedData.frequency < 59.98 ? "text-[#f59e0b]" : "text-white" },
                      { label: "Price", value: `$${selectedData.price}/MWh`, color: selectedData.price > 100 ? "text-[#ef4444]" : "text-white" },
                    ].map((m) => (
                      <div key={m.label} className="bg-[#1a1a1a] rounded-xl p-4">
                        <p className="text-xs uppercase tracking-widest text-[#71717a] font-semibold mb-1">{m.label}</p>
                        <p className={`text-2xl font-bold ${m.color}`}>{m.value}</p>
                      </div>
                    ))}
                  </div>

                  <div>
                    <h4 className="text-xs uppercase tracking-widest text-[#71717a] font-semibold mb-3">Substations</h4>
                    <div className="space-y-2 max-h-[280px] overflow-y-auto pr-2 custom-scrollbar">
                      {substations
                        .filter((s) => s.region === selectedData.id)
                        .sort((a, b) => b.load - a.load)
                        .map((sub) => (
                          <div key={sub.id} className="flex items-center justify-between py-3 px-4 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a]">
                            <div className="flex items-center gap-3">
                              <StatusDot status={sub.status} pulse={sub.status === "critical"} />
                              <span className="text-sm text-white font-medium">{sub.name}</span>
                            </div>
                            <span className={`text-base font-mono font-bold ${statusText(sub.status)}`}>
                              {sub.load}%
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-[#1a1a1a]">
                    <div className="flex items-center gap-3">
                      <HiOutlineUserGroup className="w-6 h-6 text-[#3b82f6]" />
                      <div>
                        <p className="text-2xl font-bold text-white">{selectedData.crewsDeployed}</p>
                        <p className="text-sm text-[#a1a1aa]">Active crews</p>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Card className="p-12 flex flex-col items-center justify-center text-center min-h-[500px]">
                  <div className="w-16 h-16 rounded-full bg-[#1a1a1a] flex items-center justify-center mb-6">
                    <HiOutlineMapPin className="w-8 h-8 text-[#71717a]" />
                  </div>
                  <p className="text-lg text-white font-medium mb-2">Select a Region</p>
                  <p className="text-base text-[#71717a] max-w-[260px]">
                    Click any region on the map to view detailed status, metrics, and substations
                  </p>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   ANALYTICS TAB
   ═══════════════════════════════════════════════════════════════════════ */

function AnalyticsTab() {
  const peakPoint = predictionData.reduce((max, p) => (p.probability > max.probability ? p : max), predictionData[0]);

  return (
    <div className="space-y-8">
      {/* Outage Prediction */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <Card className="p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">48-Hour Outage Prediction</h2>
              <p className="text-base text-[#a1a1aa]">AI-powered cascade risk forecast</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-widest text-[#71717a] font-semibold mb-1">Peak Risk Window</p>
              <p className={`text-4xl font-bold font-mono ${peakPoint.probability >= 60 ? "text-[#ef4444]" : "text-[#f59e0b]"}`}>
                {peakPoint.probability}%
              </p>
              <p className="text-base text-[#a1a1aa] mt-1">at {peakPoint.hour}</p>
            </div>
          </div>

          <div className="flex gap-3 mb-8 flex-wrap">
            {["Ice Storm (ERCOT)", "Heating Demand +40%", "Low Reserve Margin", "Transmission Constraints"].map((factor) => (
              <span key={factor} className="text-sm px-4 py-2 rounded-lg bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 font-medium">
                {factor}
              </span>
            ))}
          </div>

          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={predictionData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                <defs>
                  <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 13, fill: "#71717a" }}
                  axisLine={{ stroke: "#333" }}
                  tickLine={false}
                  interval={2}
                />
                <YAxis
                  tick={{ fontSize: 13, fill: "#71717a" }}
                  axisLine={false}
                  tickLine={false}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip content={<PredictionTooltip />} />
                <ReferenceLine y={25} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.4} label={{ value: "Low", position: "right", fill: "#22c55e", fontSize: 12 }} />
                <ReferenceLine y={50} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.4} label={{ value: "Medium", position: "right", fill: "#f59e0b", fontSize: 12 }} />
                <ReferenceLine y={75} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.4} label={{ value: "High", position: "right", fill: "#ef4444", fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="probability"
                  stroke="#f59e0b"
                  strokeWidth={3}
                  fill="url(#riskGrad)"
                  dot={false}
                  activeDot={{ r: 6, fill: "#f59e0b", stroke: "#111111", strokeWidth: 3 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </motion.div>

      {/* Impact Comparison */}
      <div>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white mb-2">AI Prevention Impact Analysis</h2>
          <p className="text-base text-[#a1a1aa]">Projected annual outcomes with vs. without prevention system</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* WITHOUT */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
            <Card className="p-8 border-l-4 border-l-[#ef4444]">
              <div className="flex items-center gap-3 mb-6">
                <HiOutlineExclamationTriangle className="w-6 h-6 text-[#ef4444]" />
                <h3 className="text-xl font-bold text-[#ef4444]">Without Prevention</h3>
                <span className="text-xs text-[#ef4444]/60 ml-auto">Historical Baseline</span>
              </div>
              <div className="space-y-6">
                {splitOutcomeData.map((item) => {
                  const isStability = item.metric === "Grid Stability";
                  const display = isStability
                    ? `${item.without}%`
                    : item.metric === "Consumer Cost"
                      ? `$${item.without}B`
                      : item.without.toLocaleString();
                  return (
                    <div key={item.metric}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-base text-[#a1a1aa]">{item.metric}</span>
                        <span className="text-2xl font-bold text-[#ef4444]/80">{display}</span>
                      </div>
                      <div className="w-full h-3 bg-[#1a1a1a] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#ef4444]/50"
                          style={{ width: isStability ? `${item.without}%` : "100%" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </motion.div>

          {/* WITH */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15 }}>
            <Card className="p-8 border-l-4 border-l-[#22c55e]">
              <div className="flex items-center gap-3 mb-6">
                <HiOutlineShieldCheck className="w-6 h-6 text-[#22c55e]" />
                <h3 className="text-xl font-bold text-[#22c55e]">With AI Prevention</h3>
                <span className="text-xs text-[#22c55e]/60 ml-auto">Optimized System</span>
              </div>
              <div className="space-y-6">
                {splitOutcomeData.map((item) => {
                  const isStability = item.metric === "Grid Stability";
                  const display = isStability
                    ? `${item.withPrev}%`
                    : item.metric === "Consumer Cost"
                      ? `$${item.withPrev}B`
                      : item.withPrev.toLocaleString();
                  const barPct = isStability
                    ? item.withPrev
                    : Math.round((item.withPrev / item.without) * 100);
                  return (
                    <div key={item.metric}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-base text-[#a1a1aa]">{item.metric}</span>
                        <span className="text-2xl font-bold text-[#22c55e]">{display}</span>
                      </div>
                      <div className="w-full h-3 bg-[#1a1a1a] rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full bg-[#22c55e]/60"
                          initial={{ width: 0 }}
                          animate={{ width: `${isStability ? barPct : Math.max(barPct, 5)}%` }}
                          transition={{ duration: 1.2 }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </motion.div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { label: "Outage-Hours Prevented", value: "10,300", icon: HiOutlineBolt, color: "text-[#f59e0b]", bg: "bg-[#f59e0b]/10", border: "border-[#f59e0b]/20" },
            { label: "Estimated Lives Saved", value: "328", icon: HiOutlineShieldCheck, color: "text-[#22c55e]", bg: "bg-[#22c55e]/10", border: "border-[#22c55e]/20" },
            { label: "Consumer Cost Savings", value: "$2.02B", icon: HiOutlineArrowTrendingDown, color: "text-[#3b82f6]", bg: "bg-[#3b82f6]/10", border: "border-[#3b82f6]/20" },
            { label: "Grid Stability Gain", value: "+31%", icon: HiOutlineArrowTrendingUp, color: "text-[#8b5cf6]", bg: "bg-[#8b5cf6]/10", border: "border-[#8b5cf6]/20" },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 + i * 0.05 }}
            >
              <Card className={`p-8 text-center border ${stat.border}`}>
                <stat.icon className={`w-8 h-8 ${stat.color} mx-auto mb-3`} />
                <p className={`text-4xl font-bold font-mono ${stat.color} mb-2`}>{stat.value}</p>
                <p className="text-sm text-[#a1a1aa] leading-tight">{stat.label}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   OPERATIONS TAB
   ═══════════════════════════════════════════════════════════════════════ */

function OperationsTab() {
  const totalCrews = crewData.reduce((a, c) => a + c.crews, 0);
  const actions = [
    { id: 1, title: "Pre-position crews Austin corridor", urgency: "critical", region: "ERCOT", impact: "Prevents 2,100 MW cascade" },
    { id: 2, title: "Activate demand response program", urgency: "high", region: "ERCOT", impact: "Reduces peak by 2,400 MW" },
    { id: 3, title: "Stage mobile generators at hospitals", urgency: "high", region: "ERCOT", impact: "Protects 12 critical facilities" },
    { id: 4, title: "Enable battery storage discharge", urgency: "medium", region: "CAISO", impact: "1,200 MWh reserve available" },
    { id: 5, title: "Reroute transmission via TL-22", urgency: "medium", region: "ERCOT", impact: "Reduces S-01 load by 8%" },
    { id: 6, title: "Coordinate with neighboring ISOs", urgency: "medium", region: "Multiple", impact: "Import capacity +800 MW" },
  ];

  return (
    <div className="space-y-8">
      {/* Crew Deployment */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Crew Deployment Status</h2>
            <p className="text-base text-[#a1a1aa]">{totalCrews} crews across {crewData.length} active teams</p>
          </div>
          <button className="flex items-center gap-2 h-11 px-5 rounded-lg border border-[#22c55e]/40 text-[#22c55e] text-sm font-semibold hover:bg-[#22c55e]/10 hover:border-[#22c55e]/60 transition-all cursor-pointer">
            <HiOutlineArrowPath className="w-4 h-4" />
            Optimize Routes
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {crewData.map((crew, i) => {
            const urgencyBorder =
              crew.priority === "high"
                ? "border-l-[#ef4444]"
                : crew.priority === "medium"
                  ? "border-l-[#f59e0b]"
                  : "border-l-[#3b82f6]";

            return (
              <motion.div
                key={crew.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.05 }}
              >
                <Card className={`p-6 border-l-4 ${urgencyBorder}`}>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <HiOutlineMapPin className="w-5 h-5 text-[#71717a]" />
                      <div>
                        <h3 className="text-base font-semibold text-white">{crew.location}</h3>
                        <p className="text-sm text-[#71717a] mt-0.5">{crew.region}</p>
                      </div>
                    </div>
                    <span className={`text-xs font-semibold px-3 py-1.5 rounded-full ${crewStatusStyle(crew.status)}`}>
                      {crew.status}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-[#1a1a1a]">
                    <div className="flex items-center gap-6 text-sm text-[#a1a1aa]">
                      <span className="flex items-center gap-2">
                        <HiOutlineUserGroup className="w-4 h-4" />
                        <span className="font-semibold text-white">{crew.crews}</span> crews
                      </span>
                      <span className="flex items-center gap-2">
                        <HiOutlineClock className="w-4 h-4" />
                        <span className="font-semibold text-white">{crew.eta}</span>
                      </span>
                    </div>
                    {crew.priority === "high" && (
                      <button className="text-sm font-semibold h-9 px-4 rounded-lg border border-[#333] text-[#a1a1aa] hover:text-white hover:border-[#555] transition-colors cursor-pointer">
                        Update Status
                      </button>
                    )}
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* AI Recommendations */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">AI-Recommended Actions</h2>
            <p className="text-base text-[#a1a1aa]">Preventive measures to reduce cascade risk</p>
          </div>
          <span className="text-sm font-medium text-[#22c55e] bg-[#22c55e]/10 px-4 py-2 rounded-lg border border-[#22c55e]/20">
            {actions.length} pending actions
          </span>
        </div>

        <div className="space-y-4">
          {actions.map((action, i) => {
            const urgencyBorder =
              action.urgency === "critical"
                ? "border-l-[#ef4444]"
                : action.urgency === "high"
                  ? "border-l-[#f59e0b]"
                  : "border-l-[#3b82f6]";

            const urgencyBadge =
              action.urgency === "critical"
                ? "bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/25"
                : action.urgency === "high"
                  ? "bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/25"
                  : "bg-[#3b82f6]/15 text-[#3b82f6] border border-[#3b82f6]/25";

            return (
              <motion.div
                key={action.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className={`p-6 border-l-4 ${urgencyBorder} hover:bg-[#1a1a1a]/60 transition-colors`}>
                  <div className="flex items-start justify-between gap-6">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <HiOutlineLightBulb className="w-5 h-5 text-[#f59e0b]" />
                        <h3 className="text-lg font-semibold text-white">{action.title}</h3>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-[#a1a1aa]">
                        <span className="flex items-center gap-1.5">
                          <HiOutlineArrowTrendingUp className="w-4 h-4" />
                          {action.impact}
                        </span>
                        <span className="text-[#555]">·</span>
                        <span className="flex items-center gap-1.5">
                          <HiOutlineMapPin className="w-4 h-4" />
                          {action.region}
                        </span>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase ${urgencyBadge}`}>
                          {action.urgency}
                        </span>
                      </div>
                    </div>
                    <button className="flex items-center gap-2 h-11 px-5 rounded-lg border border-[#22c55e]/40 text-[#22c55e] text-sm font-semibold hover:bg-[#22c55e]/10 hover:border-[#22c55e]/60 transition-all cursor-pointer whitespace-nowrap">
                      Execute
                      <HiOutlineChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN DASHBOARD
   ═══════════════════════════════════════════════════════════════════════ */

export default function OperatorDashboard() {
  const [selectedRegion, setSelectedRegion] = useState<string | null>("ERCOT");
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [currentTime, setCurrentTime] = useState<Date | null>(null);

  useEffect(() => {
    setCurrentTime(new Date());
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!currentTime) {
    return (
      <div className="fixed inset-0 bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-[#333] border-t-[#22c55e] rounded-full animate-spin" />
          <span className="text-base text-[#a1a1aa]">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] overflow-auto">
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
      `}</style>

      <DashboardHeader time={currentTime} activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="max-w-[1400px] mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === "overview" && <OverviewTab />}
            {activeTab === "map" && (
              <MapTab selectedRegion={selectedRegion} onSelectRegion={setSelectedRegion} />
            )}
            {activeTab === "analytics" && <AnalyticsTab />}
            {activeTab === "operations" && <OperationsTab />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
