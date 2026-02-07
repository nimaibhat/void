//FILE_TOO_LARGE_CREATING_SIMPLIFIED_VERSION
"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  runCascadeSimulation,
  fetchOutcomes,
  type CascadeResult,
  type OutcomeComparison,
} from "@/lib/api";

export interface CascadeOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  scenario?: string;
  forecastHour?: number;
}

export default function CascadeOverlay({ isOpen, onClose, scenario = "uri", forecastHour = 36 }: CascadeOverlayProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CascadeResult | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomeComparison | null>(null);
  const [tab, setTab] = useState<"sim" | "analysis">("sim");

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setTab("sim");
    
    Promise.all([
      runCascadeSimulation(scenario, forecastHour),
      fetchOutcomes(scenario)
    ])
      .then(([cascadeData, outcomesData]) => {
        setResult(cascadeData);
        setOutcomes(outcomesData);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [isOpen, scenario, forecastHour]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center"
        >
          <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ scale: 0.95, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-6xl h-[90vh] mx-4 bg-[#0c0c0c] border border-white/10 rounded-xl overflow-hidden flex flex-col"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-30 w-8 h-8 flex items-center justify-center rounded bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/90 transition-colors text-xl"
            >
              ×
            </button>

            {/* Tabs */}
            <div className="flex gap-2 px-6 pt-6 pb-0 border-b border-white/10">
              <button
                onClick={() => setTab("sim")}
                className={`px-4 py-2 text-sm font-mono font-semibold rounded-t transition-colors ${
                  tab === "sim"
                    ? "bg-[#22c55e]/10 text-[#22c55e] border-b-2 border-[#22c55e]"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                Cascade Simulation
              </button>
              <button
                onClick={() => setTab("analysis")}
                className={`px-4 py-2 text-sm font-mono font-semibold rounded-t transition-colors ${
                  tab === "analysis"
                    ? "bg-[#22c55e]/10 text-[#22c55e] border-b-2 border-[#22c55e]"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                Impact Analysis
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6">
              {loading && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="w-12 h-12 border-4 border-[#22c55e]/20 border-t-[#22c55e] rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-sm font-mono text-white/50">Running simulation...</p>
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-center justify-center h-full">
                  <div className="max-w-md p-6 bg-red-500/10 border border-red-500/30 rounded">
                    <p className="text-sm font-mono text-red-400">{error}</p>
                  </div>
                </div>
              )}

              {!loading && !error && result && tab === "sim" && (
                <div className="space-y-6">
                  <div className="grid grid-cols-4 gap-4">
                    <StatCard label="Total Nodes" value={result.total_nodes.toLocaleString()} />
                    <StatCard label="Failed Nodes" value={result.total_failed_nodes.toLocaleString()} color="red" />
                    <StatCard label="Cascade Depth" value={result.cascade_depth.toString()} />
                    <StatCard label="Load Shed" value={`${result.total_load_shed_mw.toFixed(0)} MW`} />
                  </div>

                  <div className="bg-white/5 border border-white/10 rounded-lg p-6">
                    <h3 className="text-sm font-mono font-bold text-white/80 mb-4">Cascade Steps</h3>
                    <div className="space-y-2 max-h-[400px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                      {result.steps.map((step, i) => (
                        <div key={i} className="p-3 bg-white/5 rounded border border-white/5">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-mono text-white/60">Step {step.step + 1}</span>
                            <span className="text-xs font-mono text-red-400">{step.new_failures.length} new failures</span>
                          </div>
                          <div className="text-xs font-mono text-white/40">
                            Total failed: {step.total_failed} • Load shed: {step.total_load_shed_mw.toFixed(0)} MW
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {!loading && !error && outcomes && tab === "analysis" && (
                <div className="space-y-6">
                  <div className="text-center mb-6">
                    <h2 className="text-lg font-mono font-bold text-white/90">Impact Analysis</h2>
                    <p className="text-xs font-mono text-white/40 mt-1">{scenario} scenario • ERCOT grid</p>
                  </div>

                  <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <h3 className="text-sm font-mono font-bold text-red-400 uppercase text-center">Without Blackout</h3>
                      <MetricCard label="Nodes Failed" value={outcomes.without_blackout.failed_nodes} />
                      <MetricCard label="Cascade Steps" value={outcomes.without_blackout.cascade_steps} />
                      <MetricCard label="Peak Price" value={`$${outcomes.without_blackout.peak_price_mwh}/MWh`} />
                      <MetricCard label="Customers Affected" value={(outcomes.without_blackout.total_affected_customers / 1e6).toFixed(2) + "M"} />
                    </div>

                    <div className="space-y-4">
                      <h3 className="text-sm font-mono font-bold text-[#22c55e] uppercase text-center">With Blackout</h3>
                      <MetricCard label="Nodes Failed" value={outcomes.with_blackout.failed_nodes} color="green" />
                      <MetricCard label="Cascade Steps" value={outcomes.with_blackout.cascade_steps} color="green" />
                      <MetricCard label="Peak Price" value={`$${outcomes.with_blackout.peak_price_mwh}/MWh`} color="green" />
                      <MetricCard label="Customers Affected" value={(outcomes.with_blackout.total_affected_customers / 1e6).toFixed(2) + "M"} color="green" />
                    </div>
                  </div>

                  <div className="mt-8 p-6 bg-[#22c55e]/10 border border-[#22c55e]/30 rounded-lg">
                    <div className="grid grid-cols-3 gap-6 text-center">
                      <div>
                        <div className="text-2xl font-mono font-bold text-[#22c55e]">
                          {outcomes.customers_saved.toLocaleString()}
                        </div>
                        <div className="text-xs font-mono text-white/60 mt-1">Customers Saved</div>
                      </div>
                      <div>
                        <div className="text-2xl font-mono font-bold text-[#22c55e]">
                          {outcomes.price_reduction_pct.toFixed(0)}%
                        </div>
                        <div className="text-xs font-mono text-white/60 mt-1">Price Reduction</div>
                      </div>
                      <div>
                        <div className="text-2xl font-mono font-bold text-[#22c55e]">
                          {outcomes.cascade_reduction_pct.toFixed(0)}%
                        </div>
                        <div className="text-xs font-mono text-white/60 mt-1">Cascade Reduction</div>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={onClose}
                    className="w-full py-3 text-sm font-mono font-semibold text-white/90 bg-[#22c55e]/10 hover:bg-[#22c55e]/20 border border-[#22c55e]/40 rounded-lg transition-colors"
                  >
                    Return to Dashboard →
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StatCard({ label, value, color = "white" }: { label: string; value: string; color?: string }) {
  const colors = {
    white: "text-white/90",
    red: "text-red-400",
    green: "text-[#22c55e]",
  };
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-4">
      <p className="text-xs font-mono text-white/40 mb-1">{label}</p>
      <p className={`text-2xl font-mono font-bold ${colors[color as keyof typeof colors]}`}>{value}</p>
    </div>
  );
}

function MetricCard({ label, value, color = "red" }: { label: string; value: string | number; color?: string }) {
  const textColor = color === "green" ? "text-[#22c55e]" : "text-red-400";
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-4 text-center">
      <p className="text-xs font-mono text-white/40 mb-2">{label}</p>
      <p className={`text-3xl font-mono font-bold ${textColor}`}>{value}</p>
    </div>
  );
}
