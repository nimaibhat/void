"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */
export interface CrewData {
  id: string;
  status: "deployed" | "en_route" | "standby";
  location: string;
  lat: number;
  lng: number;
  personnel: number;
  eta?: string;
}

export interface EventData {
  id: string;
  icon: string;
  timestamp: string;
  title: string;
  description: string;
  severity: "critical" | "warning" | "info" | "success";
  lat?: number;
  lng?: number;
}

interface OperatorRightSidebarProps {
  crews?: CrewData[];
  events?: EventData[];
  crewCoverage?: number;
  onFocusLocation: (location: { lat: number; lng: number; altitude?: number }) => void;
}

/* ================================================================== */
/*  DEFAULTS                                                           */
/* ================================================================== */
const DEFAULT_CREWS: CrewData[] = [
  { id: "CREW-TX-14", status: "deployed", location: "West Texas · Sub WTX-04", lat: 31.5, lng: -100.4, personnel: 6 },
  { id: "CREW-TX-22", status: "deployed", location: "Austin Metro · Sub ATX-12", lat: 30.27, lng: -97.74, personnel: 8 },
  { id: "CREW-TX-08", status: "en_route", location: "Houston · Sub HOU-07", lat: 29.76, lng: -95.37, personnel: 5, eta: "1h 30m" },
  { id: "CREW-TX-31", status: "en_route", location: "Dallas · Sub DAL-03", lat: 32.78, lng: -96.80, personnel: 6, eta: "2h 15m" },
  { id: "CREW-NY-05", status: "standby", location: "NYC · Sub NYC-01", lat: 40.71, lng: -74.01, personnel: 4 },
];

const DEFAULT_EVENTS: EventData[] = [
  { id: "e1", icon: "🔴", timestamp: "14:32:07", title: "ERCOT Issues Grid Emergency Alert", description: "Stage 2 emergency. Load shedding within 4 hours.", severity: "critical", lat: 30.27, lng: -97.74 },
  { id: "e2", icon: "⚡", timestamp: "14:30:44", title: "Crew TX-22 Deployed to Austin", description: "8-person crew on site at Austin metro.", severity: "info", lat: 30.27, lng: -97.74 },
  { id: "e3", icon: "⚠️", timestamp: "14:28:12", title: "Substation WTX-04 at 94% Load", description: "West Texas approaching capacity. Crew on site.", severity: "warning", lat: 31.5, lng: -100.4 },
  { id: "e4", icon: "🌡️", timestamp: "14:25:33", title: "Temperature Drop Accelerating", description: "Austin: -2°F by midnight. Heating demand +18%.", severity: "warning", lat: 30.27, lng: -97.74 },
  { id: "e5", icon: "⚡", timestamp: "14:22:01", title: "Cascade Simulation Updated", description: "New probability: 73% (↑ from 68%). 14 substations at risk.", severity: "critical" },
  { id: "e6", icon: "✅", timestamp: "14:18:45", title: "Crew TX-08 Dispatched to Houston", description: "5-person crew en route. ETA 1h 30m.", severity: "success", lat: 29.76, lng: -95.37 },
  { id: "e7", icon: "⚠️", timestamp: "14:15:20", title: "Wind Generation Dropping", description: "West TX wind farms declining 40% by midnight.", severity: "warning", lat: 31.5, lng: -100.4 },
  { id: "e8", icon: "🟢", timestamp: "14:10:00", title: "Northeast Grid Nominal", description: "PJM/NYISO within normal range.", severity: "success", lat: 40.71, lng: -74.01 },
];

const EXTRA_EVENTS: Omit<EventData, "id">[] = [
  { icon: "⚠️", timestamp: "", title: "Substation ATX-12 Load Rising: 87%", description: "Austin substation approaching threshold.", severity: "warning", lat: 30.27, lng: -97.74 },
  { icon: "🔴", timestamp: "", title: "ERCOT Price Spike: $180/MWh", description: "Real-time pricing surged past $180.", severity: "critical" },
  { icon: "✅", timestamp: "", title: "Crew TX-14 Reports Line Repair Complete", description: "West Texas line TL-7 restored to service.", severity: "success", lat: 31.5, lng: -100.4 },
  { icon: "⚡", timestamp: "", title: "Battery Storage Reserves Engaged", description: "450 MW battery dispatch across ERCOT.", severity: "info" },
  { icon: "⚠️", timestamp: "", title: "Solar Output Declining Faster Than Forecast", description: "Cloud cover reducing generation by 22%.", severity: "warning" },
];

/* ================================================================== */
/*  CONSTANTS                                                          */
/* ================================================================== */
const STATUS_PILL: Record<CrewData["status"], { label: string; bg: string; text: string; border: string }> = {
  deployed: { label: "DEPLOYED", bg: "bg-[#22c55e]/15", text: "text-[#22c55e]", border: "border-[#22c55e]/25" },
  en_route: { label: "EN ROUTE", bg: "bg-[#f59e0b]/15", text: "text-[#f59e0b]", border: "border-[#f59e0b]/25" },
  standby: { label: "STANDBY", bg: "bg-[#3f3f46]/30", text: "text-[#a1a1aa]", border: "border-[#3f3f46]" },
};

