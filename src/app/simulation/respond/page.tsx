"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";

/**
 * /simulation/respond?id=rec-xxx&action=ACCEPT
 *
 * This page is opened when the user taps Accept or Decline
 * on the iOS push notification. It processes the action
 * and shows a confirmation screen.
 */
export default function RespondPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-6">
        <div className="w-16 h-16 rounded-full border-2 border-[#22c55e]/30 border-t-[#22c55e] mx-auto animate-spin" />
      </main>
    }>
      <RespondContent />
    </Suspense>
  );
}

function RespondContent() {
  const params = useSearchParams();
  const recId = params.get("id");
  const action = params.get("action"); // "ACCEPT" or "DECLINE"

  const [status, setStatus] = useState<
    "processing" | "success" | "declined" | "error"
  >("processing");
  const [details, setDetails] = useState<{
    setpoint?: number;
    credits?: number;
    totalCredits?: number;
    savingsUSD?: number;
    savingsPending?: number;
    savingsPaid?: number;
    payoutTriggered?: boolean;
    error?: string;
  }>({});

  const processAction = useCallback(async () => {
    if (!recId || !action) {
      setStatus("error");
      setDetails({ error: "Missing recommendation ID or action." });
      return;
    }

    try {
      const res = await fetch("/api/simulation/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recommendationId: recId,
          action: action.toUpperCase(),
        }),
      });
      const data = await res.json();

      if (!data.ok) {
        setStatus("error");
        setDetails({ error: data.error ?? "Something went wrong." });
        return;
      }

      if (action.toUpperCase() === "ACCEPT") {
        setStatus("success");
        setDetails({
          setpoint: data.recommendation?.recommendedSetpoint,
          credits: data.recommendation?.estimatedCredits,
          totalCredits: data.household?.credits,
          savingsUSD: data.savings?.thisEvent,
          savingsPending: data.savings?.pending,
          savingsPaid: data.savings?.paid,
          payoutTriggered: data.savings?.payoutTriggered,
        });
      } else {
        setStatus("declined");
      }
    } catch {
      setStatus("error");
      setDetails({ error: "Network error. Please try again." });
    }
  }, [recId, action]);

  useEffect(() => {
    processAction();
  }, [processAction]);

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm text-center space-y-6"
      >
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-3 h-3 rounded-full bg-[#22c55e] shadow-[0_0_12px_rgba(34,197,94,0.6)]" />
          <span className="text-[18px] font-semibold tracking-tight">
            void
          </span>
        </div>

        {/* Processing */}
        {status === "processing" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            <div className="w-16 h-16 rounded-full border-2 border-[#22c55e]/30 border-t-[#22c55e] mx-auto animate-spin" />
            <p className="text-[14px] font-mono text-white/50">
              Processing your response…
            </p>
          </motion.div>
        )}

        {/* Accepted */}
        {status === "success" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-5"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", damping: 10, delay: 0.1 }}
              className="w-20 h-20 rounded-full bg-[#22c55e]/15 mx-auto flex items-center justify-center"
            >
              <span className="text-[40px]">✓</span>
            </motion.div>
            <div>
              <h1 className="text-[22px] font-bold text-[#22c55e] mb-2">
                Thermostat Adjusted
              </h1>
              <p className="text-[14px] text-white/50">
                Your thermostat has been set to{" "}
                <span className="font-bold text-white/80">
                  {details.setpoint}°C
                </span>
              </p>
            </div>

            <div className="flex justify-center gap-6">
              <div className="text-center">
                <span className="text-[10px] font-mono text-white/25 block">
                  EARNED
                </span>
                <span className="text-[28px] font-mono font-bold text-amber-400">
                  +{details.credits}
                </span>
                <span className="text-[10px] font-mono text-white/25 block">
                  credits
                </span>
              </div>
              <div className="w-px bg-white/[0.06]" />
              <div className="text-center">
                <span className="text-[10px] font-mono text-white/25 block">
                  TOTAL
                </span>
                <span className="text-[28px] font-mono font-bold text-[#22c55e]">
                  {details.totalCredits}
                </span>
                <span className="text-[10px] font-mono text-white/25 block">
                  credits
                </span>
              </div>
              {details.savingsUSD !== undefined && details.savingsUSD > 0 && (
                <>
                  <div className="w-px bg-white/[0.06]" />
                  <div className="text-center">
                    <span className="text-[10px] font-mono text-white/25 block">
                      SAVINGS
                    </span>
                    <span className="text-[28px] font-mono font-bold text-purple-400">
                      +${details.savingsUSD.toFixed(2)}
                    </span>
                    <span className="text-[10px] font-mono text-white/25 block">
                      RLUSD
                    </span>
                  </div>
                </>
              )}
            </div>

            {details.payoutTriggered && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="rounded-xl bg-purple-500/[0.08] border border-purple-500/20 p-3 text-center"
              >
                <span className="text-[14px]">🚀</span>
                <p className="text-[12px] font-mono font-bold text-purple-400 mt-1">
                  RLUSD Payout Sent!
                </p>
                <p className="text-[10px] font-mono text-white/30">
                  ${details.savingsPaid?.toFixed(2)} total paid to your XRPL wallet
                </p>
              </motion.div>
            )}

            {!details.payoutTriggered && details.savingsPending !== undefined && (
              <p className="text-[10px] font-mono text-purple-400/40">
                💎 ${details.savingsPending.toFixed(2)} pending →
                payout at $1.00
              </p>
            )}

            <p className="text-[11px] font-mono text-white/20">
              Thank you for helping your neighbourhood stay resilient.
            </p>

            <a
              href="/simulation"
              className="inline-block text-[12px] font-mono px-6 py-3 rounded-xl border border-[#22c55e]/20 text-[#22c55e]/60 hover:bg-[#22c55e]/[0.06] transition-all"
            >
              Open Dashboard →
            </a>
          </motion.div>
        )}

        {/* Declined */}
        {status === "declined" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-5"
          >
            <div className="w-20 h-20 rounded-full bg-white/[0.04] mx-auto flex items-center justify-center">
              <span className="text-[32px] text-white/30">✗</span>
            </div>
            <div>
              <h1 className="text-[18px] font-semibold text-white/60 mb-2">
                Recommendation Declined
              </h1>
              <p className="text-[13px] text-white/30">
                No changes were made to your thermostat.
              </p>
            </div>
            <a
              href="/simulation"
              className="inline-block text-[12px] font-mono px-6 py-3 rounded-xl border border-white/[0.08] text-white/30 hover:bg-white/[0.03] transition-all"
            >
              Open Dashboard →
            </a>
          </motion.div>
        )}

        {/* Error */}
        {status === "error" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-5"
          >
            <div className="w-20 h-20 rounded-full bg-red-500/10 mx-auto flex items-center justify-center">
              <span className="text-[32px]">⚠️</span>
            </div>
            <div>
              <h1 className="text-[18px] font-semibold text-red-400/70 mb-2">
                Something Went Wrong
              </h1>
              <p className="text-[13px] text-white/30">
                {details.error ?? "The recommendation may have already been processed."}
              </p>
            </div>
            <a
              href="/simulation"
              className="inline-block text-[12px] font-mono px-6 py-3 rounded-xl border border-white/[0.08] text-white/30 hover:bg-white/[0.03] transition-all"
            >
              Open Dashboard →
            </a>
          </motion.div>
        )}
      </motion.div>
    </main>
  );
}
