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
  xrplWallet: {
    address: string;
    seed: string;
    trustLineCreated: boolean;
  } | null;
  savingsUSD_pending: number;
  savingsUSD_paid: number;
  payouts: PayoutRecord[];
}

interface GridEvent {
  id: string;
  type: string;
  title: string;
  severity: string;
  icon: string;
  timestamp: string;
  active: boolean;
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

/* ------------------------------------------------------------------ */
/*  Scenario definitions                                               */
/* ------------------------------------------------------------------ */
const SCENARIOS: {
  type: EventType;
  label: string;
  icon: string;
  colorClass: string;
}[] = [
  {
    type: "DEMAND_REDUCTION",
    label: "Grid Overload",
    icon: "⚡",
    colorClass: "border-orange-400/30 bg-orange-500/10",
  },
  {
    type: "PRICE_SPIKE",
    label: "Price Spike",
    icon: "💰",
    colorClass: "border-amber-400/30 bg-amber-500/10",
  },
  {
    type: "HEAT_WAVE",
    label: "Heat Wave",
    icon: "🔥",
    colorClass: "border-red-400/30 bg-red-500/10",
  },
  {
    type: "COLD_SNAP",
    label: "Cold Snap",
    icon: "❄️",
    colorClass: "border-blue-400/30 bg-blue-500/10",
  },
  {
    type: "RENEWABLE_SURPLUS",
    label: "Renewable Surplus",
    icon: "🌱",
    colorClass: "border-green-400/30 bg-green-500/10",
  },
];

/* ------------------------------------------------------------------ */
/*  XRPL Balance Cache                                                  */
/* ------------------------------------------------------------------ */
interface XrplBalances {
  rlusd: number;
  xrp: number;
}

/* ------------------------------------------------------------------ */
/*  Helper: status badge color                                          */
/* ------------------------------------------------------------------ */
function statusColor(status: string) {
  switch (status) {
    case "ACCEPTED":
      return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "DECLINED":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "PENDING":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    case "EXPIRED":
      return "bg-white/10 text-white/30 border-white/10";
    default:
      return "bg-white/10 text-white/30 border-white/10";
  }
}

/* ------------------------------------------------------------------ */
/*  Admin Page                                                          */
/* ------------------------------------------------------------------ */
export default function AdminPage() {
  const [households, setHouseholds] = useState<Household[]>([]);
  const [events, setEvents] = useState<GridEvent[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [gridLoad, setGridLoad] = useState(62);
  const [electricityPrice, setElectricityPrice] = useState(0.12);
  const [xrplBalances, setXrplBalances] = useState<
    Record<string, XrplBalances>
  >({});
  const [xrplLoading, setXrplLoading] = useState<Record<string, boolean>>({});
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [programWallet, setProgramWallet] = useState<{
    address: string;
    issuer: string;
  } | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setLog((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 50));
  }, []);

