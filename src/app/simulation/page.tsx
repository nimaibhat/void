"use client";

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface PayoutRecord {
  id: string;
  amount: string;
  txHash: string;
  timestamp: string;
}

interface Household {
  id: string;
  name: string;
  isReal: boolean;
  hvac: { currentTemp: number; setpoint: number; mode: string };
  credits: number;
  totalParticipations: number;
  xrplWallet: { address: string; seed: string; trustLineCreated: boolean } | null;
  savingsUSD_pending: number;
  savingsUSD_paid: number;
  payouts: PayoutRecord[];
}

interface GridEvent {
  id: string;
  type: string;
  title: string;
  description: string;
  severity: string;
  icon: string;
  timestamp: string;
  active: boolean;
  notificationTitle: string;
  notificationBody: string;
}

interface Recommendation {
  id: string;
  eventId: string;
  eventType: string;
  householdId: string;
  currentSetpoint: number;
  recommendedSetpoint: number;
  estimatedCredits: number;
  estimatedSavingsUSD: number;
  reason: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED";
  respondedAt: string | null;
}

type EventType =
  | "DEMAND_REDUCTION"
  | "PRICE_SPIKE"
  | "HEAT_WAVE"
  | "COLD_SNAP"
  | "RENEWABLE_SURPLUS";

type Phase = "idle" | "notification" | "accepted" | "declined";

/* ------------------------------------------------------------------ */
/*  Scenario definitions                                               */
/* ------------------------------------------------------------------ */
const SCENARIOS: {
  type: EventType;
  label: string;
  icon: string;
  desc: string;
  colorClass: string;
}[] = [
  {
    type: "DEMAND_REDUCTION",
    label: "Grid Overload",
    icon: "⚡",
    desc: "Grid at 95% capacity",
    colorClass: "from-orange-500/20 to-orange-600/5 border-orange-400/30",
  },
  {
    type: "PRICE_SPIKE",
    label: "Price Spike",
    icon: "💰",
    desc: "Electricity at $0.45/kWh",
    colorClass: "from-amber-500/20 to-amber-600/5 border-amber-400/30",
  },
  {
    type: "HEAT_WAVE",
    label: "Heat Wave",
    icon: "🔥",
    desc: "105°F incoming",
    colorClass: "from-red-500/20 to-red-600/5 border-red-400/30",
  },
  {
    type: "COLD_SNAP",
    label: "Cold Snap",
    icon: "❄️",
    desc: "Extreme cold warning",
    colorClass: "from-blue-400/20 to-blue-500/5 border-blue-400/30",
  },
  {
    type: "RENEWABLE_SURPLUS",
    label: "Green Energy",
    icon: "🌱",
    desc: "Free solar/wind surplus",
    colorClass: "from-emerald-500/20 to-emerald-600/5 border-emerald-400/30",
  },
];

const SEVERITY_PULSE: Record<string, string> = {
  LOW: "shadow-emerald-500/20",
  MEDIUM: "shadow-amber-500/20",
  HIGH: "shadow-orange-500/30",
  CRITICAL: "shadow-red-500/40",
};

