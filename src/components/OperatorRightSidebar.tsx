"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  target?: string;
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
  scenario?: string;
  onFocusLocation: (location: { lat: number; lng: number; altitude?: number }) => void;
}

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
  isNewlyDispatched,
}: {
  crew: CrewData;
  onFocus: () => void;
  isNewlyDispatched?: boolean;
}) {
  const pill = STATUS_PILL[crew.status] ?? STATUS_PILL.standby;

  return (
    <motion.button
      layout
      onClick={onFocus}
      initial={isNewlyDispatched ? { scale: 1.03, borderColor: "rgba(34,197,94,0.6)" } : false}
      animate={{ scale: 1, borderColor: "rgba(26,26,26,1)" }}
      transition={{ duration: 0.6 }}
      className={`w-full text-left bg-[#0a0a0a] rounded-xl p-5 border border-[#1a1a1a] hover:border-[#22c55e]/40 transition-colors cursor-pointer ${
        isNewlyDispatched ? "ring-1 ring-[#22c55e]/30" : ""
      }`}
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

      {/* Target assignment */}
      {crew.target && (
        <p className="text-xs text-[#22c55e]/70 font-mono mb-2">
          → {crew.target}
        </p>
      )}

      {/* Bottom: personnel + ETA */}
      <div className="flex items-center gap-3 text-xs text-[#71717a]">
        <span>{crew.personnel} personnel</span>
        {crew.eta && (
          <span className="text-[#f59e0b] font-mono">ETA {crew.eta}</span>
        )}
      </div>
    </motion.button>
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
const SEVERITY_ICONS: Record<string, string> = {
  critical: "🔴",
  emergency: "🔴",
  warning: "⚠️",
  info: "⚡",
  success: "✅",
};

export default function OperatorRightSidebar({
  crews = [],
  events: initialEvents = [],
  crewCoverage = 0,
  scenario,
  onFocusLocation,
}: OperatorRightSidebarProps) {
  const [activeTab, setActiveTab] = useState<"crews" | "feed">("crews");
  const [events, setEvents] = useState(initialEvents);
  const [newestId, setNewestId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<string | null>(null);
  const [dispatchedCrews, setDispatchedCrews] = useState<CrewData[]>([]);
  const [dispatchedIds, setDispatchedIds] = useState<Set<string>>(new Set());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync initial events from parent when they change
  useEffect(() => {
    if (initialEvents.length > 0) setEvents(initialEvents);
  }, [initialEvents]);

  // Crew counts
  // Use dispatch-updated crews if available, otherwise fall back to prop crews
  const displayCrews = dispatchedCrews.length > 0 ? dispatchedCrews : crews;
  const deployed = displayCrews.filter((c) => c.status === "deployed").length;
  const enRoute = displayCrews.filter((c) => c.status === "en_route").length;
  const standby = displayCrews.filter((c) => c.status === "standby").length;
  const total = displayCrews.length;

  // SSE real-time event stream from backend
  useEffect(() => {
    if (!scenario) return;

    const es = new EventSource(`/api/backend/utility/events/stream?scenario=${scenario}`);

    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.done) {
          es.close();
          return;
        }

        const sev = data.severity === "emergency" ? "critical" : (data.severity as EventData["severity"]);
        const totalMin = data.timestamp_offset_minutes ?? 0;
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;

        const newEvent: EventData = {
          id: data.event_id ?? `sse-${Date.now()}`,
          icon: SEVERITY_ICONS[data.severity] ?? "⚡",
          timestamp: `T+${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
          title: data.title,
          description: data.description,
          severity: sev || "info",
        };

        setEvents((prev) => [newEvent, ...prev].slice(0, 30));
        setNewestId(newEvent.id);
        setHighlightedId(newEvent.id);

        setTimeout(() => {
          setNewestId((cur) => (cur === newEvent.id ? null : cur));
        }, 3000);
        setTimeout(() => {
          setHighlightedId((cur) => (cur === newEvent.id ? null : cur));
        }, 5000);
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [scenario]);

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

  // Map backend status to UI status
  const mapCrewStatus = (s: string): CrewData["status"] => {
    if (s === "en_route" || s === "dispatched") return "en_route";
    if (s === "on_site" || s === "repairing" || s === "complete" || s === "deployed") return "deployed";
    return "standby";
  };

  // Fetch dispatch status and update crew list
  const fetchDispatchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/backend/utility/crews/dispatch/status");
      if (!res.ok) return;
      const json = await res.json();
      const statusData = json.data;
      if (!statusData?.crews) return;

      // Build assignment lookup: crew_id → assignment
      const assignmentMap = new Map<string, any>();
      for (const a of statusData.assignments ?? []) {
        assignmentMap.set(a.crew_id, a);
      }

      const updated: CrewData[] = statusData.crews.map((c: any) => {
        const a = assignmentMap.get(c.crew_id);
        const etaMin = c.eta_minutes ?? a?.eta_minutes ?? 0;
        return {
          id: c.crew_id,
          status: mapCrewStatus(c.status),
          location: `${c.city ?? "Unknown"} · ${(c.specialty ?? "general").replace(/_/g, " ")}`,
          lat: c.lat,
          lng: c.lon,
          personnel: 6,
          eta: etaMin > 0 ? `${Math.floor(etaMin / 60)}h ${etaMin % 60}m` : undefined,
          target: a?.target_node_id ?? undefined,
        };
      });

      setDispatchedCrews(updated);
    } catch {
      // ignore
    }
  }, []);

  // Cleanup tick interval on unmount
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const handleOptimizeAll = useCallback(async () => {
    setOptimizing(true);
    setOptimizeResult(null);

    // Stop any existing tick interval
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }

    try {
      // Step 1: Initialize dispatch with current scenario
      const initRes = await fetch(
        `/api/backend/utility/crews/dispatch/init?scenario=${scenario || "uri"}`,
        { method: "POST" }
      );
      if (!initRes.ok) throw new Error(`Init failed: ${initRes.status}`);
      const initData = await initRes.json();
      const failedNodes = initData.data?.failed_nodes ?? 0;

      // Step 2: Dispatch all crews
      const dispatchRes = await fetch("/api/backend/utility/crews/dispatch/all", {
        method: "POST",
      });
      if (!dispatchRes.ok) throw new Error(`Dispatch failed: ${dispatchRes.status}`);
      const result = await dispatchRes.json();
      const assignments = result.data ?? [];

      // Mark dispatched crew IDs for highlight animation
      const ids = new Set<string>(assignments.map((a: any) => a.crew_id));
      setDispatchedIds(ids);
      setTimeout(() => setDispatchedIds(new Set()), 4000);

      setOptimizeResult(`${assignments.length} crews → ${failedNodes} failed nodes`);

      // Immediately fetch updated status
      await fetchDispatchStatus();

      // Start polling tick every 5s to progress crews through state machine
      tickRef.current = setInterval(async () => {
        try {
          await fetch("/api/backend/utility/crews/dispatch/tick", { method: "POST" });
          await fetchDispatchStatus();
        } catch {
          // ignore
        }
      }, 5000);

    } catch (err) {
      console.error("Crew optimization failed:", err);
      setOptimizeResult("Failed — check console");
    } finally {
      setOptimizing(false);
      setTimeout(() => setOptimizeResult(null), 6000);
    }
  }, [scenario, fetchDispatchStatus]);

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
                style={{ width: `${total > 0 ? Math.round(((deployed + enRoute) / total) * 100) : Math.round(crewCoverage)}%` }}
              />
            </div>
            <span className="text-xs text-[#3f3f46] mt-1 block">
              {total > 0 ? Math.round(((deployed + enRoute) / total) * 100) : Math.round(crewCoverage)}% coverage
            </span>
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
            <AnimatePresence mode="popLayout">
              {displayCrews.map((crew) => (
                <CrewCard
                  key={crew.id}
                  crew={crew}
                  onFocus={() => handleCrewFocus(crew)}
                  isNewlyDispatched={dispatchedIds.has(crew.id)}
                />
              ))}
            </AnimatePresence>
          </div>

          {/* Optimize button — sticky at bottom */}
          <div className="flex-shrink-0 mt-4 space-y-1.5">
            <button
              onClick={handleOptimizeAll}
              disabled={optimizing}
              className={`w-full h-12 rounded-lg text-white text-sm font-semibold transition-all cursor-pointer active:scale-[0.98] ${
                optimizing
                  ? "bg-[#22c55e]/50 cursor-wait"
                  : "bg-[#22c55e] hover:bg-[#16a34a] hover:shadow-[0_0_20px_rgba(34,197,94,0.2)]"
              }`}
            >
              {optimizing ? "Optimizing..." : "Optimize All Crews →"}
            </button>
            {optimizeResult ? (
              <p className="text-[10px] text-[#22c55e] text-center font-mono">
                {optimizeResult}
              </p>
            ) : (
              <p className="text-[10px] text-[#3f3f46] text-center">
                AI-recommended repositioning based on forecast
              </p>
            )}
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
