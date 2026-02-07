"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import type { DeviceInfo, ActionResult } from "@/types/enode";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface DashboardDevice {
  name: string;
  icon: string;
  status: string;
  value: string;
  brand?: string;
  model?: string;
  type?: string;
}

interface EnhancedSmartDevicesPanelProps {
  devices: DashboardDevice[];
  enodeUserId: string | null;
  onEnodeUserIdChange: (id: string) => void;
  profileId: string | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const ENODE_TYPE_MAP: Record<string, string> = {
  thermostat: "hvac",
  ev_charger: "charger",
  battery: "battery",
  solar_inverter: "solarInverter",
  smart_water_heater: "hvac",
  pool_pump: "charger",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-[#22c55e]",
  scheduled: "bg-[#f59e0b]",
  deferred: "bg-[#71717a]",
  idle: "bg-[#52525b]",
};

/* ------------------------------------------------------------------ */
/*  Enode Device Card (inline controls)                                */
/* ------------------------------------------------------------------ */
function EnodeDeviceOverlay({
  enodeDevice,
  onAction,
}: {
  enodeDevice: DeviceInfo;
  onAction: (deviceId: string, deviceType: string, action: unknown) => void;
}) {
  const [targetTemp, setTargetTemp] = useState("22");

  return (
    <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2">
      <div className="flex items-center gap-1.5">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            enodeDevice.isReachable ? "bg-[#22c55e]" : "bg-red-400"
          }`}
        />
        <span className="text-[9px] font-mono text-white/30">
          Enode: {enodeDevice.deviceType} ·{" "}
          {enodeDevice.isReachable ? "online" : "offline"}
        </span>
      </div>

      {/* Status data */}
      <div className="space-y-1">
        {enodeDevice.chargeState?.batteryLevel != null && (
          <div className="flex justify-between">
            <span className="text-[9px] font-mono text-white/25">Battery</span>
            <span className="text-[9px] font-mono text-white/50">
              {enodeDevice.chargeState.batteryLevel}%
            </span>
          </div>
        )}
        {enodeDevice.chargeState?.isCharging != null && (
          <div className="flex justify-between">
            <span className="text-[9px] font-mono text-white/25">
              Charging
            </span>
            <span
              className={`text-[9px] font-mono ${
                enodeDevice.chargeState.isCharging
                  ? "text-[#22c55e]"
                  : "text-white/30"
              }`}
            >
              {enodeDevice.chargeState.isCharging ? "YES" : "NO"}
            </span>
          </div>
        )}
        {(enodeDevice.temperatureState?.currentTemperature != null ||
          enodeDevice.currentTemperature != null) && (
          <div className="flex justify-between">
            <span className="text-[9px] font-mono text-white/25">
              Current temp
            </span>
            <span className="text-[9px] font-mono text-white/50">
              {enodeDevice.temperatureState?.currentTemperature ??
                enodeDevice.currentTemperature}
              °C
            </span>
          </div>
        )}
        {enodeDevice.thermostatState?.heatSetpoint != null && (
          <div className="flex justify-between">
            <span className="text-[9px] font-mono text-white/25">
              Heat setpoint
            </span>
            <span className="text-[9px] font-mono text-[#22c55e]">
              {enodeDevice.thermostatState.heatSetpoint}°C
            </span>
          </div>
        )}
        {(enodeDevice.thermostatState?.mode || enodeDevice.operationMode) && (
          <div className="flex justify-between">
            <span className="text-[9px] font-mono text-white/25">Mode</span>
            <span
              className={`text-[9px] font-mono ${
                (enodeDevice.thermostatState?.mode ??
                  enodeDevice.operationMode) === "OFF"
                  ? "text-red-400/60"
                  : "text-[#22c55e]"
              }`}
            >
              {enodeDevice.thermostatState?.mode ?? enodeDevice.operationMode}
            </span>
          </div>
        )}
        {enodeDevice.productionState && (
          <div className="flex justify-between">
            <span className="text-[9px] font-mono text-white/25">
              Producing
            </span>
            <span
              className={`text-[9px] font-mono ${
                enodeDevice.productionState.isProducing
                  ? "text-[#22c55e]"
                  : "text-white/30"
              }`}
            >
              {enodeDevice.productionState.isProducing ? "YES" : "NO"}
              {enodeDevice.productionState.productionRate != null &&
                ` · ${enodeDevice.productionState.productionRate} kW`}
            </span>
          </div>
        )}
      </div>

      {/* Inline controls by device type */}
      {(enodeDevice.deviceType === "charger" ||
        enodeDevice.deviceType === "vehicle") && (
        <div className="flex gap-1.5">
          <button
            onClick={() => onAction(enodeDevice.id, enodeDevice.deviceType, "START")}
            className="flex-1 text-[9px] font-mono py-1.5 rounded border border-[#22c55e]/30 text-[#22c55e]/70 bg-[#22c55e]/[0.04] hover:bg-[#22c55e]/[0.12] transition-all cursor-pointer"
          >
            Start
          </button>
          <button
            onClick={() => onAction(enodeDevice.id, enodeDevice.deviceType, "STOP")}
            className="flex-1 text-[9px] font-mono py-1.5 rounded border border-red-400/30 text-red-400/70 bg-red-400/[0.04] hover:bg-red-400/[0.12] transition-all cursor-pointer"
          >
            Stop
          </button>
        </div>
      )}
      {enodeDevice.deviceType === "hvac" && (
        <div className="space-y-1.5">
          <div className="flex gap-1.5 items-end">
            <input
              type="number"
              value={targetTemp}
              min={15}
              max={25}
              onChange={(e) => setTargetTemp(e.target.value)}
              className="flex-1 text-[10px] font-mono bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1.5 text-white/70 focus:outline-none focus:border-[#22c55e]/40"
            />
            <button
              onClick={() =>
                onAction(enodeDevice.id, "hvac", {
                  mode: "HEAT",
                  heatSetpoint: Number(targetTemp),
                })
              }
              className="text-[9px] font-mono py-1.5 px-3 rounded border border-[#22c55e]/30 text-[#22c55e]/70 bg-[#22c55e]/[0.04] hover:bg-[#22c55e]/[0.12] transition-all cursor-pointer"
            >
              Set Heat
            </button>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => onAction(enodeDevice.id, "hvac", { mode: "OFF" })}
              className="flex-1 text-[9px] font-mono py-1.5 rounded border border-red-400/30 text-red-400/70 bg-red-400/[0.04] hover:bg-red-400/[0.12] transition-all cursor-pointer"
            >
              Turn OFF
            </button>
            <button
              onClick={() =>
                onAction(enodeDevice.id, "hvac", "FOLLOW_SCHEDULE")
              }
              className="flex-1 text-[9px] font-mono py-1.5 rounded border border-white/[0.12] text-white/40 bg-white/[0.02] hover:bg-white/[0.06] transition-all cursor-pointer"
            >
              Follow Schedule
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */
export default function EnhancedSmartDevicesPanel({
  devices,
  enodeUserId,
  onEnodeUserIdChange,
  profileId,
}: EnhancedSmartDevicesPanelProps) {
  const [enodeDevices, setEnodeDevices] = useState<DeviceInfo[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [polling, setPolling] = useState(false);

  // Fetch Enode devices
  const fetchEnodeDevices = useCallback(async () => {
    if (!enodeUserId) return;
    try {
      const res = await fetch(
        `/api/enode/devices?userId=${encodeURIComponent(enodeUserId)}`
      );
      const data = await res.json();
      if (data.ok) {
        setEnodeDevices(data.devices ?? []);
      }
    } catch {
      /* silent */
    }
  }, [enodeUserId]);

  // Poll Enode devices every 15s when connected
  useEffect(() => {
    if (!enodeUserId) return;
    fetchEnodeDevices();
    setPolling(true);
    const interval = setInterval(fetchEnodeDevices, 15_000);
    return () => {
      clearInterval(interval);
      setPolling(false);
    };
  }, [enodeUserId, fetchEnodeDevices]);

  // Connect devices via Enode Link
  const handleConnect = async () => {
    setConnecting(true);
    try {
      // Auto-generate userId from profileId
      const userId = profileId
        ? `household-${profileId}`
        : `household-${Date.now()}`;

      const redirectUri = profileId
        ? `${window.location.origin}/dashboard?id=${profileId}&linked=true`
        : `${window.location.origin}/dashboard?linked=true`;

      const res = await fetch("/api/enode/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, redirectUri }),
      });
      const data = await res.json();
      if (data.ok && data.linkUrl) {
        // Save enodeUserId
        onEnodeUserIdChange(userId);

        // Persist to consumer_profiles via API
        if (profileId) {
          try {
            await fetch("/api/profile/update-enode", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ profileId, enodeUserId: userId }),
            });
          } catch {
            /* non-critical */
          }
        }

        // Open Enode Link UI in new tab
        window.open(data.linkUrl, "_blank");
      }
    } catch {
      /* silent */
    }
    setConnecting(false);
  };

  // Handle device action
  const handleDeviceAction = async (
    deviceId: string,
    deviceType: string,
    action: unknown
  ) => {
    try {
      const res = await fetch(
        `/api/enode/devices/${encodeURIComponent(deviceId)}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceType, action }),
        }
      );
      const data = await res.json();
      if (data.ok) {
        const act = data.action as ActionResult;
        console.log(
          `[enode] Action ${act.kind} → ${act.state}`
        );
        // Refresh after 2s
        setTimeout(fetchEnodeDevices, 2000);
      }
    } catch {
      /* silent */
    }
  };

  // Only show Enode devices, no hardcoded devices from database
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 min-h-[280px]"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Smart Devices</h3>
        <div className="flex items-center gap-2">
          {enodeUserId && polling && (
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
              <span className="text-[9px] font-mono text-[#22c55e]/60">
                LIVE
              </span>
            </span>
          )}
          {!enodeUserId ? (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="text-[11px] font-mono px-3 py-1.5 rounded-lg border border-[#22c55e]/30 text-[#22c55e]/70 bg-[#22c55e]/[0.04] hover:bg-[#22c55e]/[0.12] hover:text-[#22c55e] transition-all cursor-pointer disabled:opacity-30"
            >
              {connecting ? "Connecting..." : "Connect Devices"}
            </button>
          ) : (
            <button
              onClick={fetchEnodeDevices}
              className="text-[10px] font-mono px-2 py-1 rounded border border-white/[0.08] text-white/30 hover:text-[#22c55e]/70 hover:border-[#22c55e]/30 transition-all cursor-pointer"
            >
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Show message if no devices connected */}
      {!enodeUserId || enodeDevices.length === 0 ? (
        <div className="flex items-center justify-center min-h-[180px]">
          <div className="text-center">
            <span className="text-sm text-[#555] font-mono block mb-2">
              {!enodeUserId
                ? "No devices connected"
                : "No Enode devices found"}
            </span>
            {!enodeUserId && (
              <span className="text-xs text-[#444] font-mono">
                Click "Connect Devices" to link your smart devices
              </span>
            )}
          </div>
        </div>
      ) : (
        /* Device list - only show Enode devices */
        <div className="space-y-3">
          {enodeDevices.map((ed) => (
            <div
              key={ed.id}
              className="p-3 rounded-lg bg-[#0a0a0a] border border-[#1a1a1a] hover:border-[#22c55e]/20 transition-all"
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    ed.isReachable ? "bg-[#22c55e]" : "bg-red-400"
                  }`}
                />
                <span className="text-sm font-medium text-white">
                  {ed.information?.brand ?? ed.vendor}{" "}
                  {ed.information?.model ?? ed.deviceType}
                </span>
              </div>
              <EnodeDeviceOverlay
                enodeDevice={ed}
                onAction={handleDeviceAction}
              />
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
