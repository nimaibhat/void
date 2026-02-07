"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */
interface DemandRow {
  period: string;
  value: string;
}

interface GenRow {
  period: string;
  fueltype: string;
  value: string;
}

interface HourlyGen {
  period: string;
  hour: number;
  NG: number;
  COL: number;
  WND: number;
  NUC: number;
  SUN: number;
  WAT: number;
  OTH: number;
  total: number;
}

interface EiaDataPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/* ================================================================== */
/*  CONSTANTS                                                          */
/* ================================================================== */
const FUEL_COLORS: Record<string, string> = {
  NG: "#f59e0b",
  COL: "#71717a",
  WND: "#22c55e",
  NUC: "#8b5cf6",
  SUN: "#eab308",
  WAT: "#3b82f6",
  OTH: "#52525b",
};

const FUEL_LABELS: Record<string, string> = {
  NG: "Natural Gas",
  COL: "Coal",
  WND: "Wind",
  NUC: "Nuclear",
  SUN: "Solar",
  WAT: "Hydro",
  OTH: "Other",
};

function parsePeriodHour(period: string): number {
  // "2021-02-10T00" → hours since start
  const match = period.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})/);
  if (!match) return 0;
  const day = parseInt(match[3]);
  const hour = parseInt(match[4]);
  return (day - 10) * 24 + hour;
}

function formatDate(period: string): string {
  const match = period.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})/);
  if (!match) return period;
  return `Feb ${match[3]} ${match[4]}:00`;
}