const EVENT_BORDER: Record<EventData["severity"], string> = {
  critical: "border-l-[#ef4444]",
  warning: "border-l-[#f59e0b]",
  info: "border-l-[#22c55e]",
  success: "border-l-[#22c55e]",
};

/* ================================================================== */
/*  CREW CARD                                                          */
/* ================================================================== */
function CrewCard({
  crew,
  onFocus,
}: {
  crew: CrewData;
  onFocus: () => void;
}) {
  const pill = STATUS_PILL[crew.status];

  return (
    <button
      onClick={onFocus}
      className="w-full text-left bg-[#0a0a0a] rounded-xl p-5 border border-[#1a1a1a] hover:border-[#22c55e]/40 transition-colors cursor-pointer"
    >
      {/* Top: ID + status */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-mono font-bold text-white">{crew.id}</span>
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${pill.bg} ${pill.text} ${pill.border}`}
        >
          {pill.label}
        </span>
      </div>

      {/* Location — no truncation */}
      <p className="text-sm text-[#a1a1aa] mb-2">{crew.location}</p>

      {/* Bottom: personnel + ETA */}
      <div className="flex items-center gap-3 text-xs text-[#71717a]">
        <span>{crew.personnel} personnel</span>
        {crew.eta && (
          <span className="text-[#f59e0b] font-mono">ETA {crew.eta}</span>
        )}
      </div>
    </button>
  );
}

/* ================================================================== */
/*  EVENT ROW                                                          */
/* ================================================================== */
function EventRow({
  event,
  index,
  isNew,
  isHighlighted,
  onClick,
}: {
  event: EventData;
  index: number;
  isNew: boolean;
  isHighlighted: boolean;
  onClick?: () => void;
}) {
  const borderClass = EVENT_BORDER[event.severity];
  const hasLocation = event.lat != null && event.lng != null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
      onClick={hasLocation ? onClick : undefined}
      className={`rounded-xl p-4 border-l-[3px] ${borderClass} transition-colors ${
        hasLocation ? "cursor-pointer hover:bg-[#151515]" : ""
      } ${isNew ? "ring-1 ring-[#22c55e]/20" : ""} ${
        isHighlighted ? "bg-[#111111]" : "bg-[#0a0a0a]"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-sm leading-none flex-shrink-0 mt-0.5">{event.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3 mb-1">
            {/* Title — allow wrapping, no truncation */}
            <span className="text-sm font-medium text-white leading-snug">
              {event.title}
            </span>
            <span className="text-[10px] font-mono text-[#71717a] flex-shrink-0 mt-0.5">
              {event.timestamp}
            </span>
          </div>
          {/* Description — allow 2 lines, no truncation */}
          <p className="text-xs text-[#a1a1aa] leading-relaxed line-clamp-2">
            {event.description}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

/* ================================================================== */
/*  MAIN COMPONENT                                                     */
/* ================================================================== */
export default function OperatorRightSidebar({
  crews = DEFAULT_CREWS,
  events: initialEvents = DEFAULT_EVENTS,
  crewCoverage = 76,
  onFocusLocation,
}: OperatorRightSidebarProps) {
  const [activeTab, setActiveTab] = useState<"crews" | "feed">("crews");
  const [events, setEvents] = useState(initialEvents);
  const [newestId, setNewestId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const extraIndex = useRef(0);

  // Crew counts
  const deployed = crews.filter((c) => c.status === "deployed").length;
  const enRoute = crews.filter((c) => c.status === "en_route").length;
  const standby = crews.filter((c) => c.status === "standby").length;
  const total = crews.length;

  // Live event injection
  useEffect(() => {
    const interval = setInterval(() => {
      const extra = EXTRA_EVENTS[extraIndex.current % EXTRA_EVENTS.length];
      extraIndex.current += 1;

      const now = new Date();
      const ts = now.toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const newEvent: EventData = {
        ...extra,
        id: `live-${Date.now()}`,
        timestamp: ts,
      };

      setEvents((prev) => [newEvent, ...prev].slice(0, 20));
      setNewestId(newEvent.id);
      setHighlightedId(newEvent.id);

      // Clear glow after 3s
      setTimeout(() => {
        setNewestId((cur) => (cur === newEvent.id ? null : cur));
      }, 3000);

      // Clear highlight after 5s
      setTimeout(() => {
        setHighlightedId((cur) => (cur === newEvent.id ? null : cur));
      }, 5000);
    }, 10_000);

    return () => clearInterval(interval);
  }, []);

  const handleCrewFocus = useCallback(
    (crew: CrewData) => {
      onFocusLocation({ lat: crew.lat, lng: crew.lng, altitude: 1.2 });
    },
    [onFocusLocation]
  );

  const handleEventFocus = useCallback(
    (event: EventData) => {
      if (event.lat != null && event.lng != null) {
        onFocusLocation({ lat: event.lat, lng: event.lng, altitude: 1.4 });
      }
    },
    [onFocusLocation]
  );

  return (
    <aside className="w-96 flex-shrink-0 border-l border-[#1a1a1a] hidden lg:flex flex-col bg-[#0a0a0a] overflow-hidden">
      {/* ============================================================ */}
      {/*  TABS                                                         */}
      {/* ============================================================ */}
      <div className="flex items-center gap-2 p-4 pb-0 flex-shrink-0">
        <button
          onClick={() => setActiveTab("crews")}
          className={`flex-1 h-10 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
            activeTab === "crews"
              ? "border border-[#22c55e]/50 text-[#22c55e] bg-[#22c55e]/[0.06]"
              : "border border-[#3f3f46] text-[#71717a] hover:text-[#a1a1aa] hover:border-[#52525b]"
          }`}
        >
          Crews
        </button>
        <button
          onClick={() => setActiveTab("feed")}
          className={`flex-1 h-10 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
            activeTab === "feed"
              ? "border border-[#22c55e]/50 text-[#22c55e] bg-[#22c55e]/[0.06]"
              : "border border-[#3f3f46] text-[#71717a] hover:text-[#a1a1aa] hover:border-[#52525b]"
          }`}
        >
          Live Feed
        </button>
      </div>

      {/* ============================================================ */}
      {/*  TAB CONTENT                                                  */}
      {/* ============================================================ */}
      {activeTab === "crews" ? (
        <div className="flex flex-col flex-1 min-h-0 p-5">
          {/* Hero stat: Crews Deployed */}
          <div className="flex-shrink-0 mb-5">
            <span className="text-xs uppercase tracking-widest text-[#52525b] font-semibold block mb-3">
              Crews Deployed
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-5xl font-mono font-bold text-[#22c55e] leading-none">
                {deployed + enRoute}
              </span>
              <span className="text-2xl font-mono text-[#3f3f46]">/</span>
              <span className="text-2xl font-mono text-[#71717a]">{total}</span>
            </div>
            <div className="h-2.5 rounded-full bg-[#1a1a1a] overflow-hidden w-full mt-3">
              <div
                className="h-full rounded-full bg-[#22c55e] transition-all duration-1000"
                style={{ width: `${Math.round(crewCoverage)}%` }}
              />
            </div>
            <span className="text-xs text-[#3f3f46] mt-1 block">{Math.round(crewCoverage)}% coverage</span>
          </div>

          {/* Summary bar */}
          <div className="flex-shrink-0 mb-5">
            <div className="flex h-3 rounded-full overflow-hidden gap-px">
              <div
                className="bg-[#22c55e] rounded-l-full"
                style={{ width: `${(deployed / total) * 100}%` }}
              />
              <div
                className="bg-[#f59e0b]"
                style={{ width: `${(enRoute / total) * 100}%` }}
              />
              <div
                className="bg-[#3f3f46] rounded-r-full"
                style={{ width: `${(standby / total) * 100}%` }}
              />
            </div>
            <div className="flex items-center gap-4 mt-2 text-xs text-[#52525b]">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
                Deployed ({deployed})
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#f59e0b]" />
                En Route ({enRoute})
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#3f3f46]" />
                Standby ({standby})
              </span>
            </div>
          </div>

          {/* Crew list */}
          <div
            className="flex-1 overflow-y-auto space-y-4 min-h-0"
            style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}
          >
            {crews.map((crew) => (
              <CrewCard
                key={crew.id}
                crew={crew}
                onFocus={() => handleCrewFocus(crew)}
              />
            ))}
          </div>

          {/* Optimize button — sticky at bottom */}
          <div className="flex-shrink-0 mt-4 space-y-1.5">
            <button className="w-full h-12 rounded-lg bg-[#22c55e] text-white text-sm font-semibold hover:bg-[#16a34a] hover:shadow-[0_0_20px_rgba(34,197,94,0.2)] transition-all cursor-pointer active:scale-[0.98]">
              Optimize All Crews →
            </button>
            <p className="text-[10px] text-[#3f3f46] text-center">
              AI-recommended repositioning based on forecast
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <span className="text-xs uppercase tracking-widest text-[#52525b] font-semibold">
              Event Stream
            </span>
            <div className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full bg-[#22c55e]"
                style={{ animation: "pulse-dot 1.5s ease-in-out infinite" }}
              />
              <span className="text-xs font-mono text-[#22c55e]">LIVE</span>
            </div>
          </div>

          {/* Feed — full sidebar height */}
          <div
            className="flex-1 overflow-y-auto space-y-3 min-h-0"
            style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}
          >
            <AnimatePresence initial={true}>
              {events.map((event, i) => (
                <EventRow
                  key={event.id}
                  event={event}
                  index={i}
                  isNew={event.id === newestId}
                  isHighlighted={event.id === highlightedId}
                  onClick={() => handleEventFocus(event)}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </aside>
  );
}
