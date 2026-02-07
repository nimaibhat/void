"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
type AlertSeverity = "critical" | "warning" | "optimization" | "resolved";

export interface AlertData {
  id: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  timestamp: string;
  action?: {
    label: string;
    variant: "primary" | "secondary";
  };
}

interface AlertsPanelProps {
  alerts?: AlertData[];
  onAction?: (alertId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Defaults                                                           */
/* ------------------------------------------------------------------ */
const DEFAULT_ALERTS: AlertData[] = [
  {
    id: "1",
    severity: "critical",
    title: "Ice Storm Warning — Austin Metro",
    description:
      "ERCOT grid stress expected Tue 2/10. Cascade risk moderate. Your home is pre-positioned for resilience.",
    timestamp: "now",
    action: { label: "View Details →", variant: "primary" },
  },
  {
    id: "2",
    severity: "optimization",
    title: "Pre-cooling Activated",
    description:
      "Thermostat lowers to 68°F at 3:00 PM to bank thermal energy before price spike. Saves $3.40.",
    timestamp: "2m ago",
    action: { label: "Adjust →", variant: "secondary" },
  },
  {
    id: "3",
    severity: "optimization",
    title: "EV Charge Shifted to 2:00 AM",
    description:
      "Charge moved from 6 PM ($0.18/kWh) to 2 AM (-$0.02/kWh). You'll earn $0.34.",
    timestamp: "5m ago",
    action: { label: "Undo", variant: "secondary" },
  },
  {
    id: "4",
    severity: "warning",
    title: "Extreme Heat — TX South",
    description:
      "SEV 4 heat event in southern Texas. Austin on the boundary. Monitoring for grid impact.",
    timestamp: "15m ago",
    action: { label: "Dismiss", variant: "secondary" },
  },
  {
    id: "5",
    severity: "resolved",
    title: "Battery Reserve Configured",
    description:
      "Powerwall reserve set to 30% for storm backup. Excess discharges during peak pricing.",
    timestamp: "1h ago",
  },
];

/* ------------------------------------------------------------------ */
/*  Severity config                                                    */
/* ------------------------------------------------------------------ */
const SEVERITY_CONFIG: Record<
  AlertSeverity,
  { icon: string; border: string; bg: string; pulseClass?: string }
> = {
  critical: {
    icon: "🔴",
    border: "border-l-[#ef4444]",
    bg: "bg-[rgba(239,68,68,0.05)]",
    pulseClass: "animate-[alert-pulse_2s_ease-in-out_infinite]",
  },
  warning: {
    icon: "⚠️",
    border: "border-l-[#f59e0b]",
    bg: "bg-[rgba(245,158,11,0.05)]",
  },
  optimization: {
    icon: "⚡",
    border: "border-l-[#22c55e]",
    bg: "bg-[rgba(34,197,94,0.05)]",
  },
  resolved: {
    icon: "✅",
    border: "border-l-[#3f3f46]",
    bg: "",
  },
};

/* ------------------------------------------------------------------ */
/*  Filter type                                                        */
/* ------------------------------------------------------------------ */
type FilterKey = "all" | "critical" | "actions" | "resolved";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "critical", label: "Critical" },
  { key: "actions", label: "Actions" },
  { key: "resolved", label: "Resolved" },
];

function filterAlerts(alerts: AlertData[], filter: FilterKey): AlertData[] {
  switch (filter) {
    case "critical":
      return alerts.filter(
        (a) => a.severity === "critical" || a.severity === "warning"
      );
    case "actions":
      return alerts.filter((a) => a.action != null);
    case "resolved":
      return alerts.filter((a) => a.severity === "resolved");
    default:
      return alerts;
  }
}

/* ------------------------------------------------------------------ */
/*  AlertCard                                                          */
/* ------------------------------------------------------------------ */
function AlertCard({
  alert,
  index,
  onAction,
}: {
  alert: AlertData;
  index: number;
  onAction?: (alertId: string) => void;
}) {
  const config = SEVERITY_CONFIG[alert.severity];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.3, delay: index * 0.06 }}
      className={`rounded-lg border-l-[3px] ${config.border} ${config.bg} bg-[#0a0a0a] p-5 ${config.pulseClass ?? ""}`}
    >
      {/* Top row: icon + title + timestamp */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-lg flex-shrink-0 leading-none">{config.icon}</span>
          <span className="text-[15px] font-semibold text-white truncate">
            {alert.title}
          </span>
        </div>
        <span className="text-xs font-mono text-[#71717a] flex-shrink-0 pt-0.5">
          {alert.timestamp}
        </span>
      </div>

      {/* Description */}
      <p className="text-sm text-[#a1a1aa] leading-relaxed mt-2.5 mb-3 line-clamp-2">
        {alert.description}
      </p>

      {/* Action or resolved indicator */}
      {alert.action ? (
        <div className="flex justify-end">
          {alert.action.variant === "primary" ? (
            <button
              onClick={() => onAction?.(alert.id)}
              className="h-10 px-4 rounded-lg bg-[#22c55e] text-white text-sm font-medium hover:bg-[#16a34a] transition-colors cursor-pointer"
            >
              {alert.action.label}
            </button>
          ) : (
            <button
              onClick={() => onAction?.(alert.id)}
              className="h-10 px-4 rounded-lg border border-[#3f3f46] text-[#d4d4d8] text-sm font-medium hover:bg-[#1a1a1a] hover:border-[#52525b] transition-colors cursor-pointer"
            >
              {alert.action.label}
            </button>
          )}
        </div>
      ) : alert.severity === "resolved" ? (
        <div className="flex justify-end">
          <span className="text-xs text-[#71717a]">Resolved</span>
        </div>
      ) : null}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  AlertsPanel                                                        */
/* ------------------------------------------------------------------ */
export default function AlertsPanel({ alerts = DEFAULT_ALERTS, onAction }: AlertsPanelProps) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const filtered = filterAlerts(alerts, activeFilter);

  return (
    <div className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 flex flex-col h-full">
      {/* Header + filters */}
      <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
        <h3 className="text-lg font-semibold text-white">Alerts</h3>
        <div className="flex items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={`rounded-full px-4 py-2 text-sm font-medium border transition-colors cursor-pointer ${
                activeFilter === f.key
                  ? "border-[#22c55e]/50 text-[#22c55e] bg-[#22c55e]/[0.08]"
                  : "border-[#3f3f46] text-[#a1a1aa] hover:border-[#52525b] hover:text-[#d4d4d8]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Alert list */}
      <div
        className="flex-1 overflow-y-auto space-y-3 min-h-0"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(255,255,255,0.08) transparent",
        }}
      >
        <AnimatePresence mode="popLayout">
          {filtered.length > 0 ? (
            filtered.map((alert, i) => (
              <AlertCard key={alert.id} alert={alert} index={i} onAction={onAction} />
            ))
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-16 gap-3"
            >
              <span className="text-2xl opacity-30">🔔</span>
              <span className="text-sm text-[#71717a]">No alerts</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
