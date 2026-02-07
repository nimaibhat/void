"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface XRPLWalletPanelProps {
  householdId: string | null;
  onWalletChange?: () => void;
}

type SetupStep =
  | "none"
  | "funding"
  | "funded"
  | "linking"
  | "linked"
  | "trustline"
  | "ready";

interface PayoutEntry {
  txHash: string;
  amount: string;
  timestamp: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function XRPLWalletPanel({
  householdId,
  onWalletChange,
}: XRPLWalletPanelProps) {
  const [setupStep, setSetupStep] = useState<SetupStep>("none");
  const [loading, setLoading] = useState(false);
  const [walletInfo, setWalletInfo] = useState<{
    address: string;
    seed: string;
  } | null>(null);
  const [balance, setBalance] = useState("0");
  const [pendingSavings, setPendingSavings] = useState(0);
  const [paidTotal, setPaidTotal] = useState(0);
  const [programWallet, setProgramWallet] = useState("");
  const [error, setError] = useState("");
  const [payoutHistory, setPayoutHistory] = useState<PayoutEntry[]>([]);

  // Check balance / status
  const checkBalance = useCallback(async () => {
    if (!householdId) return;
    try {
      const res = await fetch(
        `/api/xrpl/status?householdId=${encodeURIComponent(householdId)}`
      );
      const data = await res.json();
      if (data.ok) {
        if (data.balances) setBalance(data.balances.RLUSD ?? "0");
        if (data.pendingSavings != null) setPendingSavings(data.pendingSavings);
        if (data.paidTotal != null) setPaidTotal(data.paidTotal);
        if (data.payoutHistory) setPayoutHistory(data.payoutHistory);
      }
    } catch {
      /* silent */
    }
  }, [householdId]);

  // Check initial state from simulation API
  useEffect(() => {
    if (!householdId) return;
    (async () => {
      try {
        const res = await fetch("/api/simulation");
        const data = await res.json();
        if (data.ok) {
          const hh = (data.households ?? []).find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (h: any) => h.id === householdId
          );
          if (hh?.xrplWallet) {
            setWalletInfo({
              address: hh.xrplWallet.address,
              seed: hh.xrplWallet.seed,
            });
            setSetupStep(
              hh.xrplWallet.trustLineCreated ? "ready" : "linked"
            );
            if (hh.savingsUSD_pending != null)
              setPendingSavings(hh.savingsUSD_pending);
            if (hh.savingsUSD_paid != null) setPaidTotal(hh.savingsUSD_paid);
          }
        }
      } catch {
        /* silent */
      }
    })();
  }, [householdId]);

  // Poll balance when ready
  useEffect(() => {
    if (setupStep !== "ready" || !householdId) return;
    checkBalance();
    const interval = setInterval(checkBalance, 10_000);
    return () => clearInterval(interval);
  }, [setupStep, householdId, checkBalance]);