/* ------------------------------------------------------------------ */
/*  Thermostat Ring                                                    */
/* ------------------------------------------------------------------ */
function ThermostatRing({
  temp,
  setpoint,
  mode,
  animating,
}: {
  temp: number;
  setpoint: number;
  mode: string;
  animating: boolean;
}) {
  // Map setpoint (15–25) to a 0–1 range for the ring
  const fraction = (setpoint - 15) / 10;
  const circumference = 2 * Math.PI * 54;
  const color =
    mode === "OFF"
      ? "#666"
      : mode === "COOL"
      ? "#60a5fa"
      : "#22c55e";

  return (
    <div className="relative w-40 h-40 mx-auto">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
        {/* Track */}
        <circle
          cx="60"
          cy="60"
          r="54"
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth="4"
        />
        {/* Active ring */}
        <motion.circle
          cx="60"
          cy="60"
          r="54"
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          animate={{
            strokeDashoffset: circumference * (1 - fraction),
          }}
          transition={{ duration: animating ? 1.2 : 0.3, ease: "easeInOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          className="text-[36px] font-mono font-bold"
          style={{ color }}
          key={setpoint}
          initial={animating ? { scale: 1.3, opacity: 0 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          {setpoint}°
        </motion.span>
        <span className="text-[10px] font-mono text-white/25 -mt-1">
          {temp}°C current
        </span>
        <span
          className="text-[8px] font-mono uppercase tracking-widest mt-1"
          style={{ color: mode === "OFF" ? "#666" : "rgba(255,255,255,0.3)" }}
        >
          {mode}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  iOS-style notification                                             */
/* ------------------------------------------------------------------ */
function IOSNotification({
  event,
  rec,
  onAccept,
  onDecline,
}: {
  event: GridEvent;
  rec: Recommendation;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <motion.div
      initial={{ y: -80, opacity: 0, scale: 0.95 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: -60, opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", damping: 24, stiffness: 300 }}
      className={`w-full max-w-md mx-auto rounded-2xl border backdrop-blur-xl overflow-hidden ${
        SEVERITY_PULSE[event.severity] ?? ""
      }`}
      style={{
        background: "rgba(30, 30, 30, 0.92)",
        borderColor: "rgba(255,255,255,0.12)",
        boxShadow: `0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)`,
      }}
    >
      {/* Header bar */}
      <div className="flex items-center gap-2.5 px-4 pt-3 pb-1">
        <div className="w-7 h-7 rounded-lg bg-[#22c55e]/20 flex items-center justify-center">
          <span className="text-[14px]">{event.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[11px] font-semibold text-white/80 block">
            Blackout
          </span>
          <span className="text-[9px] text-white/30">now</span>
        </div>
        <span
          className={`text-[8px] font-mono font-bold px-2 py-0.5 rounded-full ${
            event.severity === "CRITICAL"
              ? "bg-red-500/20 text-red-400"
              : event.severity === "HIGH"
              ? "bg-orange-500/20 text-orange-400"
              : event.severity === "MEDIUM"
              ? "bg-amber-500/20 text-amber-400"
              : "bg-emerald-500/20 text-emerald-400"
          }`}
        >
          {event.severity}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <p className="text-[13px] font-semibold text-white/90 leading-tight mb-1.5">
          {event.notificationTitle}
        </p>
        <p className="text-[11px] text-white/50 leading-relaxed">
          {rec.reason}
        </p>
      </div>

      {/* Adjustment preview */}
      <div className="mx-4 mb-3 rounded-xl bg-white/[0.04] p-3 flex items-center justify-between">
        <div className="text-center flex-1">
          <span className="text-[8px] font-mono text-white/25 block">
            CURRENT
          </span>
          <span className="text-[20px] font-mono font-bold text-white/40">
            {rec.currentSetpoint}°C
          </span>
        </div>
        <motion.div
          className="mx-3"
          animate={{ x: [0, 6, 0] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
        >
          <span className="text-[16px] text-[#22c55e]/60">→</span>
        </motion.div>
        <div className="text-center flex-1">
          <span className="text-[8px] font-mono text-white/25 block">
            RECOMMENDED
          </span>
          <span className="text-[20px] font-mono font-bold text-[#22c55e]">
            {rec.recommendedSetpoint}°C
          </span>
        </div>
        <div className="text-center flex-1 border-l border-white/[0.06] pl-3 ml-3">
          <span className="text-[8px] font-mono text-white/25 block">
            EARN
          </span>
          <span className="text-[20px] font-mono font-bold text-amber-400">
            +{rec.estimatedCredits}
          </span>
          <span className="text-[7px] font-mono text-white/20 block -mt-0.5">
            credits
          </span>
          {rec.estimatedSavingsUSD > 0 && (
            <span className="text-[8px] font-mono text-purple-400/60 block mt-1">
              +${rec.estimatedSavingsUSD.toFixed(2)} RLUSD
            </span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="border-t border-white/[0.08] flex">
        <button
          onClick={onDecline}
          className="flex-1 py-3 text-[13px] font-semibold text-white/40 hover:text-white/60 hover:bg-white/[0.03] transition-all cursor-pointer border-r border-white/[0.08]"
        >
          Decline
        </button>
        <button
          onClick={onAccept}
          className="flex-1 py-3 text-[13px] font-semibold text-[#22c55e] hover:bg-[#22c55e]/[0.06] transition-all cursor-pointer"
        >
          Accept
        </button>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Success toast                                                      */
/* ------------------------------------------------------------------ */
function SuccessToast({
  setpoint,
  credits,
  savingsUSD,
}: {
  setpoint: number;
  credits: number;
  savingsUSD?: number;
}) {
  return (
    <motion.div
      initial={{ y: -40, opacity: 0, scale: 0.95 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: -30, opacity: 0, scale: 0.95 }}
      className="w-full max-w-md mx-auto rounded-2xl border border-[#22c55e]/20 overflow-hidden"
      style={{
        background: "rgba(20, 40, 25, 0.92)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.4), 0 0 40px rgba(34,197,94,0.08)",
      }}
    >
      <div className="p-5 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", damping: 10, delay: 0.1 }}
          className="w-12 h-12 rounded-full bg-[#22c55e]/20 mx-auto mb-3 flex items-center justify-center"
        >
          <span className="text-[24px]">✓</span>
        </motion.div>
        <p className="text-[14px] font-semibold text-[#22c55e] mb-1">
          Thermostat Adjusted
        </p>
        <p className="text-[11px] text-white/40">
          Set to <span className="font-bold text-white/60">{setpoint}°C</span>{" "}
          · Earned{" "}
          <span className="font-bold text-amber-400">+{credits} credits</span>
        </p>
        {savingsUSD !== undefined && savingsUSD > 0 && (
          <p className="text-[10px] text-purple-400/60 mt-1">
            💰 +${savingsUSD.toFixed(2)} energy savings → RLUSD pending
          </p>
        )}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Decline toast                                                      */
/* ------------------------------------------------------------------ */
function DeclineToast() {
  return (
    <motion.div
      initial={{ y: -40, opacity: 0, scale: 0.95 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: -30, opacity: 0, scale: 0.95 }}
      className="w-full max-w-md mx-auto rounded-2xl border border-white/[0.08] overflow-hidden"
      style={{
        background: "rgba(30, 30, 30, 0.92)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
      }}
    >
      <div className="p-5 text-center">
        <p className="text-[13px] text-white/40">
          Recommendation declined. No changes made.
        </p>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  History entry                                                      */
/* ------------------------------------------------------------------ */
function HistoryEntry({ rec, event }: { rec: Recommendation; event?: GridEvent }) {
  const icon = event?.icon ?? "📋";
  const severity = event?.severity ?? "";
  const ts = rec.respondedAt
    ? new Date(rec.respondedAt).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/[0.04] last:border-0">
      <span className="text-[14px] mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-white/50">
            {rec.currentSetpoint}°C → {rec.recommendedSetpoint}°C
          </span>
          <span
            className={`text-[8px] font-mono font-bold ${
              rec.status === "ACCEPTED"
                ? "text-[#22c55e]"
                : rec.status === "DECLINED"
                ? "text-red-400/50"
                : "text-white/20"
            }`}
          >
            {rec.status}
          </span>
          {severity && (
            <span className="text-[7px] font-mono text-white/15">
              {severity}
            </span>
          )}
        </div>
        <p className="text-[9px] font-mono text-white/20 leading-relaxed mt-0.5 truncate">
          {rec.reason}
        </p>
      </div>
      <span className="text-[8px] font-mono text-white/15 mt-1">{ts}</span>
      {rec.status === "ACCEPTED" && (
        <div className="text-right mt-0.5">
          <span className="text-[9px] font-mono text-amber-400 font-bold block">
            +{rec.estimatedCredits}
          </span>
          {rec.estimatedSavingsUSD > 0 && (
            <span className="text-[7px] font-mono text-purple-400/50 block">
              +${rec.estimatedSavingsUSD.toFixed(2)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */
export default function SimulationPage() {
  /* ── State ─────────────────────────────────────────── */
  const [household, setHousehold] = useState<Household | null>(null);
  const [events, setEvents] = useState<GridEvent[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [gridLoad, setGridLoad] = useState(62);
  const [electricityPrice, setElectricityPrice] = useState(0.14);

  const [phase, setPhase] = useState<Phase>("idle");
  const [activeEvent, setActiveEvent] = useState<GridEvent | null>(null);
  const [activeRec, setActiveRec] = useState<Recommendation | null>(null);
  const [lastAccepted, setLastAccepted] = useState<{
    setpoint: number;
    credits: number;
    savingsUSD?: number;
  } | null>(null);
  const [thermoAnimating, setThermoAnimating] = useState(false);
  const [loading, setLoading] = useState(false);

  // ntfy push notification state
  const [ntfyTopic, setNtfyTopic] = useState("");
  const [ntfyBaseUrl, setNtfyBaseUrl] = useState("");
  const [ntfyConnected, setNtfyConnected] = useState(false);
  const [ntfySending, setNtfySending] = useState(false);

  // XRPL state
  const [xrplSetupStep, setXrplSetupStep] = useState<
    "none" | "funding" | "funded" | "linking" | "linked" | "trustline" | "ready"
  >("none");
  const [xrplLoading, setXrplLoading] = useState(false);
  const [xrplWalletInfo, setXrplWalletInfo] = useState<{
    address: string;
    seed: string;
  } | null>(null);
  const [xrplBalance, setXrplBalance] = useState<string>("0");
  const [xrplProgramWallet, setXrplProgramWallet] = useState<string>("");
  const [xrplError, setXrplError] = useState<string>("");

  /* ── Fetch state ───────────────────────────────────── */
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/simulation");
      const data = await res.json();
      if (data.ok) {
        setHousehold(data.households?.[0] ?? null);
        setEvents(data.events ?? []);
        setRecommendations(data.recommendations ?? []);
        setGridLoad(data.gridLoad);
        setElectricityPrice(data.electricityPrice);
        return data;
      }
    } catch {
      /* silent */
    }
    return null;
  }, []);

  useEffect(() => {
    fetchState();
    // Check if ntfy is already configured
    fetch("/api/simulation/notify")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          if (d.topic) {
            setNtfyTopic(d.topic);
            setNtfyConnected(true);
          }
          if (d.baseUrl) setNtfyBaseUrl(d.baseUrl);
        }
      })
      .catch(() => {});
  }, [fetchState]);

  /* ── Sync XRPL state from household ── */
  useEffect(() => {
    if (!household) return;
    if (household.xrplWallet) {
      setXrplWalletInfo({
        address: household.xrplWallet.address,
        seed: household.xrplWallet.seed,
      });
      setXrplSetupStep(
        household.xrplWallet.trustLineCreated ? "ready" : "linked"
      );
    }
  }, [household]);

  /* ── Auto-poll: sync dashboard when phone action happens ── */
  useEffect(() => {
    const interval = setInterval(async () => {
      const data = await fetchState();
      if (!data) return;

      // If the dashboard is showing a notification and the user already
      // responded from their phone, transition the UI automatically.
      if (phase === "notification" && activeRec) {
        const updatedRec = (data.recommendations ?? []).find(
          (r: Recommendation) => r.id === activeRec.id
        );
        if (updatedRec && updatedRec.status === "ACCEPTED") {
          setLastAccepted({
            setpoint: updatedRec.recommendedSetpoint,
            credits: updatedRec.estimatedCredits,
            savingsUSD: updatedRec.estimatedSavingsUSD,
          });
          setPhase("accepted");
          setThermoAnimating(true);
          setTimeout(() => setThermoAnimating(false), 1500);
          setTimeout(() => {
            setPhase("idle");
            setActiveEvent(null);
            setActiveRec(null);
          }, 3000);
        } else if (updatedRec && updatedRec.status === "DECLINED") {
          setPhase("declined");
          setTimeout(() => {
            setPhase("idle");
            setActiveEvent(null);
            setActiveRec(null);
          }, 2500);
        }
      }

      // If the dashboard is idle but a new PENDING recommendation appeared
      // (e.g. another device/script triggered an event), show it.
      if (phase === "idle" && !activeRec) {
        const pendingRec = (data.recommendations ?? []).find(
          (r: Recommendation) =>
            r.householdId === "hh-martinez" && r.status === "PENDING"
        );
        if (pendingRec) {
          const matchingEvent = (data.events ?? []).find(
            (e: GridEvent) => e.id === pendingRec.eventId
          );
          if (matchingEvent) {
            setActiveEvent(matchingEvent);
            setActiveRec(pendingRec);
            setLastAccepted(null);
            setTimeout(() => setPhase("notification"), 400);
          }
        }
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  }, [fetchState, phase, activeRec]);

  /* ── Trigger a scenario ────────────────────────────── */
  const handleTrigger = async (eventType: EventType) => {
    if (loading || phase === "notification") return;
    setLoading(true);

    try {
      const res = await fetch("/api/simulation/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType }),
      });
      const data = await res.json();
      if (data.ok && data.event && data.recommendations?.length) {
        // Refresh full state
        await fetchState();

        // Get Martinez's rec
        const martinezRec = data.recommendations.find(
          (r: Recommendation) => r.householdId === "hh-martinez"
        );
        if (martinezRec) {
          setActiveEvent(data.event);
          setActiveRec(martinezRec);
          setLastAccepted(null);

          // Small delay then show notification (like a real push arriving)
          setTimeout(() => {
            setPhase("notification");
          }, 600);
        }
      }
    } catch {
      /* silent */
    }
    setLoading(false);
  };

  /* ── Accept ────────────────────────────────────────── */
  const handleAccept = async () => {
    if (!activeRec) return;
    try {
      await fetch("/api/simulation/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recommendationId: activeRec.id,
          action: "ACCEPT",
        }),
      });
      setLastAccepted({
        setpoint: activeRec.recommendedSetpoint,
        credits: activeRec.estimatedCredits,
        savingsUSD: activeRec.estimatedSavingsUSD,
      });
      setPhase("accepted");
      setThermoAnimating(true);
      setTimeout(() => setThermoAnimating(false), 1500);
      await fetchState();
      if (xrplSetupStep === "ready") handleXrplCheckBalance();
      // Auto-dismiss after 3s
      setTimeout(() => {
        setPhase("idle");
        setActiveEvent(null);
        setActiveRec(null);
      }, 3000);
    } catch {
      /* silent */
    }
  };

  /* ── Decline ───────────────────────────────────────── */
  const handleDecline = async () => {
    if (!activeRec) return;
    try {
      await fetch("/api/simulation/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recommendationId: activeRec.id,
          action: "DECLINE",
        }),
      });
      setPhase("declined");
      await fetchState();
      setTimeout(() => {
        setPhase("idle");
        setActiveEvent(null);
        setActiveRec(null);
      }, 2500);
    } catch {
      /* silent */
    }
  };

  /* ── XRPL Setup ──────────────────────────────────── */
  const handleXrplFund = async () => {
    setXrplLoading(true);
    setXrplError("");
    try {
      const res = await fetch("/api/xrpl/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fund" }),
      });
      const data = await res.json();
      if (data.ok) {
        setXrplWalletInfo({ address: data.address, seed: data.seed });
        setXrplSetupStep("funded");
      } else {
        setXrplError(data.error);
      }
    } catch {
      setXrplError("Failed to fund wallet");
    }
    setXrplLoading(false);
  };

  const handleXrplLink = async () => {
    if (!xrplWalletInfo || !household) return;
    setXrplLoading(true);
    setXrplError("");
    try {
      const res = await fetch("/api/xrpl/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "link",
          householdId: household.id,
          address: xrplWalletInfo.address,
          seed: xrplWalletInfo.seed,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setXrplSetupStep("linked");
        await fetchState();
      } else {
        setXrplError(data.error);
      }
    } catch {
      setXrplError("Failed to link wallet");
    }
    setXrplLoading(false);
  };

  const handleXrplTrustline = async () => {
    if (!household) return;
    setXrplLoading(true);
    setXrplError("");
    try {
      const res = await fetch("/api/xrpl/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "trustline",
          householdId: household.id,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setXrplSetupStep("ready");
        await fetchState();
      } else {
        setXrplError(data.error);
      }
    } catch {
      setXrplError("Failed to create trust line");
    }
    setXrplLoading(false);
  };

  const handleXrplCheckBalance = async () => {
    if (!household) return;
    try {
      const res = await fetch(
        `/api/xrpl/status?householdId=${household.id}`
      );
      const data = await res.json();
      if (data.ok && data.balances) {
        setXrplBalance(data.balances.RLUSD);
      }
    } catch {
      /* silent */
    }
  };

  const handleXrplManualPayout = async () => {
    if (!household) return;
    setXrplLoading(true);
    setXrplError("");
    try {
      const res = await fetch("/api/xrpl/payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdId: household.id }),
      });
      const data = await res.json();
      if (data.ok) {
        await fetchState();
        await handleXrplCheckBalance();
      } else {
        setXrplError(data.error);
      }
    } catch {
      setXrplError("Payout failed");
    }
    setXrplLoading(false);
  };

  const handleXrplInfo = async () => {
    try {
      const res = await fetch("/api/xrpl/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "info" }),
      });
      const data = await res.json();
      if (data.ok) {
        setXrplProgramWallet(data.programWallet);
      }
    } catch {
      /* silent */
    }
  };

  useEffect(() => {
    handleXrplInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periodically refresh XRPL balance when wallet is ready
  useEffect(() => {
    if (xrplSetupStep !== "ready" || !household) return;
    handleXrplCheckBalance();
    const interval = setInterval(handleXrplCheckBalance, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xrplSetupStep, household?.id]);

  /* ── Reset ─────────────────────────────────────────── */
  const handleReset = async () => {
    await fetch("/api/simulation", { method: "POST" });
    setPhase("idle");
    setActiveEvent(null);
    setActiveRec(null);
    setLastAccepted(null);
    setXrplSetupStep("none");
    setXrplWalletInfo(null);
    setXrplBalance("0");
    setXrplError("");
    await fetchState();
  };

  /* ── ntfy handlers ─────────────────────────────────── */
  const handleSetNtfyTopic = async () => {
    if (!ntfyTopic.trim()) return;
    setNtfySending(true);
    try {
      // Save base URL first (so action buttons point to the right place)
      if (ntfyBaseUrl.trim()) {
        await fetch("/api/simulation/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseUrl: ntfyBaseUrl.trim() }),
        });
      }
      // Save topic
      const res = await fetch("/api/simulation/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: ntfyTopic.trim() }),
      });
      const data = await res.json();
      if (data.ok) setNtfyConnected(true);
    } catch {
      /* silent */
    }
    setNtfySending(false);
  };

  const handleTestPush = async () => {
    setNtfySending(true);
    try {
      await fetch("/api/simulation/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true }),
      });
    } catch {
      /* silent */
    }
    setNtfySending(false);
  };

  const handleDisconnectNtfy = async () => {
    await fetch("/api/simulation/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: null }),
    });
    setNtfyConnected(false);
    setNtfyTopic("");
  };

  /* ── Derived ───────────────────────────────────────── */
  const history = recommendations.filter(
    (r) => r.status === "ACCEPTED" || r.status === "DECLINED"
  );
  const gridColor =
    gridLoad > 90 ? "#ef4444" : gridLoad > 75 ? "#f59e0b" : "#22c55e";

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* ── Nav ─────────────────────────────────── */}
      <nav className="flex items-center justify-between h-12 border-b border-white/[0.06] px-6">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
          <a
            href="/"
            className="text-[14px] font-semibold tracking-tight text-white hover:text-[#22c55e] transition-colors"
          >
            blackout
          </a>
          <span className="text-white/15 mx-1.5">/</span>
          <span className="text-[12px] font-mono text-white/40">
            simulation
          </span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/devices"
            className="text-[10px] font-mono text-white/25 hover:text-[#22c55e] transition-colors"
          >
            Device Sandbox →
          </a>
        </div>
      </nav>

      <div className="flex h-[calc(100vh-3rem)]">
        {/* ── LEFT: Scenario Picker ──────────────── */}
        <div className="w-[260px] border-r border-white/[0.06] flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-white/[0.06]">
            <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">
              Grid Operator Panel
            </span>
          </div>

          {/* Grid status */}
          <div className="px-4 py-3 border-b border-white/[0.06] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono text-white/25">
                Grid Load
              </span>
              <span
                className="text-[11px] font-mono font-bold"
                style={{ color: gridColor }}
              >
                {gridLoad}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: gridColor }}
                animate={{ width: `${gridLoad}%` }}
                transition={{ duration: 0.8 }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono text-white/25">
                Price
              </span>
              <span
                className={`text-[10px] font-mono font-bold ${
                  electricityPrice > 0.3
                    ? "text-red-400"
                    : electricityPrice > 0.15
                    ? "text-amber-400"
                    : "text-[#22c55e]"
                }`}
              >
                ${electricityPrice.toFixed(2)}/kWh
              </span>
            </div>
          </div>

          {/* Scenario buttons */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest block mb-3">
              Choose a Scenario
            </span>
            {SCENARIOS.map((s) => (
              <button
                key={s.type}
                onClick={() => handleTrigger(s.type)}
                disabled={loading || phase === "notification"}
                className={`w-full text-left rounded-xl border p-3 bg-gradient-to-br transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98] ${s.colorClass}`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-[18px]">{s.icon}</span>
                  <div>
                    <span className="text-[11px] font-mono font-bold text-white/70 block">
                      {s.label}
                    </span>
                    <span className="text-[9px] font-mono text-white/30">
                      {s.desc}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* iOS Push Notifications */}
          <div className="p-4 border-t border-white/[0.06] space-y-2">
            <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest block">
              📱 Phone Notifications
            </span>
            {!ntfyConnected ? (
              <>
                <p className="text-[8px] font-mono text-white/15 leading-relaxed">
                  1. Install{" "}
                  <span className="text-white/30">ntfy</span> (free) on your
                  iPhone
                  <br />
                  2. Subscribe to a topic in the app
                  <br />
                  3. Enter the same topic + your computer&apos;s IP below
                </p>
                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={ntfyTopic}
                    onChange={(e) => setNtfyTopic(e.target.value)}
                    placeholder="ntfy topic, e.g. blackout-martinez"
                    className="w-full text-[10px] font-mono bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1.5 text-white/60 placeholder:text-white/15 focus:outline-none focus:border-[#22c55e]/30"
                  />
                  <input
                    type="text"
                    value={ntfyBaseUrl}
                    onChange={(e) => setNtfyBaseUrl(e.target.value)}
                    placeholder="http://YOUR_IP:3000"
                    className="w-full text-[10px] font-mono bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1.5 text-white/60 placeholder:text-white/15 focus:outline-none focus:border-[#22c55e]/30"
                  />
                  <p className="text-[7px] font-mono text-white/10">
                    Base URL lets Accept/Decline buttons on your phone reach
                    this server. Use your local IP (e.g. http://192.168.1.5:3000).
                  </p>
                  <button
                    onClick={handleSetNtfyTopic}
                    disabled={ntfySending || !ntfyTopic.trim()}
                    className="w-full text-[9px] font-mono py-1.5 rounded border border-[#22c55e]/20 text-[#22c55e]/60 hover:bg-[#22c55e]/[0.06] transition-all cursor-pointer disabled:opacity-30"
                  >
                    Connect
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
                  <span className="text-[9px] font-mono text-[#22c55e]/60">
                    {ntfyTopic}
                  </span>
                </div>
                {ntfyBaseUrl && (
                  <p className="text-[8px] font-mono text-white/15">
                    Actions → {ntfyBaseUrl}
                  </p>
                )}
                <div className="flex gap-1.5">
                  <button
                    onClick={handleTestPush}
                    disabled={ntfySending}
                    className="flex-1 text-[9px] font-mono py-1.5 rounded border border-[#22c55e]/20 text-[#22c55e]/50 hover:bg-[#22c55e]/[0.06] transition-all cursor-pointer disabled:opacity-30"
                  >
                    Send Test
                  </button>
                  <button
                    onClick={handleDisconnectNtfy}
                    className="text-[9px] font-mono py-1.5 px-3 rounded border border-white/[0.06] text-white/20 hover:text-red-400/60 hover:border-red-400/20 transition-all cursor-pointer"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* XRPL Wallet Setup */}
          <div className="p-4 border-t border-white/[0.06] space-y-2">
            <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest block">
              💎 XRPL Rewards
            </span>

            {xrplSetupStep === "none" && (
              <>
                <p className="text-[8px] font-mono text-white/15 leading-relaxed">
                  Connect an XRPL Testnet wallet to receive RLUSD payouts
                  when your energy savings reach the threshold ($1.00).
                </p>
                <button
                  onClick={handleXrplFund}
                  disabled={xrplLoading}
                  className="w-full text-[9px] font-mono py-1.5 rounded border border-purple-400/20 text-purple-400/60 hover:bg-purple-400/[0.06] transition-all cursor-pointer disabled:opacity-30"
                >
                  {xrplLoading ? "Creating wallet…" : "1. Create Testnet Wallet"}
                </button>
              </>
            )}

            {xrplSetupStep === "funded" && xrplWalletInfo && (
              <>
                <div className="bg-white/[0.03] rounded p-2">
                  <p className="text-[8px] font-mono text-white/30">
                    Address:
                  </p>
                  <p className="text-[7px] font-mono text-purple-400/70 break-all">
                    {xrplWalletInfo.address}
                  </p>
                </div>
                <button
                  onClick={handleXrplLink}
                  disabled={xrplLoading}
                  className="w-full text-[9px] font-mono py-1.5 rounded border border-purple-400/20 text-purple-400/60 hover:bg-purple-400/[0.06] transition-all cursor-pointer disabled:opacity-30"
                >
                  {xrplLoading ? "Linking…" : "2. Link to Martinez Household"}
                </button>
              </>
            )}

            {xrplSetupStep === "linked" && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span className="text-[8px] font-mono text-amber-400/60">
                    Wallet linked — need trust line
                  </span>
                </div>
                <button
                  onClick={handleXrplTrustline}
                  disabled={xrplLoading}
                  className="w-full text-[9px] font-mono py-1.5 rounded border border-purple-400/20 text-purple-400/60 hover:bg-purple-400/[0.06] transition-all cursor-pointer disabled:opacity-30"
                >
                  {xrplLoading
                    ? "Creating trust line…"
                    : "3. Create RLUSD Trust Line"}
                </button>
                {xrplProgramWallet && (
                  <p className="text-[7px] font-mono text-white/10">
                    Issuer: {xrplProgramWallet.slice(0, 12)}…
                  </p>
                )}
              </>
            )}

            {xrplSetupStep === "ready" && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                  <span className="text-[8px] font-mono text-purple-400/60">
                    Ready for RLUSD payouts
                  </span>
                </div>
                <div className="bg-white/[0.03] rounded p-2 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-[7px] font-mono text-white/20">
                      RLUSD Balance
                    </span>
                    <span className="text-[8px] font-mono font-bold text-purple-400">
                      {xrplBalance}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[7px] font-mono text-white/20">
                      Pending Savings
                    </span>
                    <span className="text-[8px] font-mono text-amber-400">
                      ${(household?.savingsUSD_pending ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[7px] font-mono text-white/20">
                      Total Paid Out
                    </span>
                    <span className="text-[8px] font-mono text-[#22c55e]">
                      ${(household?.savingsUSD_paid ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[7px] font-mono text-white/20">
                      Threshold
                    </span>
                    <span className="text-[8px] font-mono text-white/30">
                      $1.00
                    </span>
                  </div>
                  {/* Progress bar to threshold */}
                  <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden mt-1">
                    <motion.div
                      className="h-full rounded-full bg-purple-400"
                      animate={{
                        width: `${Math.min(
                          100,
                          ((household?.savingsUSD_pending ?? 0) / 1.0) * 100
                        )}%`,
                      }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                  <p className="text-[6px] font-mono text-white/10 text-center">
                    {(household?.savingsUSD_pending ?? 0) >= 1.0
                      ? "Threshold reached! Payout on next accept."
                      : `$${(1.0 - (household?.savingsUSD_pending ?? 0)).toFixed(
                          2
                        )} more to payout`}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={handleXrplManualPayout}
                    disabled={
                      xrplLoading ||
                      (household?.savingsUSD_pending ?? 0) < 1.0
                    }
                    className="flex-1 text-[8px] font-mono py-1.5 rounded border border-purple-400/20 text-purple-400/50 hover:bg-purple-400/[0.06] transition-all cursor-pointer disabled:opacity-20"
                  >
                    Manual Payout
                  </button>
                  <button
                    onClick={handleXrplCheckBalance}
                    className="text-[8px] font-mono py-1.5 px-2 rounded border border-white/[0.06] text-white/20 hover:text-purple-400/60 transition-all cursor-pointer"
                  >
                    ↻
                  </button>
                </div>
              </>
            )}

            {xrplError && (
              <p className="text-[8px] font-mono text-red-400/60">
                {xrplError}
              </p>
            )}
          </div>

          {/* Reset */}
          <div className="p-4 border-t border-white/[0.06]">
            <button
              onClick={handleReset}
              className="w-full text-[10px] font-mono py-2 rounded-lg border border-white/[0.06] text-white/20 hover:text-white/40 hover:bg-white/[0.02] transition-all cursor-pointer"
            >
              ↻ Reset Simulation
            </button>
          </div>
        </div>

        {/* ── CENTER: User Dashboard (what Martinez sees) ── */}
        <div className="flex-1 flex flex-col items-center overflow-y-auto"
          style={{
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(255,255,255,0.06) transparent",
          }}
        >
          {/* Phone-like frame */}
          <div className="w-full max-w-[420px] py-6 px-4 space-y-5">
            {/* User header */}
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-full bg-[#22c55e]/15 flex items-center justify-center text-[13px] font-mono font-bold text-[#22c55e]">
                  M
                </div>
                <div className="text-left">
                  <p className="text-[13px] font-semibold text-white/80">
                    Martinez Home
                  </p>
                  <p className="text-[9px] font-mono text-white/25">
                    {household?.isReal
                      ? "🟢 Connected to Enode HVAC"
                      : "Simulated HVAC"}
                  </p>
                </div>
              </div>
            </div>

            {/* Thermostat */}
            {household && (
              <ThermostatRing
                temp={household.hvac.currentTemp}
                setpoint={household.hvac.setpoint}
                mode={household.hvac.mode}
                animating={thermoAnimating}
              />
            )}

            {/* Credits & Savings bar */}
            <div className="flex items-center justify-center gap-4">
              <div className="text-center">
                <span className="text-[8px] font-mono text-white/20 block">
                  CREDITS
                </span>
                <motion.span
                  className="text-[22px] font-mono font-bold text-[#22c55e]"
                  key={household?.credits}
                  initial={{ scale: 1.2 }}
                  animate={{ scale: 1 }}
                >
                  {household?.credits ?? 0}
                </motion.span>
              </div>
              <div className="w-px h-8 bg-white/[0.06]" />
              <div className="text-center">
                <span className="text-[8px] font-mono text-white/20 block">
                  SAVINGS
                </span>
                <span className="text-[18px] font-mono font-bold text-amber-400">
                  ${(household?.savingsUSD_pending ?? 0).toFixed(2)}
                </span>
                <span className="text-[7px] font-mono text-white/15 block -mt-0.5">
                  pending
                </span>
              </div>
              <div className="w-px h-8 bg-white/[0.06]" />
              <div className="text-center">
                <span className="text-[8px] font-mono text-white/20 block">
                  RLUSD PAID
                </span>
                <span className="text-[18px] font-mono font-bold text-purple-400">
                  ${(household?.savingsUSD_paid ?? 0).toFixed(2)}
                </span>
              </div>
              <div className="w-px h-8 bg-white/[0.06]" />
              <div className="text-center">
                <span className="text-[8px] font-mono text-white/20 block">
                  MODE
                </span>
                <span className="text-[14px] font-mono font-bold text-white/40">
                  {household?.hvac.mode ?? "—"}
                </span>
              </div>
            </div>

            {/* XRPL wallet status badge */}
            {household?.xrplWallet?.trustLineCreated && (
              <div className="flex items-center justify-center gap-2">
                <div className="flex items-center gap-1.5 bg-purple-500/[0.08] border border-purple-500/20 rounded-full px-3 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                  <span className="text-[9px] font-mono text-purple-400/80">
                    XRPL Wallet: {household.xrplWallet.address.slice(0, 8)}…
                  </span>
                  <span className="text-[9px] font-mono font-bold text-purple-400">
                    {xrplBalance} RLUSD
                  </span>
                </div>
              </div>
            )}

            {/* ── Notification area ─────────────────── */}
            <AnimatePresence mode="wait">
              {phase === "notification" && activeEvent && activeRec && (
                <IOSNotification
                  key="notification"
                  event={activeEvent}
                  rec={activeRec}
                  onAccept={handleAccept}
                  onDecline={handleDecline}
                />
              )}

              {phase === "accepted" && lastAccepted && (
                <SuccessToast
                  key="success"
                  setpoint={lastAccepted.setpoint}
                  credits={lastAccepted.credits}
                  savingsUSD={lastAccepted.savingsUSD}
                />
              )}

              {phase === "declined" && <DeclineToast key="declined" />}
            </AnimatePresence>

            {/* Idle prompt */}
            {phase === "idle" && !history.length && (
              <div className="rounded-2xl border border-dashed border-white/[0.08] p-6 text-center">
                <p className="text-[11px] font-mono text-white/20">
                  No active alerts
                </p>
                <p className="text-[9px] font-mono text-white/10 mt-1">
                  Select a disaster scenario from the left panel
                  to see a notification arrive.
                </p>
              </div>
            )}

            {/* History */}
            {history.length > 0 && (
              <div>
                <span className="text-[9px] font-mono text-white/20 uppercase tracking-widest block mb-2">
                  Activity History
                </span>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] px-3 divide-y divide-white/[0.04]">
                  {[...history].reverse().map((rec) => {
                    const ev = events.find((e) => e.id === rec.eventId);
                    return (
                      <HistoryEntry key={rec.id} rec={rec} event={ev} />
                    );
                  })}
                </div>
              </div>
            )}

            {/* XRPL Payout History */}
            {household?.payouts && household.payouts.length > 0 && (
              <div>
                <span className="text-[9px] font-mono text-white/20 uppercase tracking-widest block mb-2">
                  💎 RLUSD Payouts
                </span>
                <div className="rounded-xl border border-purple-500/10 bg-purple-500/[0.02] px-3 py-1 divide-y divide-white/[0.04]">
                  {[...household.payouts].reverse().map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 py-2.5"
                    >
                      <span className="text-[14px]">💰</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] font-mono text-purple-400 font-bold">
                          ${p.amount} RLUSD
                        </span>
                        <p className="text-[7px] font-mono text-white/15 truncate">
                          TX: {p.txHash.slice(0, 20)}…
                        </p>
                      </div>
                      <span className="text-[8px] font-mono text-white/15">
                        {new Date(p.timestamp).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Flow Diagram / What's happening ── */}
        <div className="w-[240px] border-l border-white/[0.06] flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-white/[0.06]">
            <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">
              Full Loop Trace
            </span>
          </div>
          <div className="flex-1 p-4 space-y-4 overflow-y-auto">
            {/* Step indicators */}
            {[
              {
                step: 1,
                label: "Disaster scenario triggered",
                detail: activeEvent
                  ? `${activeEvent.icon} ${activeEvent.title}`
                  : "Waiting…",
                active: !!activeEvent,
                done: phase !== "idle",
              },
              {
                step: 2,
                label: "Notification sent to user",
                detail: activeRec
                  ? `${activeRec.currentSetpoint}°C → ${activeRec.recommendedSetpoint}°C`
                  : "Waiting…",
                active: phase === "notification",
                done:
                  phase === "accepted" ||
                  phase === "declined",
              },
              {
                step: 3,
                label: "User responds",
                detail:
                  phase === "accepted"
                    ? "✓ Accepted"
                    : phase === "declined"
                    ? "✗ Declined"
                    : "Waiting…",
                active: phase === "notification",
                done:
                  phase === "accepted" ||
                  phase === "declined",
              },
              {
                step: 4,
                label: "Thermostat adjusts",
                detail:
                  phase === "accepted" && lastAccepted
                    ? `Set to ${lastAccepted.setpoint}°C`
                    : phase === "declined"
                    ? "No change"
                    : "Waiting…",
                active: false,
                done: phase === "accepted",
              },
              {
                step: 5,
                label: "Credits awarded",
                detail:
                  phase === "accepted" && lastAccepted
                    ? `+${lastAccepted.credits} credits`
                    : "Waiting…",
                active: false,
                done: phase === "accepted",
              },
              {
                step: 6,
                label: "Savings → RLUSD",
                detail:
                  phase === "accepted" && lastAccepted?.savingsUSD
                    ? `+$${lastAccepted.savingsUSD.toFixed(2)} (pending: $${(
                        household?.savingsUSD_pending ?? 0
                      ).toFixed(2)})`
                    : xrplSetupStep === "ready"
                    ? "Waiting for accept…"
                    : "Set up XRPL wallet first",
                active: false,
                done: phase === "accepted" && !!lastAccepted?.savingsUSD,
              },
            ].map((s) => (
              <div key={s.step} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold border transition-all ${
                      s.done
                        ? "bg-[#22c55e]/20 border-[#22c55e]/30 text-[#22c55e]"
                        : s.active
                        ? "bg-amber-400/20 border-amber-400/30 text-amber-400"
                        : "bg-white/[0.03] border-white/[0.06] text-white/15"
                    }`}
                  >
                    {s.done ? "✓" : s.step}
                  </div>
                  {s.step < 6 && (
                    <div
                      className={`w-px h-6 ${
                        s.done
                          ? "bg-[#22c55e]/20"
                          : "bg-white/[0.04]"
                      }`}
                    />
                  )}
                </div>
                <div className="-mt-0.5">
                  <p
                    className={`text-[10px] font-mono ${
                      s.done
                        ? "text-white/60"
                        : s.active
                        ? "text-amber-400/70"
                        : "text-white/20"
                    }`}
                  >
                    {s.label}
                  </p>
                  <p
                    className={`text-[8px] font-mono ${
                      s.done
                        ? "text-[#22c55e]/60"
                        : "text-white/10"
                    }`}
                  >
                    {s.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Enode + XRPL note */}
          <div className="p-4 border-t border-white/[0.06] space-y-2">
            <p className="text-[8px] font-mono text-white/15 leading-relaxed">
              {household?.isReal
                ? "🟢 Enode HVAC linked — accepts will adjust real device"
                : "💡 Link your Enode HVAC on the Device Sandbox page to make accepts control a real thermostat."}
            </p>
            <p className="text-[8px] font-mono text-white/15 leading-relaxed">
              {xrplSetupStep === "ready"
                ? "💎 XRPL wallet active — savings accumulate per event duration and auto-pay as RLUSD when threshold is met."
                : "💎 Set up an XRPL wallet in the left panel to receive RLUSD tokens for your energy savings."}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
