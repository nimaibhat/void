"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import OperatorGlobe from "@/components/OperatorGlobe";
import OperatorRightSidebar from "@/components/OperatorRightSidebar";
import CascadeOverlay from "@/components/CascadeOverlay";
import OperatorEntryModal, { getRegionFromZip } from "@/components/OperatorEntryModal";
import { useRealtimeSession } from "@/hooks/useRealtimeSession";
import EiaDataPanel from "@/components/EiaDataPanel";
import {
  fetchOverview,
  fetchHotspots,
  fetchArcs,
  fetchCascadeProbability,
  fetchCrews,
  fetchEvents,
  fetchGridNodes,
  type OverviewData,
  type Hotspot,
  type Arc,
  type CascadeProbability,
  type Crew,
  type TimelineEvent,
  type GridNodeData,
  type GridEdgeData,
} from "@/lib/api";
import type { HotspotData, ArcData, GridNode } from "@/components/OperatorGlobe";
import type { CrewData, EventData } from "@/components/OperatorRightSidebar";

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */
interface FocusedLocation {
  lat: number;
  lng: number;
  altitude: number;
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
/*  CONSTANTS                                                          */
/* ================================================================== */
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
  1: { text: "text-[#22c55e]", bg: "bg-[#22c55e]/10", border: "border-[#22c55e]/25" },
  2: { text: "text-[#f59e0b]", bg: "bg-[#f59e0b]/10", border: "border-[#f59e0b]/25" },
  3: { text: "text-[#f97316]", bg: "bg-[#f97316]/10", border: "border-[#f97316]/25" },
  4: { text: "text-[#ef4444]", bg: "bg-[#ef4444]/10", border: "border-[#ef4444]/25" },
};

/* ================================================================== */
/*  MAPPERS — backend → frontend                                       */
/* ================================================================== */
function mapStatus(s: string): "nominal" | "stressed" | "critical" {
  if (s === "stressed") return "stressed";
  if (s === "critical" || s === "blackout") return "critical";
  return "nominal";
}

function mapGridStatus(s: string): GridStatus {
  const m = s.toLowerCase();
  if (m === "critical" || m === "blackout" || m === "cascade") return "CRITICAL";
  if (m === "stressed") return "STRESSED";
  return "NOMINAL";
}

function mapHotspots(raw: Hotspot[]): HotspotData[] {
  return raw.map((h) => {
    const util = h.capacity_mw > 0 ? h.load_mw / h.capacity_mw : 0;
    const status: HotspotData["status"] =
      util > 0.8 ? "critical" : util > 0.5 ? "stressed" : "nominal";
    return {
      id: h.id,
      city: h.name + ", TX",
      lat: h.lat,
      lng: h.lon,
      severity: status === "critical" ? 4 : status === "stressed" ? 3 : 1,
      status,
      threat: h.outage_risk_pct > 50 ? "High Load" : h.outage_risk_pct > 30 ? "Elevated Load" : "Normal",
      cascade: Math.round(h.outage_risk_pct),
    };
  });
}

function mapArcs(raw: Arc[]): ArcData[] {
  return raw.map((a) => ({
    startLat: a.source_coords[0],
    startLng: a.source_coords[1],
    endLat: a.target_coords[0],
    endLng: a.target_coords[1],
    status: mapStatus(a.status),
  }));
}

function mapCrews(raw: Crew[]): CrewData[] {
  return raw.map((c) => ({
    id: c.crew_id,
    status: c.status,
    location: `${c.city} · ${c.specialty.replace(/_/g, " ")}`,
    lat: c.lat,
    lng: c.lon,
    personnel: 6,
    eta: c.eta_minutes > 0 ? `${Math.floor(c.eta_minutes / 60)}h ${c.eta_minutes % 60}m` : undefined,
  }));
}

const SEVERITY_ICONS: Record<string, string> = {
  critical: "🔴",
  emergency: "🔴",
  warning: "⚠️",
  info: "⚡",
  success: "✅",
};