  // Fetch program wallet info
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/xrpl/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "info" }),
        });
        const data = await res.json();
        if (data.ok && data.programWallet) {
          setProgramWallet(data.programWallet);
        }
      } catch {
        /* silent */
      }
    })();
  }, []);

  // Step 1: Fund wallet
  const handleFund = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/xrpl/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fund" }),
      });
      const data = await res.json();
      if (data.ok) {
        setWalletInfo({ address: data.address, seed: data.seed });
        setSetupStep("funded");
      } else {
        setError(data.error);
      }
    } catch {
      setError("Failed to fund wallet");
    }
    setLoading(false);
  };

  // Step 2: Link to household
  const handleLink = async () => {
    if (!walletInfo || !householdId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/xrpl/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "link",
          householdId,
          address: walletInfo.address,
          seed: walletInfo.seed,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSetupStep("linked");
        onWalletChange?.();
      } else {
        setError(data.error);
      }
    } catch {
      setError("Failed to link wallet");
    }
    setLoading(false);
  };

  // Step 3: Create trust line
  const handleTrustline = async () => {
    if (!householdId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/xrpl/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "trustline",
          householdId,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSetupStep("ready");
        onWalletChange?.();
      } else {
        setError(data.error);
      }
    } catch {
      setError("Failed to create trust line");
    }
    setLoading(false);
  };

  // Manual payout
  const handleManualPayout = async () => {
    if (!householdId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/xrpl/payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdId }),
      });
      const data = await res.json();
      if (data.ok) {
        onWalletChange?.();
        await checkBalance();
      } else {
        setError(data.error);
      }
    } catch {
      setError("Payout failed");
    }
    setLoading(false);
  };

  if (!householdId) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
        className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6"
      >
        <h3 className="text-lg font-semibold text-white mb-2">
          XRPL Rewards
        </h3>
        <p className="text-sm text-[#555] font-mono">
          Household mapping unavailable. Load a citizen profile to enable XRPL rewards.
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4 }}
      className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          XRPL Rewards
        </h3>
        {setupStep === "ready" && (
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            <span className="text-[9px] font-mono text-purple-400/60">
              ACTIVE
            </span>
          </span>
        )}
      </div>

      {/* Step 1: No wallet */}
      {setupStep === "none" && (
        <div className="space-y-3">
          <p className="text-sm text-white/40 font-mono leading-relaxed">
            Connect an XRPL Testnet wallet to receive RLUSD payouts when your
            energy savings reach the threshold ($1.00).
          </p>
          <button
            onClick={handleFund}
            disabled={loading}
            className="text-sm font-mono py-2.5 px-5 rounded-lg border border-purple-400/30 text-purple-400/70 bg-purple-400/[0.04] hover:bg-purple-400/[0.12] hover:text-purple-400 transition-all cursor-pointer disabled:opacity-30"
          >
            {loading ? "Creating wallet..." : "1. Create Testnet Wallet"}
          </button>
        </div>
      )}

      {/* Step 2: Funded — show address + link button */}
      {setupStep === "funded" && walletInfo && (
        <div className="space-y-3">
          <div className="bg-white/[0.03] rounded-lg p-4">
            <p className="text-xs font-mono text-white/30 mb-1">
              Wallet Address
            </p>
            <p className="text-xs font-mono text-purple-400/70 break-all">
              {walletInfo.address}
            </p>
          </div>
          <button
            onClick={handleLink}
            disabled={loading}
            className="text-sm font-mono py-2.5 px-5 rounded-lg border border-purple-400/30 text-purple-400/70 bg-purple-400/[0.04] hover:bg-purple-400/[0.12] hover:text-purple-400 transition-all cursor-pointer disabled:opacity-30"
          >
            {loading ? "Linking..." : "2. Link to Household"}
          </button>
        </div>
      )}

      {/* Step 3: Linked — need trust line */}
      {setupStep === "linked" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-sm font-mono text-amber-400/70">
              Wallet linked — trust line required
            </span>
          </div>
          <button
            onClick={handleTrustline}
            disabled={loading}
            className="text-sm font-mono py-2.5 px-5 rounded-lg border border-purple-400/30 text-purple-400/70 bg-purple-400/[0.04] hover:bg-purple-400/[0.12] hover:text-purple-400 transition-all cursor-pointer disabled:opacity-30"
          >
            {loading
              ? "Creating trust line..."
              : "3. Create RLUSD Trust Line"}
          </button>
          {programWallet && (
            <p className="text-[10px] font-mono text-white/15">
              Issuer: {programWallet.slice(0, 16)}...
            </p>
          )}
        </div>
      )}

      {/* Step 4: Ready — show balances + payout */}
      {setupStep === "ready" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white/[0.03] rounded-lg p-3">
              <p className="text-[10px] font-mono text-white/25 mb-1">
                RLUSD Balance
              </p>
              <p className="text-lg font-mono font-bold text-purple-400">
                {balance}
              </p>
            </div>
            <div className="bg-white/[0.03] rounded-lg p-3">
              <p className="text-[10px] font-mono text-white/25 mb-1">
                Pending Savings
              </p>
              <p className="text-lg font-mono font-bold text-amber-400">
                ${pendingSavings.toFixed(2)}
              </p>
            </div>
            <div className="bg-white/[0.03] rounded-lg p-3">
              <p className="text-[10px] font-mono text-white/25 mb-1">
                Total Paid Out
              </p>
              <p className="text-lg font-mono font-bold text-[#22c55e]">
                ${paidTotal.toFixed(2)}
              </p>
            </div>
            <div className="bg-white/[0.03] rounded-lg p-3">
              <p className="text-[10px] font-mono text-white/25 mb-1">
                Threshold
              </p>
              <p className="text-lg font-mono font-bold text-white/40">
                $1.00
              </p>
            </div>
          </div>

          {/* Progress bar to threshold */}
          <div className="space-y-1.5">
            <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-purple-400"
                animate={{
                  width: `${Math.min(100, (pendingSavings / 1.0) * 100)}%`,
                }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <p className="text-[10px] font-mono text-white/20 text-center">
              {pendingSavings >= 1.0
                ? "Threshold reached! Payout available."
                : `$${(1.0 - pendingSavings).toFixed(2)} more to payout`}
            </p>
          </div>

          {/* Wallet info */}
          {walletInfo && (
            <div className="bg-white/[0.02] rounded-lg p-3">
              <p className="text-[10px] font-mono text-white/20 mb-1">
                Wallet Address
              </p>
              <p className="text-[10px] font-mono text-purple-400/50 break-all">
                {walletInfo.address}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleManualPayout}
              disabled={loading || pendingSavings < 1.0}
              className="flex-1 text-sm font-mono py-2.5 rounded-lg border border-purple-400/30 text-purple-400/70 bg-purple-400/[0.04] hover:bg-purple-400/[0.12] hover:text-purple-400 transition-all cursor-pointer disabled:opacity-20"
            >
              {loading ? "Processing..." : "Manual Payout"}
            </button>
            <button
              onClick={checkBalance}
              className="text-sm font-mono py-2.5 px-4 rounded-lg border border-white/[0.08] text-white/30 hover:text-purple-400/70 hover:border-purple-400/30 transition-all cursor-pointer"
            >
              Refresh
            </button>
          </div>

          {/* Payout history */}
          {payoutHistory.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[10px] font-mono text-white/25 uppercase tracking-widest">
                Payout History
              </h4>
              {payoutHistory.map((entry, i) => (
                <div
                  key={i}
                  className="flex justify-between items-center text-[10px] font-mono bg-white/[0.02] rounded p-2"
                >
                  <span className="text-white/30">
                    {new Date(entry.timestamp).toLocaleDateString()}
                  </span>
                  <span className="text-purple-400">{entry.amount} RLUSD</span>
                  <span className="text-white/15 truncate max-w-[100px]">
                    {entry.txHash.slice(0, 12)}...
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error display */}
      {error && (
        <p className="mt-3 text-xs font-mono text-red-400/70">{error}</p>
      )}
    </motion.div>
  );
}
