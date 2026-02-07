"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface OperatorEntryModalProps {
  isOpen: boolean;
  onSubmit: (zipcode: string, scenario: string) => void;
}

const SCENARIOS = [
  {
    id: "uri",
    label: "winter storm uri",
    desc: "feb 13-17, 2021 — worst grid crisis in ercot history",
    badge: "CRITICAL",
    badgeColor: "text-red-400/70",
    icon: "🔴",
  },
  {
    id: "live",
    label: "live ai forecast",
    desc: "real-time open-meteo weather → ml demand model → cascade probability",
    badge: "AI",
    badgeColor: "text-[#3b82f6]/70",
    icon: "🔵",
  },
  {
    id: "normal",
    label: "normal operations",
    desc: "baseline feb 2021 conditions — typical winter load",
    badge: "NOMINAL",
    badgeColor: "text-[#22c55e]/70",
    icon: "🟢",
  },
];

/* Texas zip code → ERCOT weather zone (approximate) */
const ZIP_REGIONS: Record<string, { zone: string; lat: number; lng: number }> = {
  "77": { zone: "Coast", lat: 29.76, lng: -95.37 },
  "75": { zone: "North Central", lat: 32.78, lng: -96.80 },
  "76": { zone: "North Central", lat: 32.45, lng: -97.35 },
  "78": { zone: "South Central", lat: 30.27, lng: -97.74 },
  "79": { zone: "Far West", lat: 31.99, lng: -102.08 },
  "73": { zone: "North", lat: 34.0, lng: -97.0 },
  "88": { zone: "Far West", lat: 31.76, lng: -106.44 },
};

export function getRegionFromZip(zip: string): { zone: string; lat: number; lng: number } {
  const prefix = zip.substring(0, 2);
  return ZIP_REGIONS[prefix] || { zone: "South Central", lat: 30.27, lng: -97.74 };
}

export default function OperatorEntryModal({ isOpen, onSubmit }: OperatorEntryModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [zip, setZip] = useState("");
  const [scenario, setScenario] = useState("uri");

  // ESC to close (submit with defaults)
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSubmit(zip || "78701", scenario);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, zip, scenario, onSubmit]);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setZip("");
      setScenario("uri");
    }
  }, [isOpen]);

  // Focus trap
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;
    const modal = modalRef.current;
    const focusable = modal.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first.focus();
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    modal.addEventListener("keydown", handleTab);
    return () => modal.removeEventListener("keydown", handleTab);
  }, [isOpen]);

  const regionHint = zip.length >= 2 ? getRegionFromZip(zip).zone : null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[100] flex items-center justify-center"
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

          {/* Terminal modal */}
          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.3 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-xl mx-4 max-h-[90vh] flex flex-col bg-[#0c0c0c] border border-white/[0.1] rounded-xl overflow-hidden shadow-[0_0_60px_rgba(0,0,0,0.8)]"
          >
            {/* Scanline overlay */}
            <div
              className="absolute inset-0 pointer-events-none z-20"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(34,197,94,0.012) 2px, rgba(34,197,94,0.012) 4px)",
              }}
            />

            {/* Terminal header bar */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06] flex-shrink-0">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
              </div>
              <span className="text-[11px] font-mono text-white/30 ml-2">
                operator@void
              </span>
            </div>

            {/* Scrollable content */}
            <div
              className="flex-1 overflow-y-auto px-7 py-6 space-y-5"
              style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}
            >
              {/* Prompt heading */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
              >
                <p className="text-[15px] font-mono font-bold text-white/90">
                  <span className="text-[#22c55e]">$</span> initialize console
                </p>
                <p className="text-[12px] font-mono text-white/35 mt-1">
                  enter your location and select a scenario to load grid data
                </p>
              </motion.div>

              {/* Zip code input */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
              >
                <p className="text-[11px] font-mono text-white/30 mb-2">zip code:</p>
                <div
                  className={`flex items-center gap-2 border rounded-lg px-5 py-3.5 transition-colors ${
                    zip.length > 0
                      ? "border-[#22c55e]/30 bg-[#22c55e]/[0.03]"
                      : "border-white/[0.08] bg-white/[0.02]"
                  }`}
                >
                  <span className="text-[13px] font-mono font-bold text-[#22c55e]/60">
                    {">"}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={zip}
                    onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSubmit(zip || "78701", scenario);
                    }}
                    placeholder="78701"
                    className="flex-1 bg-transparent text-[13px] font-mono text-white/70 placeholder:text-white/20 focus:outline-none"
                  />
                  {regionHint && (
                    <span className="text-[10px] font-mono text-[#22c55e]/50">
                      → {regionHint.toLowerCase()}
                    </span>
                  )}
                </div>
                <p className="text-[10px] font-mono text-white/20 mt-1.5">
                  texas zip codes will auto-center the map on your region
                </p>
              </motion.div>

              {/* Scenario selection */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <p className="text-[11px] font-mono text-white/30 mb-2">
                  select scenario:
                </p>
                <div className="space-y-3">
                  {SCENARIOS.map((s, i) => (
                    <motion.button
                      key={s.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: 0.25 + i * 0.06 }}
                      onClick={() => setScenario(s.id)}
                      className={`w-full text-left rounded-lg border px-6 py-5 cursor-pointer transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#22c55e]/50 focus:ring-offset-2 focus:ring-offset-[#0c0c0c] ${
                        scenario === s.id
                          ? "border-[#22c55e]/50 bg-[#22c55e]/[0.06] shadow-[0_0_20px_rgba(34,197,94,0.1)]"
                          : "border-white/[0.08] bg-white/[0.02] hover:border-[#22c55e]/30 hover:bg-white/[0.04]"
                      }`}
                    >
                      <div className="flex items-center gap-3 mb-1.5">
                        <span className="text-sm">{s.icon}</span>
                        <span className="text-[13px] font-mono font-bold text-white/90">
                          {s.label}
                        </span>
                        <span className={`ml-auto text-[9px] font-mono font-semibold ${s.badgeColor}`}>
                          {s.badge}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-white/45 pl-7">
                        {s.desc}
                      </p>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            </div>

            {/* Bottom launch bar */}
            <div className="flex-shrink-0 border-t border-white/[0.06] px-7 py-5">
              <button
                onClick={() => onSubmit(zip || "78701", scenario)}
                className="w-full font-mono text-[13px] tracking-widest uppercase rounded-lg py-3.5 transition-all duration-300 cursor-pointer border border-[#22c55e]/40 text-[#22c55e] bg-[#22c55e]/[0.06] hover:bg-[#22c55e]/[0.14] hover:border-[#22c55e]/60 hover:shadow-[0_0_20px_rgba(34,197,94,0.15)]"
              >
                launch
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