  /* ── Fetch simulation state ──────────────────────────── */
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/simulation");
      const data = await res.json();
      if (data.ok) {
        setHouseholds(data.households ?? []);
        setEvents(data.events ?? []);
        setRecommendations(data.recommendations ?? []);
        setGridLoad(data.gridLoad ?? 62);
        setElectricityPrice(data.electricityPrice ?? 0.12);
      }
    } catch {
      /* silent */
    }
  }, []);

  /* ── Fetch program wallet info ──────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/xrpl/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "info" }),
        });
        const data = await res.json();
        if (data.ok) {
          setProgramWallet({
            address: data.programWallet,
            issuer: data.issuer,
          });
        }
      } catch {
        /* silent */
      }
    })();
  }, []);

  /* ── Initial fetch + polling ─────────────────────────── */
  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 2000);
    return () => clearInterval(interval);
  }, [fetchState]);

  /* ── Fetch XRPL balances for a household ─────────────── */
  const fetchXrplBalance = useCallback(
    async (hhId: string) => {
      setXrplLoading((prev) => ({ ...prev, [hhId]: true }));
      try {
        const res = await fetch(`/api/xrpl/status?householdId=${hhId}`);
        const data = await res.json();
        if (data.ok) {
          setXrplBalances((prev) => ({
            ...prev,
<<<<<<< HEAD
            [hhId]: {
              rlusd: data.rlusdBalance ?? 0,
              xrp: data.xrpBalance ?? 0,
            },
=======
            [hhId]: { rlusd: data.rlusdBalance ?? 0, xrp: data.xrpBalance ?? 0 },
>>>>>>> 44f8655ddc1f10d7dfba2ef22d4f4309146ea770
          }));
        }
      } catch {
        /* silent */
      } finally {
        setXrplLoading((prev) => ({ ...prev, [hhId]: false }));
      }
    },
    []
  );

  /* ── Auto-fetch XRPL balances for linked wallets ──────── */
  useEffect(() => {
    for (const hh of households) {
      if (hh.xrplWallet?.address) {
        fetchXrplBalance(hh.id);
      }
    }
    const interval = setInterval(() => {
      for (const hh of households) {
        if (hh.xrplWallet?.address) {
          fetchXrplBalance(hh.id);
        }
      }
    }, 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [households.map((h) => h.xrplWallet?.address).join(",")]);

  /* ── Trigger grid event ──────────────────────────────── */
  const handleTrigger = async (eventType: EventType) => {
    setTriggerLoading(true);
    try {
      const res = await fetch("/api/simulation/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType }),
      });
      const data = await res.json();
      if (data.ok) {
        addLog(
          `🔴 Event triggered: ${eventType} → ${data.recommendations?.length ?? 0} recommendations sent`
        );
        await fetchState();
      } else {
        addLog(`❌ Event failed: ${data.error}`);
      }
    } catch (e) {
      addLog(`❌ Event error: ${e}`);
    } finally {
      setTriggerLoading(false);
    }
  };

  /* ── Accept/Decline on behalf of a household ──────────── */
<<<<<<< HEAD
  const handleRespond = async (
    recId: string,
    action: "ACCEPT" | "DECLINE"
  ) => {
=======
  const handleRespond = async (recId: string, action: "ACCEPT" | "DECLINE") => {
>>>>>>> 44f8655ddc1f10d7dfba2ef22d4f4309146ea770
    try {
      const res = await fetch("/api/simulation/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendationId: recId, action }),
      });
      const data = await res.json();
      if (data.ok) {
        const rec = data.recommendation;
        addLog(
          `${action === "ACCEPT" ? "✅" : "✗"} ${rec?.householdId?.replace("hh-", "")} ${action.toLowerCase()}ed → ${rec?.recommendedSetpoint}°C (${rec?.estimatedCredits} credits, $${rec?.estimatedSavingsUSD?.toFixed(2)} savings)`
        );
        await fetchState();
      } else {
        addLog(`❌ Respond failed: ${data.error}`);
      }
    } catch (e) {
      addLog(`❌ Respond error: ${e}`);
    }
  };

  /* ── XRPL Wallet Setup for a household ───────────────── */
  const handleSetupXrpl = async (hhId: string) => {
    setXrplLoading((prev) => ({ ...prev, [hhId]: true }));
    try {
      // Step 1: Fund
      addLog(`💎 ${hhId.replace("hh-", "")}: Funding testnet wallet...`);
      const fundRes = await fetch("/api/xrpl/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fund" }),
      });
      const fundData = await fundRes.json();
      if (!fundData.ok) throw new Error(fundData.error);
      addLog(
        `💎 ${hhId.replace("hh-", "")}: Wallet funded → ${fundData.address.slice(0, 10)}...`
      );

      // Step 2: Link
      const linkRes = await fetch("/api/xrpl/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "link",
          householdId: hhId,
          address: fundData.address,
          seed: fundData.seed,
        }),
      });
      const linkData = await linkRes.json();
      if (!linkData.ok) throw new Error(linkData.error);
      addLog(`💎 ${hhId.replace("hh-", "")}: Wallet linked`);

      // Step 3: Trust line
      addLog(`💎 ${hhId.replace("hh-", "")}: Creating RLUSD trust line...`);
      const trustRes = await fetch("/api/xrpl/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trustline", householdId: hhId }),
      });
      const trustData = await trustRes.json();
      if (!trustData.ok) throw new Error(trustData.error);
      addLog(
        `💎 ${hhId.replace("hh-", "")}: Trust line created ✓ (tx: ${trustData.txHash?.slice(0, 12)}...)`
      );

      await fetchState();
      await fetchXrplBalance(hhId);
    } catch (e) {
      addLog(
        `❌ ${hhId.replace("hh-", "")} XRPL setup failed: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setXrplLoading((prev) => ({ ...prev, [hhId]: false }));
    }
  };

  /* ── Setup all wallets at once ───────────────────────── */
  const handleSetupAllXrpl = async () => {
    for (const hh of households) {
      if (!hh.xrplWallet) {
        await handleSetupXrpl(hh.id);
      }
    }
  };

  /* ── Reset simulation ────────────────────────────────── */
  const handleReset = async () => {
    await fetch("/api/simulation", { method: "POST" });
    setXrplBalances({});
    setLog([]);
    addLog("🔄 Simulation reset");
    await fetchState();
  };

  /* ── Derived values ──────────────────────────────────── */
  const activeEvent = events.find((e) => e.active);
  const totalCredits = households.reduce((s, h) => s + h.credits, 0);
  const totalPaid = households.reduce((s, h) => s + h.savingsUSD_paid, 0);
<<<<<<< HEAD
  const totalPending = households.reduce(
    (s, h) => s + h.savingsUSD_pending,
    0
  );
  const allHaveWallets =
    households.length > 0 && households.every((h) => h.xrplWallet);

  // Get recommendations for each household
=======
  const totalPending = households.reduce((s, h) => s + h.savingsUSD_pending, 0);
  const allHaveWallets = households.length > 0 && households.every((h) => h.xrplWallet);

  // Get recommendations for each household for the active event
>>>>>>> 44f8655ddc1f10d7dfba2ef22d4f4309146ea770
  const getHouseholdRecs = (hhId: string) =>
    recommendations.filter((r) => r.householdId === hhId);
  const getActiveRec = (hhId: string) =>
    recommendations.find(
      (r) => r.householdId === hhId && r.status === "PENDING"
    );

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* ── Top Nav ──────────────────────────────── */}
      <nav className="h-12 border-b border-white/[0.06] flex items-center px-5 gap-4 bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[#22c55e] shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
          <span className="text-[14px] font-semibold tracking-tight">
            blackout
          </span>
        </div>
        <span className="text-[10px] font-mono text-white/20 border border-white/[0.08] px-2 py-0.5 rounded">
          OPERATOR VIEW
        </span>
        <div className="flex-1" />

        {/* Grid metrics */}
        <div className="flex items-center gap-4 text-[10px] font-mono">
          <span className="text-white/30">
            Grid Load:{" "}
            <span
              className={
                gridLoad > 85
                  ? "text-red-400 font-bold"
                  : gridLoad > 70
                    ? "text-amber-400"
                    : "text-emerald-400"
              }
            >
              {gridLoad}%
            </span>
          </span>
          <span className="text-white/30">
            Price:{" "}
            <span className="text-white/60">
              ${electricityPrice.toFixed(2)}/kWh
            </span>
          </span>
          <span className="text-white/30">
            Households:{" "}
            <span className="text-white/60">{households.length}</span>
          </span>
        </div>

        <a
          href="/simulation"
          className="text-[10px] font-mono text-white/20 hover:text-white/40 transition-colors border border-white/[0.08] px-3 py-1 rounded"
        >
          Consumer View →
        </a>
      </nav>

      <div className="flex h-[calc(100vh-3rem)]">
        {/* ── LEFT: Controls Panel ─────────────────── */}
        <div className="w-[280px] border-r border-white/[0.06] flex flex-col flex-shrink-0 overflow-y-auto scrollbar-thin">
          {/* Event trigger */}
          <div className="p-4 border-b border-white/[0.06]">
            <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest block mb-3">
              Trigger Grid Event
            </span>
            <div className="space-y-1.5">
              {SCENARIOS.map((s) => (
                <button
                  key={s.type}
                  onClick={() => handleTrigger(s.type)}
                  disabled={triggerLoading}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-[11px] font-mono transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 ${s.colorClass}`}
                >
                  <span className="mr-1.5">{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Active event */}
          {activeEvent && (
            <div className="p-4 border-b border-white/[0.06]">
              <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest block mb-2">
                Active Event
              </span>
              <div className="rounded-lg border border-amber-400/20 bg-amber-500/5 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-[16px]">{activeEvent.icon}</span>
                  <div>
                    <p className="text-[11px] font-mono text-white/60 font-bold">
                      {activeEvent.title}
                    </p>
                    <p className="text-[9px] font-mono text-white/25">
                      {activeEvent.type} · {activeEvent.severity}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* XRPL Setup */}
          <div className="p-4 border-b border-white/[0.06]">
            <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest block mb-3">
              💎 XRPL Wallets
            </span>
            {programWallet && (
              <p className="text-[8px] font-mono text-white/15 mb-3">
                Issuer: {programWallet.issuer.slice(0, 12)}...
              </p>
            )}
            {!allHaveWallets && (
              <button
                onClick={handleSetupAllXrpl}
                className="w-full text-[10px] font-mono py-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-emerald-400/70 hover:bg-emerald-500/10 transition-all cursor-pointer mb-2"
              >
                🔗 Setup All Wallets
              </button>
            )}
            <div className="space-y-1.5">
              {households.map((hh) => (
                <div
                  key={hh.id}
                  className="flex items-center justify-between text-[9px] font-mono"
                >
                  <span className="text-white/40">{hh.name}</span>
                  {hh.xrplWallet ? (
                    <span className="text-emerald-400/60">
                      {hh.xrplWallet.address.slice(0, 8)}…
                      {hh.xrplWallet.trustLineCreated ? " ✓" : " ⏳"}
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSetupXrpl(hh.id)}
                      disabled={!!xrplLoading[hh.id]}
                      className="text-blue-400/50 hover:text-blue-400/80 cursor-pointer disabled:opacity-30"
                    >
                      {xrplLoading[hh.id] ? "Setting up…" : "Setup →"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Aggregate stats */}
          <div className="p-4 border-b border-white/[0.06]">
            <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest block mb-3">
              Aggregate Stats
            </span>
            <div className="space-y-2">
              {[
<<<<<<< HEAD
                {
                  label: "Total Credits",
                  value: totalCredits.toString(),
                  color: "text-amber-400",
                },
                {
                  label: "Total RLUSD Paid",
                  value: `$${totalPaid.toFixed(2)}`,
                  color: "text-emerald-400",
                },
                {
                  label: "Pending Savings",
                  value: `$${totalPending.toFixed(2)}`,
                  color: "text-blue-400",
                },
                {
                  label: "Participation Rate",
                  value:
                    households.length > 0
                      ? `${Math.round(
                          (households.filter((h) => h.totalParticipations > 0)
                            .length /
                            households.length) *
                            100
                        )}%`
                      : "—",
                  color: "text-white/60",
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="flex items-center justify-between"
                >
                  <span className="text-[9px] font-mono text-white/25">
                    {stat.label}
                  </span>
                  <span
                    className={`text-[12px] font-mono font-bold ${stat.color}`}
                  >
=======
                { label: "Total Credits", value: totalCredits.toString(), color: "text-amber-400" },
                { label: "Total RLUSD Paid", value: `$${totalPaid.toFixed(2)}`, color: "text-emerald-400" },
                { label: "Pending Savings", value: `$${totalPending.toFixed(2)}`, color: "text-blue-400" },
                {
                  label: "Participation Rate",
                  value: households.length > 0
                    ? `${Math.round(
                        (households.filter((h) => h.totalParticipations > 0).length /
                          households.length) *
                          100
                      )}%`
                    : "—",
                  color: "text-white/60",
                },
              ].map((stat) => (
                <div key={stat.label} className="flex items-center justify-between">
                  <span className="text-[9px] font-mono text-white/25">
                    {stat.label}
                  </span>
                  <span className={`text-[12px] font-mono font-bold ${stat.color}`}>
>>>>>>> 44f8655ddc1f10d7dfba2ef22d4f4309146ea770
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Reset */}
          <div className="p-4">
            <button
              onClick={handleReset}
              className="w-full text-[9px] font-mono py-2 rounded border border-red-500/20 text-red-400/40 hover:text-red-400/70 hover:bg-red-500/5 transition-all cursor-pointer"
            >
              Reset Simulation
            </button>
          </div>
        </div>

        {/* ── CENTER: Household Cards ──────────────── */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-3 gap-5 mb-8">
            {households.map((hh) => {
              const pendingRec = getActiveRec(hh.id);
              const recentRecs = getHouseholdRecs(hh.id)
                .filter((r) => r.status !== "PENDING")
                .slice(-5)
                .reverse();
              const bal = xrplBalances[hh.id];
              const PAYOUT_THRESHOLD = 1.0;
              const savingsProgress = Math.min(
                100,
                (hh.savingsUSD_pending / PAYOUT_THRESHOLD) * 100
              );

              return (
                <motion.div
                  key={hh.id}
                  layout
                  className="rounded-2xl border border-white/[0.06] bg-white/[0.015] overflow-hidden"
                >
                  {/* Card header */}
                  <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-[14px] font-bold ${
                          hh.xrplWallet
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-white/[0.04] text-white/30"
                        }`}
                      >
                        {hh.name[0]}
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold">{hh.name}</p>
                        <p className="text-[9px] font-mono text-white/25">
                          {hh.id} ·{" "}
                          {hh.isReal ? "🟢 Real device" : "Virtual device"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[18px] font-mono font-bold text-amber-400">
                        {hh.credits}
                      </p>
                      <p className="text-[8px] font-mono text-white/20">
                        credits
                      </p>
                    </div>
                  </div>

                  {/* Thermostat + Device */}
                  <div className="px-5 py-4 border-b border-white/[0.06]">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[9px] font-mono text-white/25 uppercase tracking-wider">
                        HVAC Device
                      </span>
                      <span
                        className={`text-[9px] font-mono px-2 py-0.5 rounded border ${
                          hh.hvac.mode === "HEAT"
                            ? "text-orange-400/70 border-orange-400/20 bg-orange-500/5"
                            : hh.hvac.mode === "COOL"
                              ? "text-blue-400/70 border-blue-400/20 bg-blue-500/5"
                              : "text-white/30 border-white/10 bg-white/[0.02]"
                        }`}
                      >
                        {hh.hvac.mode}
                      </span>
                    </div>
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-[10px] font-mono text-white/25">
                          Current Temp
                        </p>
                        <p className="text-[28px] font-mono font-bold text-white/50 leading-none">
                          {hh.hvac.currentTemp}°
                        </p>
                      </div>
                      <div className="text-[20px] text-white/10">→</div>
                      <div className="text-right">
                        <p className="text-[10px] font-mono text-white/25">
                          Setpoint
                        </p>
                        <p className="text-[28px] font-mono font-bold text-[#22c55e] leading-none">
                          {hh.hvac.setpoint}°
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Pending recommendation */}
                  <AnimatePresence>
                    {pendingRec && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-b border-amber-400/20 bg-amber-500/[0.03] overflow-hidden"
                      >
                        <div className="px-5 py-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] font-mono text-amber-400/60 uppercase tracking-wider">
                              ⏳ Pending Recommendation
                            </span>
                            <span className="text-[9px] font-mono text-white/20">
                              {pendingRec.currentSetpoint}° →{" "}
                              {pendingRec.recommendedSetpoint}°
                            </span>
                          </div>
                          <p className="text-[10px] font-mono text-white/30 mb-2 line-clamp-2">
                            {pendingRec.reason}
                          </p>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-mono text-white/20">
                              +{pendingRec.estimatedCredits} credits · $
                              {pendingRec.estimatedSavingsUSD.toFixed(2)}
                            </span>
                            <div className="flex-1" />
                            <button
                              onClick={() =>
                                handleRespond(pendingRec.id, "ACCEPT")
                              }
                              className="text-[9px] font-mono px-3 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all cursor-pointer"
                            >
                              ✓ Accept
                            </button>
                            <button
                              onClick={() =>
                                handleRespond(pendingRec.id, "DECLINE")
                              }
                              className="text-[9px] font-mono px-3 py-1 rounded border border-red-500/20 text-red-400/50 hover:bg-red-500/10 transition-all cursor-pointer"
                            >
                              ✗ Decline
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* XRPL Wallet */}
                  <div className="px-5 py-3 border-b border-white/[0.06]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[9px] font-mono text-white/25 uppercase tracking-wider">
                        💎 XRPL Wallet
                      </span>
                      {hh.xrplWallet && (
                        <button
                          onClick={() => fetchXrplBalance(hh.id)}
                          disabled={!!xrplLoading[hh.id]}
                          className="text-[8px] font-mono text-white/15 hover:text-white/30 cursor-pointer"
                        >
                          {xrplLoading[hh.id] ? "⟳" : "refresh"}
                        </button>
                      )}
                    </div>
                    {hh.xrplWallet ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-mono text-white/20">
                            Address
                          </span>
                          <a
                            href={`https://test.bithomp.com/explorer/${hh.xrplWallet.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[9px] font-mono text-blue-400/50 hover:text-blue-400/80 transition-colors"
                          >
                            {hh.xrplWallet.address.slice(0, 8)}…
                            {hh.xrplWallet.address.slice(-4)} ↗
                          </a>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-mono text-white/20">
                            RLUSD
                          </span>
                          <span className="text-[11px] font-mono text-emerald-400 font-bold">
                            {(bal?.rlusd ?? 0).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-mono text-white/20">
                            XRP
                          </span>
                          <span className="text-[9px] font-mono text-white/40">
                            {(bal?.xrp ?? 0).toFixed(2)}
                          </span>
                        </div>
                        {/* Savings progress bar */}
                        <div className="mt-1">
                          <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
                            <motion.div
                              className="h-full rounded-full bg-emerald-500/70"
                              animate={{ width: `${savingsProgress}%` }}
                              transition={{ duration: 0.5 }}
                            />
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-[7px] font-mono text-white/15">
                              ${hh.savingsUSD_pending.toFixed(2)} pending
                            </span>
                            <span className="text-[7px] font-mono text-emerald-400/30">
                              ${hh.savingsUSD_paid.toFixed(2)} paid
                            </span>
                          </div>
                        </div>
                        {/* Trust line badge */}
                        <div className="flex items-center gap-1 mt-1">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              hh.xrplWallet.trustLineCreated
                                ? "bg-emerald-400"
                                : "bg-amber-400"
                            }`}
                          />
                          <span className="text-[7px] font-mono text-white/15">
                            {hh.xrplWallet.trustLineCreated
                              ? "Trust line active"
                              : "Trust line pending"}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleSetupXrpl(hh.id)}
                        disabled={!!xrplLoading[hh.id]}
                        className="w-full text-[9px] font-mono py-1.5 rounded border border-white/[0.06] text-white/20 hover:text-white/40 hover:bg-white/[0.02] transition-all cursor-pointer disabled:opacity-30"
                      >
                        {xrplLoading[hh.id]
                          ? "Setting up…"
                          : "Setup XRPL Wallet →"}
                      </button>
                    )}
                  </div>

                  {/* Recent activity */}
                  <div className="px-5 py-3">
                    <span className="text-[9px] font-mono text-white/25 uppercase tracking-wider block mb-2">
                      Recent Activity
                    </span>
                    {recentRecs.length === 0 ? (
                      <p className="text-[9px] font-mono text-white/10">
                        No activity yet
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {recentRecs.map((rec) => (
                          <div
                            key={rec.id}
                            className="flex items-center justify-between"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[8px] font-mono px-1.5 py-0.5 rounded border ${statusColor(rec.status)}`}
                              >
                                {rec.status}
                              </span>
                              <span className="text-[9px] font-mono text-white/25">
<<<<<<< HEAD
                                {rec.currentSetpoint}° →{" "}
                                {rec.recommendedSetpoint}°
=======
                                {rec.currentSetpoint}° → {rec.recommendedSetpoint}°
>>>>>>> 44f8655ddc1f10d7dfba2ef22d4f4309146ea770
                              </span>
                            </div>
                            <span className="text-[9px] font-mono text-amber-400/60">
                              {rec.status === "ACCEPTED"
                                ? `+${rec.estimatedCredits}`
                                : "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Payout history */}
                    {hh.payouts.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-white/[0.04]">
                        <span className="text-[8px] font-mono text-white/15 block mb-1">
                          RLUSD Payouts
                        </span>
                        {hh.payouts
                          .slice(-3)
                          .reverse()
                          .map((p) => (
                            <div
                              key={p.id}
                              className="flex items-center justify-between"
                            >
                              <span className="text-[9px] font-mono text-emerald-400/60">
                                +${parseFloat(p.amount).toFixed(2)} RLUSD
                              </span>
                              <a
                                href={`https://test.bithomp.com/explorer/${p.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[7px] font-mono text-blue-400/30 hover:text-blue-400/60"
                              >
                                {p.txHash.slice(0, 8)}… ↗
                              </a>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* ── Leaderboard ──────────────────────────── */}
          <div className="max-w-2xl mx-auto mb-8">
            <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest block mb-3">
              🏆 Leaderboard
            </span>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] overflow-hidden">
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-5 py-2 border-b border-white/[0.06] text-[8px] font-mono text-white/20 uppercase tracking-wider">
                <span>#</span>
                <span>Household</span>
                <span>Credits</span>
                <span>Participations</span>
                <span>RLUSD Paid</span>
              </div>
              {[...households]
                .sort((a, b) => b.credits - a.credits)
                .map((hh, i) => (
                  <div
                    key={hh.id}
                    className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-5 py-2.5 border-b border-white/[0.04] last:border-0 items-center"
                  >
                    <span
                      className={`text-[14px] font-mono font-bold ${
                        i === 0
                          ? "text-amber-400"
                          : i === 1
                            ? "text-white/40"
                            : "text-white/20"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          i === 0
                            ? "bg-amber-500/15 text-amber-400"
                            : "bg-white/[0.04] text-white/30"
                        }`}
                      >
                        {hh.name[0]}
                      </div>
                      <span className="text-[11px] font-mono text-white/60">
                        {hh.name}
                      </span>
                    </div>
                    <span className="text-[12px] font-mono font-bold text-amber-400 text-right">
                      {hh.credits}
                    </span>
                    <span className="text-[11px] font-mono text-white/30 text-right">
                      {hh.totalParticipations}
                    </span>
                    <span className="text-[11px] font-mono text-emerald-400/60 text-right">
                      ${hh.savingsUSD_paid.toFixed(2)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Event Log ─────────────────────── */}
        <div className="w-[280px] border-l border-white/[0.06] flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-white/[0.06]">
            <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">
              Event Log
            </span>
          </div>
          <div
            className="flex-1 overflow-y-auto p-4 space-y-1.5"
            style={{
              scrollbarWidth: "thin",
              scrollbarColor: "rgba(255,255,255,0.06) transparent",
            }}
          >
            {log.length === 0 ? (
              <p className="text-[9px] font-mono text-white/10">
                No events yet. Trigger a scenario to begin.
              </p>
            ) : (
              log.map((entry, i) => (
                <motion.p
                  key={i}
                  initial={i === 0 ? { opacity: 0, x: -10 } : false}
                  animate={{ opacity: 1, x: 0 }}
                  className="text-[9px] font-mono text-white/30 leading-relaxed"
                >
                  {entry}
                </motion.p>
              ))
            )}
          </div>

          {/* All Recommendations */}
          <div className="border-t border-white/[0.06] p-4 max-h-[300px] overflow-y-auto">
            <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest block mb-2">
              All Recommendations
            </span>
            <div className="space-y-1">
              {[...recommendations]
                .reverse()
                .slice(0, 20)
                .map((rec) => {
                  const hhName =
                    households.find((h) => h.id === rec.householdId)?.name ??
                    rec.householdId;
                  return (
                    <div
                      key={rec.id}
                      className="flex items-center gap-2 text-[8px] font-mono"
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          rec.status === "ACCEPTED"
                            ? "bg-emerald-400"
                            : rec.status === "DECLINED"
                              ? "bg-red-400"
                              : rec.status === "PENDING"
                                ? "bg-amber-400"
                                : "bg-white/20"
                        }`}
                      />
                      <span className="text-white/30 truncate">
                        {hhName}: {rec.currentSetpoint}→
                        {rec.recommendedSetpoint}°
                      </span>
                      <span
                        className={`ml-auto flex-shrink-0 ${
                          rec.status === "ACCEPTED"
                            ? "text-emerald-400/60"
                            : rec.status === "DECLINED"
                              ? "text-red-400/60"
                              : "text-amber-400/60"
                        }`}
                      >
                        {rec.status}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
