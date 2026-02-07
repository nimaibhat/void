"use client";

import { useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";

/* ------------------------------------------------------------------ */
/*  Types (mirrors Enode API shapes)                                   */
/* ------------------------------------------------------------------ */
interface DeviceInfo {
  id: string;
  deviceType: string;
  vendor: string;
  isReachable: boolean;
  lastSeen: string;
  chargeState?: {
    isPluggedIn?: boolean;
    isCharging?: boolean;
    chargeRate?: number | null;
    powerDelivery?: number | null;
    batteryLevel?: number | null;
    range?: number | null;
  };
  currentTemperature?: number | null;
  targetTemperature?: number | null;
  operationMode?: string | null;
  temperatureState?: {
    currentTemperature?: number | null;
    isActive?: boolean;
  };
  thermostatState?: {
    mode?: string | null;
    holdType?: string | null;
    heatSetpoint?: number | null;
    coolSetpoint?: number | null;
  };
  capabilities?: {
    capableModes?: string[];
    heatSetpointRange?: { min: number; max: number } | null;
  };
  productionState?: {
    isProducing?: boolean;
    productionRate?: number | null;
  };
  information?: {
    brand?: string;
    model?: string;
    year?: number | null;
  };
}

interface ActionResult {
  id: string;
  state: string;
  kind: string;
  createdAt: string;
}

interface LogEntry {
  time: string;
  msg: string;
  type: "ok" | "err" | "info" | "action";
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function ts() {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const DEVICE_ICONS: Record<string, string> = {
  charger: "⚡",
  hvac: "🌡️",
  battery: "🔋",
  vehicle: "🚗",
  solarInverter: "☀️",
};

/* ------------------------------------------------------------------ */
/*  Device Card                                                        */
/* ------------------------------------------------------------------ */
function DeviceCard({
  device,
  onAction,
}: {
  device: DeviceInfo;
  onAction: (deviceId: string, deviceType: string, action: unknown) => void;
}) {
  const [targetTemp, setTargetTemp] = useState("22");

  const icon = DEVICE_ICONS[device.deviceType] ?? "📡";
  const brand = device.information?.brand ?? device.vendor;
  const model = device.information?.model ?? "";

  return (
    <div className="border border-white/[0.08] bg-white/[0.02] rounded-lg p-5 hover:border-[#22c55e]/30 transition-all">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-2xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-mono font-bold text-white/90">
              {device.deviceType}
            </span>
            <span
              className={`w-2 h-2 rounded-full ${
                device.isReachable ? "bg-[#22c55e]" : "bg-red-400"
              }`}
              style={
                device.isReachable
                  ? { animation: "pulse-dot 2s ease-in-out infinite" }
                  : {}
              }
            />
          </div>
          <p className="text-[11px] font-mono text-white/40 truncate">
            {brand} {model} · {device.id.slice(0, 12)}…
          </p>
        </div>
      </div>

      <div className="space-y-1.5 mb-4">
        {device.chargeState && (
          <>
            {device.chargeState.batteryLevel != null && (
              <div className="flex justify-between">
                <span className="text-[10px] font-mono text-white/30">Battery</span>
                <span className="text-[10px] font-mono text-white/60">{device.chargeState.batteryLevel}%</span>
              </div>
            )}
            {device.chargeState.isCharging != null && (
              <div className="flex justify-between">
                <span className="text-[10px] font-mono text-white/30">Charging</span>
                <span className={`text-[10px] font-mono ${device.chargeState.isCharging ? "text-[#22c55e]" : "text-white/40"}`}>
                  {device.chargeState.isCharging ? "YES" : "NO"}
                </span>
              </div>
            )}
            {device.chargeState.isPluggedIn != null && (
              <div className="flex justify-between">
                <span className="text-[10px] font-mono text-white/30">Plugged in</span>
                <span className="text-[10px] font-mono text-white/60">{device.chargeState.isPluggedIn ? "YES" : "NO"}</span>
              </div>
            )}
            {device.chargeState.range != null && (
              <div className="flex justify-between">
                <span className="text-[10px] font-mono text-white/30">Range</span>
                <span className="text-[10px] font-mono text-white/60">{device.chargeState.range} mi</span>
              </div>
            )}
          </>
        )}
        {(device.temperatureState?.currentTemperature != null || device.currentTemperature != null) && (
          <div className="flex justify-between">
            <span className="text-[10px] font-mono text-white/30">Current temp</span>
            <span className="text-[10px] font-mono text-white/60">
              {device.temperatureState?.currentTemperature ?? device.currentTemperature}°C
            </span>
          </div>
        )}
        {device.thermostatState?.heatSetpoint != null && (
          <div className="flex justify-between">
            <span className="text-[10px] font-mono text-white/30">Heat setpoint</span>
            <span className="text-[10px] font-mono text-[#22c55e]">{device.thermostatState.heatSetpoint}°C</span>
          </div>
        )}
        {(device.thermostatState?.mode || device.operationMode) && (
          <div className="flex justify-between">
            <span className="text-[10px] font-mono text-white/30">Mode</span>
            <span className={`text-[10px] font-mono ${
              (device.thermostatState?.mode ?? device.operationMode) === "OFF" ? "text-red-400/60" : "text-[#22c55e]"
            }`}>
              {device.thermostatState?.mode ?? device.operationMode}
            </span>
          </div>
        )}
        {device.thermostatState?.holdType && (
          <div className="flex justify-between">
            <span className="text-[10px] font-mono text-white/30">Hold</span>
            <span className="text-[10px] font-mono text-white/60">{device.thermostatState.holdType}</span>
          </div>
        )}
        {device.capabilities?.capableModes && (
          <div className="flex justify-between">
            <span className="text-[10px] font-mono text-white/30">Modes</span>
            <span className="text-[10px] font-mono text-white/40">{device.capabilities.capableModes.join(", ")}</span>
          </div>
        )}
        {device.productionState && (
          <>
            <div className="flex justify-between">
              <span className="text-[10px] font-mono text-white/30">Producing</span>
              <span className={`text-[10px] font-mono ${device.productionState.isProducing ? "text-[#22c55e]" : "text-white/40"}`}>
                {device.productionState.isProducing ? "YES" : "NO"}
              </span>
            </div>
            {device.productionState.productionRate != null && (
              <div className="flex justify-between">
                <span className="text-[10px] font-mono text-white/30">Output</span>
                <span className="text-[10px] font-mono text-white/60">{device.productionState.productionRate} kW</span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="space-y-2">
        {(device.deviceType === "charger" || device.deviceType === "vehicle") && (
          <div className="flex gap-2">
            <button
              onClick={() => onAction(device.id, device.deviceType, "START")}
              className="flex-1 text-[11px] font-mono py-2 rounded border border-[#22c55e]/30 text-[#22c55e]/70 bg-[#22c55e]/[0.04] hover:bg-[#22c55e]/[0.12] hover:text-[#22c55e] transition-all cursor-pointer"
            >
              ▶ Start Charging
            </button>
            <button
              onClick={() => onAction(device.id, device.deviceType, "STOP")}
              className="flex-1 text-[11px] font-mono py-2 rounded border border-red-400/30 text-red-400/70 bg-red-400/[0.04] hover:bg-red-400/[0.12] hover:text-red-400 transition-all cursor-pointer"
            >
              ■ Stop Charging
            </button>
          </div>
        )}
        {device.deviceType === "hvac" && (
          <div className="space-y-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="text-[9px] font-mono text-white/25 block mb-1">
                  Heat setpoint (°C, range 15–25)
                </label>
                <input
                  type="number"
                  value={targetTemp}
                  min={15}
                  max={25}
                  onChange={(e) => setTargetTemp(e.target.value)}
                  className="w-full text-[12px] font-mono bg-white/[0.04] border border-white/[0.08] rounded px-3 py-2 text-white/70 focus:outline-none focus:border-[#22c55e]/40"
                />
              </div>
              <button
                onClick={() =>
                  onAction(device.id, "hvac", {
                    mode: "HEAT",
                    heatSetpoint: Number(targetTemp),
                  })
                }
                className="text-[11px] font-mono py-2 px-4 rounded border border-[#22c55e]/30 text-[#22c55e]/70 bg-[#22c55e]/[0.04] hover:bg-[#22c55e]/[0.12] hover:text-[#22c55e] transition-all cursor-pointer"
              >
                Set Heat
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onAction(device.id, "hvac", { mode: "OFF" })}
                className="flex-1 text-[11px] font-mono py-2 rounded border border-red-400/30 text-red-400/70 bg-red-400/[0.04] hover:bg-red-400/[0.12] hover:text-red-400 transition-all cursor-pointer"
              >
                Turn OFF
              </button>
              <button
                onClick={() => onAction(device.id, "hvac", "FOLLOW_SCHEDULE")}
                className="flex-1 text-[11px] font-mono py-2 rounded border border-white/[0.12] text-white/40 bg-white/[0.02] hover:bg-white/[0.06] hover:text-white/60 transition-all cursor-pointer"
              >
                Follow Schedule
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */
export default function DevicesPage() {
  const [userId, setUserId] = useState("");
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);

  const addLog = useCallback((msg: string, type: LogEntry["type"] = "ok") => {
    setLog((prev) => [...prev, { time: ts(), msg, type }]);
  }, []);

  useEffect(() => {
    setLog([
      { time: ts(), msg: "Enode Sandbox Device Controller initialized", type: "info" },
      { time: ts(), msg: 'Enter a user ID and click "Connect Devices" to begin', type: "info" },
    ]);
  }, []);

  const handleConnectDevices = async () => {
    if (!userId.trim()) return;
    setLoading(true);
    const trimmedId = userId.trim();
    try {
      addLog(`Creating Link session for user "${trimmedId}"…`, "info");
      const res = await fetch("/api/enode/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: trimmedId }),
      });
      const data = await res.json();
      if (data.ok) {
        setActiveUserId(trimmedId);
        setLinkUrl(data.linkUrl);
        addLog(`User "${trimmedId}" ready — Link UI session created ✓`, "ok");
        addLog("Click the link below to connect virtual sandbox devices", "info");
      } else {
        addLog(`Error: ${data.error}`, "err");
      }
    } catch (err) {
      addLog(`Network error: ${err}`, "err");
    }
    setLoading(false);
  };

  const handleRefreshDevices = async () => {
    if (!activeUserId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/enode/devices?userId=${encodeURIComponent(activeUserId)}`
      );
      const data = await res.json();
      if (data.ok) {
        setDevices(data.devices);
        addLog(`Found ${data.devices.length} device(s) for user "${activeUserId}"`, "ok");
      } else {
        addLog(`Error fetching devices: ${data.error}`, "err");
      }
    } catch (err) {
      addLog(`Network error: ${err}`, "err");
    }
    setLoading(false);
  };

  const handleDeviceAction = async (
    deviceId: string,
    deviceType: string,
    action: unknown
  ) => {
    addLog(
      `Sending ${JSON.stringify(action)} to ${deviceType} ${deviceId.slice(0, 8)}…`,
      "action"
    );
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
        addLog(
          `Action ${act.kind} → ${act.state} (id: ${act.id.slice(0, 8)}…)`,
          act.state === "FAILED" ? "err" : "ok"
        );
        setTimeout(handleRefreshDevices, 2000);
      } else {
        addLog(`Action failed: ${data.error}`, "err");
      }
    } catch (err) {
      addLog(`Network error: ${err}`, "err");
    }
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <nav className="flex items-center justify-between h-14 border-b border-white/[0.06] px-8">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
          <a href="/" className="text-[15px] font-semibold tracking-tight text-white hover:text-[#22c55e] transition-colors">
            void
          </a>
          <span className="text-white/20 mx-2">/</span>
          <span className="text-[13px] font-mono text-white/50">device sandbox</span>
        </div>
        <a href="/" className="text-[13px] text-white/40 hover:text-[#22c55e] transition-colors font-mono">
          ← Back to Home
        </a>
      </nav>

      <div className="flex h-[calc(100vh-3.5rem)]">
        <div className="flex-1 overflow-y-auto p-8 space-y-6" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}>
          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <h2 className="text-[11px] font-mono text-white/30 uppercase tracking-widest mb-3">
              Step 1 — Connect Virtual Devices
            </h2>
            <p className="text-[10px] font-mono text-white/25 mb-3">
              Enter a user ID (any string — represents a household). This creates the user in Enode&apos;s sandbox and generates a Link URL to connect virtual devices.
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="e.g. household-martinez-78701"
                className="flex-1 text-[13px] font-mono bg-white/[0.04] border border-white/[0.08] rounded-lg px-4 py-3 text-white/70 placeholder:text-white/20 focus:outline-none focus:border-[#22c55e]/40"
              />
              <button
                onClick={handleConnectDevices}
                disabled={loading || !userId.trim()}
                className="text-[12px] font-mono px-6 py-3 rounded-lg border border-[#22c55e]/30 text-[#22c55e]/70 bg-[#22c55e]/[0.04] hover:bg-[#22c55e]/[0.12] hover:text-[#22c55e] transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {loading ? "Connecting…" : "Connect Devices"}
              </button>
            </div>
            {activeUserId && (
              <p className="text-[11px] font-mono text-[#22c55e]/60 mt-2">✓ Active user: {activeUserId}</p>
            )}
          </motion.section>

          {linkUrl && (
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
              <h2 className="text-[11px] font-mono text-white/30 uppercase tracking-widest mb-3">
                Step 2 — Open Enode Link UI
              </h2>
              <div className="flex gap-3 items-center">
                <a
                  href={linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] font-mono px-6 py-3 rounded-lg border border-amber-400/30 text-amber-400/70 bg-amber-400/[0.04] hover:bg-amber-400/[0.12] hover:text-amber-400 transition-all"
                >
                  Open Enode Link UI →
                </a>
                <button
                  onClick={handleConnectDevices}
                  disabled={loading}
                  className="text-[11px] font-mono px-4 py-3 rounded-lg border border-white/[0.08] text-white/40 hover:border-[#22c55e]/30 hover:text-[#22c55e]/70 transition-all cursor-pointer disabled:opacity-30"
                >
                  ↻ Regenerate Link
                </button>
              </div>
              <p className="text-[10px] font-mono text-white/25 mt-2">
                In the Link UI, choose a vendor and connect a virtual charger, thermostat, etc. Then come back here and click Refresh below.
              </p>
            </motion.section>
          )}

          {activeUserId && (
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[11px] font-mono text-white/30 uppercase tracking-widest">
                  Step 3 — Control Devices
                </h2>
                <button
                  onClick={handleRefreshDevices}
                  disabled={loading}
                  className="text-[11px] font-mono px-4 py-1.5 rounded border border-white/[0.08] text-white/40 hover:border-[#22c55e]/30 hover:text-[#22c55e]/70 transition-all cursor-pointer disabled:opacity-30"
                >
                  ↻ Refresh
                </button>
              </div>

              {devices.length === 0 ? (
                <div className="border border-dashed border-white/[0.08] rounded-lg p-8 text-center">
                  <p className="text-[12px] font-mono text-white/25">No devices connected yet.</p>
                  <p className="text-[10px] font-mono text-white/15 mt-1">
                    Use the Link UI above to connect sandbox devices, then click Refresh.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {devices.map((device) => (
                    <DeviceCard key={device.id} device={device} onAction={handleDeviceAction} />
                  ))}
                </div>
              )}
            </motion.section>
          )}
        </div>

        <div className="w-[380px] border-l border-white/[0.06] flex flex-col flex-shrink-0">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06]">
            <div className="flex gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#ff5f57]" />
              <span className="w-2 h-2 rounded-full bg-[#febc2e]" />
              <span className="w-2 h-2 rounded-full bg-[#28c840]" />
            </div>
            <span className="text-[10px] font-mono text-white/30 ml-1">enode-sandbox-log</span>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" style={{ animation: "pulse-dot 2s ease-in-out infinite" }} />
              <span className="text-[9px] font-mono text-[#22c55e]/60">LIVE</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-1" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}>
            {log.map((entry, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.15 }}
                className="text-[10px] font-mono leading-relaxed"
              >
                <span className="text-[#22c55e]/25">{entry.time}</span>{" "}
                <span
                  className={
                    entry.type === "err"
                      ? "text-red-400/70"
                      : entry.type === "action"
                      ? "text-amber-400/60"
                      : entry.type === "info"
                      ? "text-white/30"
                      : "text-[#22c55e]/50"
                  }
                >
                  {entry.msg}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