function mapEvents(raw: TimelineEvent[]): EventData[] {
  return raw.map((e) => {
    const totalMin = e.timestamp_offset_minutes;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const ts = `T+${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const sev = e.severity === "emergency" ? "critical" : (e.severity as EventData["severity"]);
    return {
      id: e.event_id,
      icon: SEVERITY_ICONS[e.severity] || "⚡",
      timestamp: ts,
      title: e.title,
      description: e.description,
      severity: sev || "info",
    };
  });
}

function buildSegments(overview: OverviewData): RegionSegment[] {
  const regions = overview.regions;
  const total = regions.reduce((s, r) => s + r.load_mw, 0);
  return regions
    .sort((a, b) => b.load_mw - a.load_mw)
    .slice(0, 6)
    .map((r) => ({
      name: r.name,
      status: mapStatus(r.status),
      width: `${Math.max((r.load_mw / total) * 100, 5)}%`,
    }));
}

function buildThreats(overview: OverviewData) {
  return overview.regions
    .filter((r) => r.weather.is_extreme || r.status !== "normal")
    .map((r, i) => ({
      id: `t-${r.region_id}`,
      icon: r.status === "critical" || r.status === "blackout" ? "🔴" : r.weather.is_extreme ? "🟡" : "🟢",
      name: `${r.weather.condition} — ${r.name}`,
      severity: r.status === "critical" || r.status === "blackout" ? 4 : r.weather.is_extreme ? 3 : 2,
      region: "ERCOT",
      lat: 30.27 + (i - 3) * 0.8,
      lng: -97.74 + (i - 3) * 1.2,
    }));
}

function buildTicker(
  overview: OverviewData,
  cascadeData: CascadeProbability | null,
  crewCount: number
): TickerItem[] {
  const items: TickerItem[] = [];
  const totalLoad = Math.round(overview.total_load_mw).toLocaleString();
  const totalCap = Math.round(overview.total_capacity_mw).toLocaleString();
  items.push({
    text: `System Load: ${totalLoad} MW / ${totalCap} MW capacity`,
    color: "text-[#a1a1aa]",
  });
  items.push({
    text: `Grid Frequency: ${overview.grid_frequency_hz.toFixed(2)} Hz`,
    color: overview.grid_frequency_hz >= 59.95 ? "text-[#22c55e]" : "text-[#ef4444]",
  });
  if (cascadeData) {
    const ercotProb = Math.round((cascadeData.probabilities["ERCOT"] ?? 0) * 100);
    items.push({
      text: `${ercotProb}% cascade probability — ERCOT`,
      color: ercotProb > 50 ? "text-[#ef4444]" : ercotProb > 25 ? "text-[#f59e0b]" : "text-[#22c55e]",
    });
  }
  items.push({
    text: `${crewCount} crews deployed across ERCOT`,
    color: "text-[#22c55e]",
  });
  for (const r of overview.regions) {
    if (r.weather.is_extreme) {
      items.push({
        text: `${r.name}: ${r.weather.temp_f}°F — ${r.weather.condition}`,
        color: "text-[#f59e0b]",
      });
    }
  }
  return items;
}

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

/* ================================================================== */
/*  LEFT SIDEBAR CARDS                                                 */
/* ================================================================== */
interface ThreatData {
  id: string;
  icon: string;
  name: string;
  severity: number;
  region: string;
  lat: number;
  lng: number;
}

function GridStatusCard({
  status,
  segments,
}: {
  status: GridStatus;
  segments: RegionSegment[];
}) {
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
      <div className="flex h-3 rounded-full overflow-hidden gap-px mt-4">
        {segments.map((seg) => (
          <div
            key={seg.name}
            className={`${SEGMENT_COLORS[seg.status]}`}
            style={{ width: seg.width }}
          />
        ))}
      </div>
      <div className="flex text-[10px] font-mono text-[#52525b]">
        {segments.map((seg) => (
          <span key={seg.name} style={{ width: seg.width }} className="truncate">
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

function CascadeProbabilityCard({
  probability,
  totalLoad,
  totalCapacity,
}: {
  probability: number;
  totalLoad: number;
  totalCapacity: number;
}) {
  const pct = Math.round(probability * 100);
  const color = pct > 50 ? "text-[#ef4444]" : pct > 25 ? "text-[#f59e0b]" : "text-[#22c55e]";
  const barColor = pct > 50 ? "bg-[#ef4444]" : pct > 25 ? "bg-[#f59e0b]" : "bg-[#22c55e]";

  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-6 space-y-3">
      <span className="text-xs uppercase tracking-widest text-[#52525b] font-semibold block mb-3">
        Cascade Probability
      </span>
      <span className={`block text-7xl font-mono font-bold ${color} leading-none`}>
        {pct}%
      </span>
      <span className="text-sm text-[#52525b] block">ERCOT region</span>
      <div className="h-3 rounded-full bg-[#1a1a1a] overflow-hidden w-full mt-2">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className={`h-full rounded-full ${barColor}`}
        />
      </div>
      <div className="pt-3 mt-2 border-t border-[#1a1a1a]">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-[#52525b]">System Load</span>
          <span className="text-2xl font-mono font-bold text-[#f59e0b]">
            {(totalLoad / 1000).toFixed(1)} GW
          </span>
        </div>
        <span className="text-xs text-[#3f3f46] block mt-1">
          of {(totalCapacity / 1000).toFixed(1)} GW capacity
        </span>
      </div>
      <span className="text-xs text-[#3f3f46] block">
        Based on 2,000-bus ACTIVSg2000 simulation
      </span>
    </div>
  );
}

/* ================================================================== */
/*  BOTTOM TICKER                                                      */
/* ================================================================== */
function BottomTicker({ items }: { items: TickerItem[] }) {
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
/*  LOADING SKELETON                                                   */
/* ================================================================== */
function LoadingSkeleton() {
  return (
    <div className="h-screen w-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-4 h-4 rounded-full bg-[#22c55e] mx-auto animate-pulse shadow-[0_0_20px_rgba(34,197,94,0.4)]" />
        <p className="text-sm font-mono text-[#52525b]">Loading grid data...</p>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  PAGE                                                               */
/* ================================================================== */
export default function OperatorPage({ children }: { children?: ReactNode }) {
  const time = useCurrentTime();

  /* ---- Entry modal state ---- */
  const [showEntry, setShowEntry] = useState(true);
  const [scenario, setScenario] = useState("uri");
  const [zipcode, setZipcode] = useState("78701");

  /* ---- Data state ---- */
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [hotspots, setHotspots] = useState<HotspotData[]>([]);
  const [arcs, setArcs] = useState<ArcData[]>([]);
  const [cascadeData, setCascadeData] = useState<CascadeProbability | null>(null);
  const [crews, setCrews] = useState<CrewData[]>([]);
  const [events, setEvents] = useState<EventData[]>([]);
  const [crewCoverage, setCrewCoverage] = useState(0);
  const [gridNodes, setGridNodes] = useState<GridNode[]>([]);
  const [gridEdges, setGridEdges] = useState<GridEdgeData[]>([]);

  /* ---- UI state ---- */
  const [focusedLocation, setFocusedLocation] = useState<FocusedLocation | null>(null);
  const [focusedThreatId, setFocusedThreatId] = useState<string | null>(null);
  const [isCascadeOpen, setIsCascadeOpen] = useState(false);
  const [isEiaOpen, setIsEiaOpen] = useState(false);

  /* ---- Realtime session ---- */
  const { session: liveSession, isActive: isSimActive } = useRealtimeSession();

  const handleRunSimulation = useCallback(async () => {
    setIsCascadeOpen(true);
    try {
      await fetch(
        `/api/backend/orchestrate/run?scenario=${scenario}&forecast_hour=36&grid_region=ERCOT`,
        { method: "POST" }
      );
    } catch (err) {
      console.error("Failed to start orchestrated simulation:", err);
    }
  }, [scenario]);

  /* ---- Fetch all data ---- */
  const loadData = useCallback(async (sc: string) => {
    setLoading(true);
    try {
      const [ov, hs, ar, cp, cr, ev] = await Promise.all([
        fetchOverview(sc),
        fetchHotspots(sc),
        fetchArcs(sc),
        fetchCascadeProbability(sc),
        fetchCrews(sc),
        fetchEvents(sc),
      ]);
      setOverview(ov);
      setHotspots(mapHotspots(hs));
      setArcs(mapArcs(ar));
      setCascadeData(cp);
      setCrews(mapCrews(cr.crews));
      setCrewCoverage(cr.coverage_pct);
      setEvents(mapEvents(ev));
    } catch (err) {
      console.error("Failed to load operator data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  /* ---- Fetch grid nodes once (independent of scenario) ---- */
  useEffect(() => {
    fetchGridNodes()
      .then(({ nodes, edges }) => { setGridNodes(nodes); setGridEdges(edges); })
      .catch((err) => console.error("Failed to load grid nodes:", err));
  }, []);

  /* ---- Entry modal submit ---- */
  const handleEntrySubmit = useCallback(
    (zip: string, sc: string) => {
      setZipcode(zip);
      setScenario(sc);
      setShowEntry(false);
      loadData(sc);

      // Center map on the user's region
      const region = getRegionFromZip(zip);
      setFocusedLocation({ lat: region.lat, lng: region.lng, altitude: 2.0 });
      setTimeout(() => setFocusedLocation(null), 2000);
    },
    [loadData]
  );

  /* ---- Derived data ---- */
  const gridHz = overview?.grid_frequency_hz ?? 60.0;
  const liveHasFailures = liveSession && (liveSession.total_failed_nodes ?? 0) > 0;
  const gridStatus: GridStatus = liveHasFailures
    ? "CASCADE"
    : overview
      ? mapGridStatus(overview.national_status)
      : "NOMINAL";
  const segments: RegionSegment[] = overview ? buildSegments(overview) : [];
  const threats: ThreatData[] = overview ? buildThreats(overview) : [];
  const ercotProb = liveHasFailures
    ? Math.min(1, (liveSession!.total_failed_nodes! / 200))
    : (cascadeData?.probabilities["ERCOT"] ?? 0);
  const tickerItems: TickerItem[] =
    overview ? buildTicker(overview, cascadeData, crews.length) : [];

  const handleFocusThreat = useCallback((t: ThreatData) => {
    setFocusedThreatId(t.id);
    setFocusedLocation({ lat: t.lat, lng: t.lng, altitude: 1.8 });
  }, []);

  /* ---- Entry modal ---- */
  if (showEntry) {
    return <OperatorEntryModal isOpen={true} onSubmit={handleEntrySubmit} />;
  }

  if (loading || !overview) {
    return <LoadingSkeleton />;
  }

  const scenarioLabel =
    scenario === "uri"
      ? "Winter Storm Uri — Feb 13, 2021 T-48h"
      : scenario === "live"
        ? "Live AI Forecast — Real-Time Weather"
        : "Normal Operations — Feb 1, 2021";

  return (
    <div className="h-screen w-screen bg-[#0a0a0a] flex flex-col overflow-hidden">
      {/* ============================================================ */}
      {/*  COMMAND BAR                                                  */}
      {/* ============================================================ */}
      <header className="h-16 flex-shrink-0 bg-[#111111] border-b border-[#1a1a1a] flex items-center px-5 gap-4 z-50">
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

        <div className="flex-1 flex items-center justify-center gap-3 min-w-0">
          <span className="text-sm text-[#a1a1aa] truncate hidden lg:block">
            SCENARIO: {scenarioLabel}
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span
              className="w-1.5 h-1.5 rounded-full bg-[#22c55e]"
              style={{ animation: "pulse-dot 1.5s ease-in-out infinite" }}
            />
            <span className="text-xs font-mono text-[#22c55e]">LIVE SIMULATION</span>
          </div>

          {liveSession && (
            <span
              className={`text-xs font-mono uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                liveSession.status === "completed"
                  ? "text-[#22c55e] border-[#22c55e]/25 bg-[#22c55e]/[0.06]"
                  : "text-[#f59e0b] border-[#f59e0b]/25 bg-[#f59e0b]/[0.06] animate-pulse"
              }`}
            >
              {liveSession.status.replace(/_/g, " ")}
            </span>
          )}
        </div>

        <span className="text-sm font-mono text-[#a1a1aa] hidden md:block flex-shrink-0">
          {time}
        </span>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <FreqDot hz={gridHz} />
          <span className="text-sm font-mono text-white">{gridHz.toFixed(2)} Hz</span>
        </div>

        <button
          onClick={() => setIsEiaOpen(true)}
          className="h-11 px-4 rounded-lg border border-[#3f3f46] text-sm text-[#a1a1aa] font-semibold hover:text-white hover:border-[#22c55e]/50 transition-colors cursor-pointer flex-shrink-0"
        >
          EIA Data
        </button>

        <button
          onClick={handleRunSimulation}
          className="h-11 px-4 rounded-lg bg-[#22c55e] text-white text-sm font-semibold hover:bg-[#16a34a] transition-colors cursor-pointer flex-shrink-0"
        >
          Run Simulation
        </button>

        <button
          onClick={() => setShowEntry(true)}
          className="w-11 h-11 rounded-lg border border-[#3f3f46] flex items-center justify-center text-[#a1a1aa] hover:text-white hover:border-[#52525b] transition-colors cursor-pointer flex-shrink-0"
        >
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
          <GridStatusCard status={gridStatus} segments={segments} />
          <ThreatsCard
            threats={threats}
            onFocus={handleFocusThreat}
            focusedId={focusedThreatId}
          />
          <CascadeProbabilityCard
            probability={ercotProb}
            totalLoad={
              liveSession?.total_load_shed_mw
                ? overview.total_load_mw + liveSession.total_load_shed_mw
                : overview.total_load_mw
            }
            totalCapacity={overview.total_capacity_mw}
          />
        </aside>

        {/* ---- CENTER GLOBE ---- */}
        <main className="flex-1 relative min-w-0 bg-[#0a0a0a]">
          <OperatorGlobe
            hotspots={hotspots}
            arcs={arcs}
            gridNodes={gridNodes}
            gridEdges={gridEdges}
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
          crews={crews}
          events={events}
          crewCoverage={crewCoverage}
          scenario={scenario}
          onFocusLocation={(loc) =>
            setFocusedLocation({
              lat: loc.lat,
              lng: loc.lng,
              altitude: loc.altitude ?? 1.5,
            })
          }
        />
      </div>


      {/* Cascade Simulation Overlay */}
      <CascadeOverlay
        isOpen={isCascadeOpen}
        onClose={() => setIsCascadeOpen(false)}
        scenario={scenarioLabel}
        scenarioKey={scenario}
        region="ERCOT"
        session={liveSession}
      />

      {/* EIA Data Panel */}
      <EiaDataPanel
        isOpen={isEiaOpen}
        onClose={() => setIsEiaOpen(false)}
      />
    </div>
  );
}