/* ================================================================== */
/*  MINI SPARKLINE BAR CHART                                           */
/* ================================================================== */
function StackedBar({
  data,
  demand,
  maxVal,
  index,
  isUriPeak,
}: {
  data: HourlyGen;
  demand: number;
  maxVal: number;
  index: number;
  isUriPeak: boolean;
}) {
  const fuels = ["NG", "COL", "WND", "NUC", "SUN", "WAT", "OTH"] as const;
  const barHeight = 140;
  let y = 0;

  return (
    <div className="flex flex-col items-center group relative" style={{ width: 3 }}>
      <svg width={3} height={barHeight} className="overflow-visible">
        {fuels.map((f) => {
          const val = data[f] || 0;
          const h = maxVal > 0 ? (val / maxVal) * barHeight : 0;
          const segment = (
            <rect
              key={f}
              x={0}
              y={barHeight - y - h}
              width={3}
              height={Math.max(h, 0)}
              fill={FUEL_COLORS[f]}
              opacity={0.85}
            />
          );
          y += h;
          return segment;
        })}
        {/* Demand line marker */}
        {demand > 0 && (
          <line
            x1={-1}
            x2={4}
            y1={barHeight - (demand / maxVal) * barHeight}
            y2={barHeight - (demand / maxVal) * barHeight}
            stroke="#ef4444"
            strokeWidth={1.5}
            opacity={0.8}
          />
        )}
      </svg>
      {isUriPeak && (
        <div className="w-1 h-1 rounded-full bg-[#ef4444] mt-0.5" />
      )}
    </div>
  );
}

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */
export default function EiaDataPanel({ isOpen, onClose }: EiaDataPanelProps) {
  const [demand, setDemand] = useState<DemandRow[]>([]);
  const [generation, setGeneration] = useState<GenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);

  /* ---- Fetch EIA data from Supabase ---- */
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);

    Promise.all([
      supabase
        .from("eia_demand")
        .select("period, value")
        .eq("respondent", "TEX")
        .order("period"),
      supabase
        .from("eia_generation")
        .select("period, fueltype, value")
        .eq("respondent", "TEX")
        .order("period"),
    ]).then(([demandRes, genRes]) => {
      if (demandRes.data) setDemand(demandRes.data);
      if (genRes.data) setGeneration(genRes.data);
      setLoading(false);
    });
  }, [isOpen]);

  /* ---- Process data ---- */
  const { hourlyGen, demandMap, maxVal, peakDemandHour, minGenHour } = useMemo(() => {
    const genByPeriod: Record<string, Record<string, number>> = {};
    for (const row of generation) {
      if (!genByPeriod[row.period]) genByPeriod[row.period] = {};
      genByPeriod[row.period][row.fueltype] = Number(row.value);
    }

    const demandMap: Record<string, number> = {};
    let peakDemand = 0;
    let peakDemandPeriod = "";
    for (const row of demand) {
      const v = Number(row.value);
      demandMap[row.period] = v;
      if (v > peakDemand) {
        peakDemand = v;
        peakDemandPeriod = row.period;
      }
    }

    const periods = [...new Set([...Object.keys(genByPeriod), ...Object.keys(demandMap)])].sort();
    let maxVal = 0;
    let minGenVal = Infinity;
    let minGenPeriod = "";

    const hourlyGen: HourlyGen[] = periods.map((p) => {
      const g = genByPeriod[p] || {};
      const total =
        (g.NG || 0) + (g.COL || 0) + (g.WND || 0) + (g.NUC || 0) + (g.SUN || 0) + (g.WAT || 0) + (g.OTH || 0);
      const d = demandMap[p] || 0;
      maxVal = Math.max(maxVal, total, d);
      if (total > 0 && total < minGenVal) {
        minGenVal = total;
        minGenPeriod = p;
      }
      return {
        period: p,
        hour: parsePeriodHour(p),
        NG: g.NG || 0,
        COL: g.COL || 0,
        WND: g.WND || 0,
        NUC: g.NUC || 0,
        SUN: g.SUN || 0,
        WAT: g.WAT || 0,
        OTH: g.OTH || 0,
        total,
      };
    });

    return {
      hourlyGen,
      demandMap,
      maxVal: maxVal * 1.05,
      peakDemandHour: parsePeriodHour(peakDemandPeriod),
      minGenHour: parsePeriodHour(minGenPeriod),
    };
  }, [demand, generation]);

  /* ---- Stats ---- */
  const peakDemand = Math.max(...demand.map((d) => Number(d.value)), 0);
  const minGen = hourlyGen.length > 0 ? Math.min(...hourlyGen.filter((h) => h.total > 0).map((h) => h.total)) : 0;
  const maxGap = hourlyGen.reduce((max, h) => {
    const d = demandMap[h.period] || 0;
    const gap = d - h.total;
    return gap > max ? gap : max;
  }, 0);

  const selectedData = selectedHour !== null ? hourlyGen[selectedHour] : null;
  const selectedDemand = selectedData ? demandMap[selectedData.period] || 0 : 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.3 }}
            className="w-full max-w-4xl bg-[#111111] border border-[#1a1a1a] rounded-2xl p-8 shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold text-white tracking-tight">
                  EIA-930 Grid Data — Winter Storm Uri
                </h2>
                <p className="text-sm text-[#52525b] mt-1">
                  Feb 10–23, 2021 · Hourly ERCOT demand & generation by fuel
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-10 h-10 rounded-lg border border-[#3f3f46] flex items-center justify-center text-[#a1a1aa] hover:text-white hover:border-[#52525b] transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="w-4 h-4 rounded-full bg-[#22c55e] animate-pulse" />
              </div>
            ) : (
              <>
                {/* Key stats */}
                <div className="grid grid-cols-3 gap-4 mb-8">
                  <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-5">
                    <span className="text-xs uppercase tracking-widest text-[#52525b] font-semibold block mb-2">
                      Peak Demand
                    </span>
                    <span className="text-3xl font-mono font-bold text-[#ef4444]">
                      {(peakDemand / 1000).toFixed(1)}
                    </span>
                    <span className="text-sm text-[#52525b] ml-1">GW</span>
                  </div>
                  <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-5">
                    <span className="text-xs uppercase tracking-widest text-[#52525b] font-semibold block mb-2">
                      Min Generation
                    </span>
                    <span className="text-3xl font-mono font-bold text-[#f59e0b]">
                      {(minGen / 1000).toFixed(1)}
                    </span>
                    <span className="text-sm text-[#52525b] ml-1">GW</span>
                  </div>
                  <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-5">
                    <span className="text-xs uppercase tracking-widest text-[#52525b] font-semibold block mb-2">
                      Max Supply Gap
                    </span>
                    <span className="text-3xl font-mono font-bold text-[#dc2626]">
                      {(maxGap / 1000).toFixed(1)}
                    </span>
                    <span className="text-sm text-[#52525b] ml-1">GW</span>
                  </div>
                </div>

                {/* Chart area */}
                <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-6 mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs uppercase tracking-widest text-[#52525b] font-semibold">
                      Generation by Fuel vs Demand
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-0.5 bg-[#ef4444] inline-block" />
                      <span className="text-[10px] text-[#71717a]">Demand</span>
                    </div>
                  </div>

                  {/* Stacked bars */}
                  <div
                    className="flex items-end gap-px overflow-x-auto"
                    style={{ height: 160, scrollbarWidth: "none" }}
                  >
                    {hourlyGen.map((h, i) => {
                      const d = demandMap[h.period] || 0;
                      const isUriPeak = h.hour >= 108 && h.hour <= 156; // Feb 14-16
                      return (
                        <div
                          key={h.period}
                          className="cursor-pointer"
                          onMouseEnter={() => setSelectedHour(i)}
                          onMouseLeave={() => setSelectedHour(null)}
                        >
                          <StackedBar
                            data={h}
                            demand={d}
                            maxVal={maxVal}
                            index={i}
                            isUriPeak={isUriPeak}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* X-axis labels */}
                  <div className="flex justify-between mt-2 text-[10px] font-mono text-[#3f3f46]">
                    <span>Feb 10</span>
                    <span>Feb 13</span>
                    <span>Feb 15</span>
                    <span>Feb 17</span>
                    <span>Feb 20</span>
                    <span>Feb 23</span>
                  </div>

                  {/* Hover detail */}
                  {selectedData && (
                    <div className="mt-4 pt-4 border-t border-[#1a1a1a]">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-mono text-white">
                          {formatDate(selectedData.period)}
                        </span>
                        <span className="text-xs text-[#52525b]">
                          Gap:{" "}
                          <span className={selectedDemand > selectedData.total ? "text-[#ef4444]" : "text-[#22c55e]"}>
                            {((selectedDemand - selectedData.total) / 1000).toFixed(1)} GW
                          </span>
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-3">
                        {(["NG", "COL", "WND", "NUC"] as const).map((f) => (
                          <div key={f} className="flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                              style={{ backgroundColor: FUEL_COLORS[f] }}
                            />
                            <span className="text-xs text-[#71717a]">{FUEL_LABELS[f]}</span>
                            <span className="text-xs font-mono text-white ml-auto">
                              {(selectedData[f] / 1000).toFixed(1)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Fuel legend */}
                <div className="flex flex-wrap gap-4">
                  {Object.entries(FUEL_LABELS).map(([key, label]) => (
                    <div key={key} className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-sm"
                        style={{ backgroundColor: FUEL_COLORS[key] }}
                      />
                      <span className="text-xs text-[#71717a]">{label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
