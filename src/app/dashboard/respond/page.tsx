"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";

/**
 * /dashboard/respond?alertId=xxx&action=ACCEPT&profileId=xxx
 *
 * This page is opened when the user taps Accept or Decline
 * on the iOS push notification. It processes the action
 * and shows a confirmation screen, then links to the dashboard.
 */
export default function DashboardRespondPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-6">
          <div className="w-16 h-16 rounded-full border-2 border-[#22c55e]/30 border-t-[#22c55e] mx-auto animate-spin" />
        </main>
      }
    >
      <RespondContent />
    </Suspense>
  );
}

function RespondContent() {
  const params = useSearchParams();
  const alertId = params.get("alertId");
  const action = params.get("action"); // "ACCEPT" or "DECLINE"
  const profileId = params.get("profileId") || "e2bfe115-5417-4d25-bac6-d5e299d8c6f5";

  const [status, setStatus] = useState<
    "processing" | "success" | "declined" | "error"
  >("processing");
  const [details, setDetails] = useState<{
    savingsAdded?: number;
    savingsPending?: number;
    payoutSent?: boolean;
    payoutTxHash?: string;
    deviceType?: string;
    alertTitle?: string;
    error?: string;
  }>({});

  const processAction = useCallback(async () => {
    if (!alertId || !action) {
      setStatus("error");
      setDetails({ error: "Missing alert ID or action." });
      return;
    }

    try {
      const response = action.toUpperCase() === "ACCEPT" ? "ACCEPT" : "DECLINE";

      const res = await fetch("/api/alerts/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId, response }),
      });
      const data = await res.json();

      if (!data.ok) {
        setStatus("error");
        setDetails({ error: data.error ?? "Something went wrong." });
        return;
      }

      if (response === "ACCEPT") {
        setStatus("success");
        setDetails({
          savingsAdded: data.savingsAdded,
          savingsPending: data.savingsPending,
          payoutSent: data.payoutSent,
          payoutTxHash: data.payoutTxHash,
          deviceType: data.deviceType,
        });
      } else {
        setStatus("declined");
      }
    } catch {
      setStatus("error");
      setDetails({ error: "Network error. Please try again." });
    }
  }, [alertId, action]);

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
              Processing your response...
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
              <span className="text-[40px]">&#10003;</span>
            </motion.div>
            <div>
              <h1 className="text-[22px] font-bold text-[#22c55e] mb-2">
                Action Accepted
              </h1>
              <p className="text-[14px] text-white/50">
                Your smart device has been optimized for energy savings.
              </p>
            </div>

            <div className="flex justify-center gap-6">
              {details.savingsAdded !== undefined && details.savingsAdded > 0 && (
                <div className="text-center">
                  <span className="text-[10px] font-mono text-white/25 block">
                    EARNED
                  </span>
                  <span className="text-[28px] font-mono font-bold text-purple-400">
                    +${details.savingsAdded.toFixed(2)}
                  </span>
                  <span className="text-[10px] font-mono text-white/25 block">
                    RLUSD
                  </span>
                </div>
              )}
              {details.savingsPending !== undefined && (
                <>
                  <div className="w-px bg-white/[0.06]" />
                  <div className="text-center">
                    <span className="text-[10px] font-mono text-white/25 block">
                      PENDING
                    </span>
                    <span className="text-[28px] font-mono font-bold text-amber-400">
                      ${details.savingsPending.toFixed(2)}
                    </span>
                    <span className="text-[10px] font-mono text-white/25 block">
                      RLUSD
                    </span>
                  </div>
                </>
              )}
            </div>

            {details.payoutSent && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="rounded-xl bg-purple-500/[0.08] border border-purple-500/20 p-3 text-center"
              >
                <span className="text-[14px]">&#x1F680;</span>
                <p className="text-[12px] font-mono font-bold text-purple-400 mt-1">
                  RLUSD Payout Sent!
                </p>
                {details.payoutTxHash && (
                  <p className="text-[10px] font-mono text-white/30">
                    TX: {details.payoutTxHash.slice(0, 20)}...
                  </p>
                )}
              </motion.div>
            )}

            {!details.payoutSent && details.savingsPending !== undefined && (
              <p className="text-[10px] font-mono text-purple-400/40">
                ${details.savingsPending.toFixed(2)} pending — payout at $1.00
              </p>
            )}

            <p className="text-[11px] font-mono text-white/20">
              Thank you for helping your neighbourhood stay resilient.
            </p>

            <a
              href={`/dashboard?id=${profileId}`}
              className="inline-block text-[12px] font-mono px-6 py-3 rounded-xl border border-[#22c55e]/20 text-[#22c55e]/60 hover:bg-[#22c55e]/[0.06] transition-all"
            >
              Open Dashboard &#8594;
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
              <span className="text-[32px] text-white/30">&#10007;</span>
            </div>
            <div>
              <h1 className="text-[18px] font-semibold text-white/60 mb-2">
                Alert Declined
              </h1>
              <p className="text-[13px] text-white/30">
                No changes were made to your devices.
              </p>
            </div>
            <a
              href={`/dashboard?id=${profileId}`}
              className="inline-block text-[12px] font-mono px-6 py-3 rounded-xl border border-white/[0.08] text-white/30 hover:bg-white/[0.03] transition-all"
            >
              Open Dashboard &#8594;
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
              <span className="text-[32px]">&#9888;&#65039;</span>
            </div>
            <div>
              <h1 className="text-[18px] font-semibold text-red-400/70 mb-2">
                Something Went Wrong
              </h1>
              <p className="text-[13px] text-white/30">
                {details.error ?? "The alert may have already been processed."}
              </p>
            </div>
            <a
              href={`/dashboard?id=${profileId}`}
              className="inline-block text-[12px] font-mono px-6 py-3 rounded-xl border border-white/[0.08] text-white/30 hover:bg-white/[0.03] transition-all"
            >
              Open Dashboard &#8594;
            </a>
          </motion.div>
        )}
      </motion.div>
    </main>
  );
}
