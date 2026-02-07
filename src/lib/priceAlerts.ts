/**
 * Price-driven smart alert generation.
 *
 * Fetches 48-hour price forecast from the backend, analyzes the price curve
 * to find spikes / valleys / optimal shift windows, then generates
 * natural-language savings alerts per device.
 *
 * Each alert includes a computed $ savings value and an action the user
 * can accept to trigger device control via Enode.
 */

import type { AlertData } from "@/components/AlertsPanel";
import type { HourlyPrice } from "@/lib/api";
import { fetchPrices } from "@/lib/api";
import type { RuleAnalysisItem } from "@/lib/claude-alerts";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SmartDevice {
  type: string;
  name: string;
  level_pct?: number;
  capacity_kw?: number;
  level?: string;
  note?: string;
}

export interface PriceWindow {
  startHour: number;
  endHour: number;
  avgPrice: number;
  label: string;
}

export interface AlertAction {
  alertId: string;
  deviceType: string;
  deviceName: string;
  actionType:
    | "pause_charger"
    | "shift_charge"
    | "pre_cool"
    | "raise_setpoint"
    | "charge_battery"
    | "discharge_battery"
    | "shift_appliance";
  params: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SPIKE_THRESHOLD_KWH = 0.25;
const VALLEY_THRESHOLD_KWH = 0.08;
const EV_CHARGE_KW = 7.2; // Level 2 charger
const EV_CHARGE_HOURS = 3;
const HVAC_KW = 3.5; // avg central AC/heat
const BATTERY_KW = 5.0; // Powerwall discharge rate
const POOL_PUMP_KW = 1.5;
const WATER_HEATER_KW = 4.5;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatPrice(kwh: number): string {
  return `$${kwh.toFixed(2)}/kWh`;
}

function formatSavings(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

function formatHour(hour: number): string {
  const h = hour % 24;
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

/** Find the cheapest N-hour contiguous window in the forecast. */
function findCheapestWindow(
  prices: HourlyPrice[],
  windowHours: number
): PriceWindow | null {
  if (prices.length < windowHours) return null;
  let bestStart = 0;
  let bestAvg = Infinity;

  for (let i = 0; i <= prices.length - windowHours; i++) {
    let sum = 0;
    for (let j = i; j < i + windowHours; j++) {
      sum += prices[j].consumer_price_kwh;
    }
    const avg = sum / windowHours;
    if (avg < bestAvg) {
      bestAvg = avg;
      bestStart = i;
    }
  }

  return {
    startHour: bestStart,
    endHour: bestStart + windowHours,
    avgPrice: bestAvg,
    label: `${formatHour(prices[bestStart].hour)} – ${formatHour(prices[bestStart + windowHours - 1].hour)}`,
  };
}

/** Find the most expensive N-hour contiguous window. */
function findPeakWindow(
  prices: HourlyPrice[],
  windowHours: number
): PriceWindow | null {
  if (prices.length < windowHours) return null;
  let bestStart = 0;
  let bestAvg = -Infinity;

  for (let i = 0; i <= prices.length - windowHours; i++) {
    let sum = 0;
    for (let j = i; j < i + windowHours; j++) {
      sum += prices[j].consumer_price_kwh;
    }
    const avg = sum / windowHours;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestStart = i;
    }
  }

  return {
    startHour: bestStart,
    endHour: bestStart + windowHours,
    avgPrice: bestAvg,
    label: `${formatHour(prices[bestStart].hour)} – ${formatHour(prices[bestStart + windowHours - 1].hour)}`,
  };
}

/** Get the current-hour price (hour 0 in the forecast). */
function currentPrice(prices: HourlyPrice[]): number {
  return prices[0]?.consumer_price_kwh ?? 0.12;
}

let _alertIdCounter = 0;
function nextAlertId(): string {
  return `price-alert-${++_alertIdCounter}-${Date.now().toString(36)}`;
}

/* ------------------------------------------------------------------ */
/*  Per-device alert generators                                        */
/* ------------------------------------------------------------------ */

function evChargerAlerts(
  prices: HourlyPrice[],
  device: SmartDevice
): { alert: AlertData; action: AlertAction; analysis: RuleAnalysisItem }[] {
  const alerts: { alert: AlertData; action: AlertAction; analysis: RuleAnalysisItem }[] = [];
  const now = currentPrice(prices);
  const cheapest = findCheapestWindow(prices, EV_CHARGE_HOURS);
  const peak = findPeakWindow(prices, EV_CHARGE_HOURS);
  if (!cheapest) return alerts;

  // Only generate if there's meaningful savings
  const savingsPerHour = (now - cheapest.avgPrice) * EV_CHARGE_KW;
  const totalSavings = savingsPerHour * EV_CHARGE_HOURS;

  if (totalSavings > 0.5 && now > SPIKE_THRESHOLD_KWH) {
    const id = nextAlertId();
    alerts.push({
      alert: {
        id,
        severity: "optimization",
        title: `Shift ${device.name} to ${cheapest.label}`,
        description: `Prices spike to ${formatPrice(now)} now. Charge at ${formatHour(cheapest.startHour)} (${formatPrice(cheapest.avgPrice)}) — you'll save ${formatSavings(totalSavings)}. Want me to do it?`,
        timestamp: "now",
        action: { label: "Accept", variant: "primary" },
      },
      action: {
        alertId: id,
        deviceType: "ev_charger",
        deviceName: device.name,
        actionType: "shift_charge",
        params: { startHour: cheapest.startHour, endHour: cheapest.endHour },
      },
      analysis: {
        alertId: id,
        deviceType: "ev_charger",
        deviceName: device.name,
        actionType: "shift_charge",
        savingsDollars: totalSavings,
        currentPriceKwh: now,
        optimalPriceKwh: cheapest.avgPrice,
        optimalWindowLabel: cheapest.label,
        peakWindowLabel: peak?.label ?? "",
      },
    });
  } else if (totalSavings > 0.2) {
    const id = nextAlertId();
    alerts.push({
      alert: {
        id,
        severity: "optimization",
        title: `${device.name} — optimal window at ${formatHour(cheapest.startHour)}`,
        description: `Move your charge to ${cheapest.label} at ${formatPrice(cheapest.avgPrice)} to save ${formatSavings(totalSavings)}.`,
        timestamp: "now",
        action: { label: "Schedule", variant: "secondary" },
      },
      action: {
        alertId: id,
        deviceType: "ev_charger",
        deviceName: device.name,
        actionType: "shift_charge",
        params: { startHour: cheapest.startHour, endHour: cheapest.endHour },
      },
      analysis: {
        alertId: id,
        deviceType: "ev_charger",
        deviceName: device.name,
        actionType: "shift_charge",
        savingsDollars: totalSavings,
        currentPriceKwh: now,
        optimalPriceKwh: cheapest.avgPrice,
        optimalWindowLabel: cheapest.label,
        peakWindowLabel: peak?.label ?? "",
      },
    });
  }

  return alerts;
}

function thermostatAlerts(
  prices: HourlyPrice[],
  device: SmartDevice
): { alert: AlertData; action: AlertAction; analysis: RuleAnalysisItem }[] {
  const alerts: { alert: AlertData; action: AlertAction; analysis: RuleAnalysisItem }[] = [];
  const now = currentPrice(prices);
  const peak = findPeakWindow(prices, 3);
  const cheapest = findCheapestWindow(prices, 2);
  if (!peak || !cheapest) return alerts;

  // Pre-cool/heat during cheap hours before a spike
  if (peak.avgPrice > SPIKE_THRESHOLD_KWH && cheapest.avgPrice < peak.avgPrice * 0.4) {
    const savingsPerHour = (peak.avgPrice - cheapest.avgPrice) * HVAC_KW;
    const totalSavings = savingsPerHour * 2; // 2 hours of pre-conditioning

    if (totalSavings > 0.5) {
      const id = nextAlertId();
      alerts.push({
        alert: {
          id,
          severity: "optimization",
          title: `Pre-cool your home now`,
          description: `Pre-cool to 70\u00b0F now while rates are ${formatPrice(cheapest.avgPrice)}. You'll save ${formatSavings(totalSavings)} vs cooling at ${formatHour(peak.startHour)} peak (${formatPrice(peak.avgPrice)}).`,
          timestamp: "now",
          action: { label: "Accept", variant: "primary" },
        },
        action: {
          alertId: id,
          deviceType: "thermostat",
          deviceName: device.name,
          actionType: "pre_cool",
          params: { targetTemp: 70 },
        },
        analysis: {
          alertId: id,
          deviceType: "thermostat",
          deviceName: device.name,
          actionType: "pre_cool",
          savingsDollars: totalSavings,
          currentPriceKwh: now,
          optimalPriceKwh: cheapest.avgPrice,
          optimalWindowLabel: cheapest.label,
          peakWindowLabel: peak.label,
        },
      });
    }
  }

  // Raise setpoint during spike
  if (now > SPIKE_THRESHOLD_KWH) {
    const savings = (now - 0.12) * HVAC_KW * 3; // 3 hrs of reduced usage
    if (savings > 0.5) {
      const id = nextAlertId();
      alerts.push({
        alert: {
          id,
          severity: "warning",
          title: `Raise thermostat during price spike`,
          description: `Prices are at ${formatPrice(now)}. Raise your setpoint by 3\u00b0F for the next 3 hours to save ${formatSavings(savings)}.`,
          timestamp: "now",
          action: { label: "Accept", variant: "secondary" },
        },
        action: {
          alertId: id,
          deviceType: "thermostat",
          deviceName: device.name,
          actionType: "raise_setpoint",
          params: { deltaF: 3 },
        },
        analysis: {
          alertId: id,
          deviceType: "thermostat",
          deviceName: device.name,
          actionType: "raise_setpoint",
          savingsDollars: savings,
          currentPriceKwh: now,
          optimalPriceKwh: 0.12,
          optimalWindowLabel: "off-peak",
          peakWindowLabel: peak.label,
        },
      });
    }
  }

  return alerts;
}

function batteryAlerts(
  prices: HourlyPrice[],
  device: SmartDevice
): { alert: AlertData; action: AlertAction; analysis: RuleAnalysisItem }[] {
  const alerts: { alert: AlertData; action: AlertAction; analysis: RuleAnalysisItem }[] = [];
  const valley = findCheapestWindow(prices, 3);
  const peak = findPeakWindow(prices, 3);
  if (!valley || !peak) return alerts;

  const spread = peak.avgPrice - valley.avgPrice;
  if (spread < 0.1) return alerts;

  const arbitrage = spread * BATTERY_KW * 3; // 3 hours of charge/discharge
  const batteryPct = device.level_pct ?? 50;

  if (arbitrage > 1.0) {
    const id = nextAlertId();
    alerts.push({
      alert: {
        id,
        severity: "optimization",
        title: `Battery arbitrage — ${formatSavings(arbitrage)} opportunity`,
        description: `Charge at ${formatHour(valley.startHour)} (${formatPrice(valley.avgPrice)}), discharge at ${formatHour(peak.startHour)} (${formatPrice(peak.avgPrice)}). Net savings: ${formatSavings(arbitrage)}. Battery at ${batteryPct}%.`,
        timestamp: "now",
        action: { label: "Enable", variant: "primary" },
      },
      action: {
        alertId: id,
        deviceType: "battery",
        deviceName: device.name,
        actionType: "charge_battery",
        params: {
          chargeWindow: { start: valley.startHour, end: valley.endHour },
          dischargeWindow: { start: peak.startHour, end: peak.endHour },
        },
      },
      analysis: {
        alertId: id,
        deviceType: "battery",
        deviceName: device.name,
        actionType: "charge_battery",
        savingsDollars: arbitrage,
        currentPriceKwh: currentPrice(prices),
        optimalPriceKwh: valley.avgPrice,
        optimalWindowLabel: valley.label,
        peakWindowLabel: peak.label,
      },
    });
  }

  return alerts;
}

function shiftableApplianceAlerts(
  prices: HourlyPrice[],
  device: SmartDevice,
  powerKw: number
): { alert: AlertData; action: AlertAction; analysis: RuleAnalysisItem }[] {
  const alerts: { alert: AlertData; action: AlertAction; analysis: RuleAnalysisItem }[] = [];
  const now = currentPrice(prices);
  const cheapest = findCheapestWindow(prices, 2);
  const peak = findPeakWindow(prices, 2);
  if (!cheapest) return alerts;

  const savings = (now - cheapest.avgPrice) * powerKw * 2;
  if (savings > 0.3 && now > VALLEY_THRESHOLD_KWH * 2) {
    const id = nextAlertId();
    alerts.push({
      alert: {
        id,
        severity: "optimization",
        title: `Run ${device.name} at ${formatHour(cheapest.startHour)}`,
        description: `Shift your ${device.name.toLowerCase()} to ${cheapest.label} (${formatPrice(cheapest.avgPrice)}) to save ${formatSavings(savings)}.`,
        timestamp: "now",
        action: { label: "Schedule", variant: "secondary" },
      },
      action: {
        alertId: id,
        deviceType: device.type,
        deviceName: device.name,
        actionType: "shift_appliance",
        params: { startHour: cheapest.startHour, endHour: cheapest.endHour },
      },
      analysis: {
        alertId: id,
        deviceType: device.type,
        deviceName: device.name,
        actionType: "shift_appliance",
        savingsDollars: savings,
        currentPriceKwh: now,
        optimalPriceKwh: cheapest.avgPrice,
        optimalWindowLabel: cheapest.label,
        peakWindowLabel: peak?.label ?? "",
      },
    });
  }

  return alerts;
}

/** Generate a renewable surplus alert if prices are very low. */
function surplusAlert(prices: HourlyPrice[]): { alert: AlertData; action: AlertAction } | null {
  // Find a window where prices are near zero or negative
  const freeWindow = prices.filter((p) => p.consumer_price_kwh < 0.04);
  if (freeWindow.length < 2) return null;

  const startHour = freeWindow[0].hour;
  const endHour = freeWindow[freeWindow.length - 1].hour;
  const avgPrice = freeWindow.reduce((s, p) => s + p.consumer_price_kwh, 0) / freeWindow.length;

  const id = nextAlertId();
  return {
    alert: {
      id,
      severity: "optimization",
      title: "Wind surplus — nearly free electricity",
      description: `Electricity is ${formatPrice(avgPrice)} from ${formatHour(startHour)} to ${formatHour(endHour)}. Great time to run your dryer or charge devices.`,
      timestamp: "now",
    },
    action: {
      alertId: id,
      deviceType: "general",
      deviceName: "household",
      actionType: "shift_appliance",
      params: { startHour, endHour },
    },
  };
}

/** Generate a price spike warning if any hour exceeds threshold. */
function spikeWarning(prices: HourlyPrice[]): AlertData | null {
  const spikes = prices.filter((p) => p.consumer_price_kwh > 0.35);
  if (spikes.length === 0) return null;

  const worst = spikes.reduce((a, b) =>
    a.consumer_price_kwh > b.consumer_price_kwh ? a : b
  );

  return {
    id: nextAlertId(),
    severity: "critical",
    title: `Price spike to ${formatPrice(worst.consumer_price_kwh)} at ${formatHour(worst.hour)}`,
    description: `ERCOT wholesale prices are surging. Grid utilization at ${worst.grid_utilization_pct.toFixed(0)}%. Consider reducing non-essential usage.`,
    timestamp: "now",
    action: { label: "View Details \u2192", variant: "primary" },
  };
}

/* ------------------------------------------------------------------ */
/*  Main generator                                                     */
/* ------------------------------------------------------------------ */

export interface GeneratedAlerts {
  alerts: AlertData[];
  actions: AlertAction[];
  prices: HourlyPrice[];
  ruleAnalysis: RuleAnalysisItem[];
}

/**
 * Generate price-driven savings alerts for a user's devices.
 *
 * @param devices  Array of smart devices from the user's Supabase profile
 * @param region   Grid region (default: "ERCOT")
 * @param scenario Pricing scenario (default: "normal")
 * @param zone     ERCOT weather zone for zone-adjusted pricing (optional)
 */
export async function generatePriceAlerts(
  devices: SmartDevice[],
  region = "ERCOT",
  scenario = "normal",
  zone?: string
): Promise<GeneratedAlerts> {
  // Reset counter for fresh IDs
  _alertIdCounter = 0;

  // Fetch 48-hour price forecast from backend
  // Use absolute URL since this runs server-side in API routes
  let prices: HourlyPrice[];
  try {
    const zoneParam = zone ? `&zone=${encodeURIComponent(zone)}` : "";
    const backendUrl = `http://127.0.0.1:8000/api/forecast/prices/${encodeURIComponent(region)}?scenario=${encodeURIComponent(scenario)}${zoneParam}`;
    const res = await fetch(backendUrl);
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    const json = await res.json();
    prices = json.data?.prices ?? [];
  } catch {
    // Backend unavailable — return empty
    return { alerts: [], actions: [], prices: [], ruleAnalysis: [] };
  }

  if (!prices.length) {
    return { alerts: [], actions: [], prices, ruleAnalysis: [] };
  }

  const allAlerts: AlertData[] = [];
  const allActions: AlertAction[] = [];
  const allAnalysis: RuleAnalysisItem[] = [];

  // Spike warning (global, not per-device)
  const spike = spikeWarning(prices);
  if (spike) allAlerts.push(spike);

  // Surplus alert (global)
  const surplus = surplusAlert(prices);
  if (surplus) {
    allAlerts.push(surplus.alert);
    allActions.push(surplus.action);
  }

  // Per-device alerts
  for (const device of devices) {
    let results: { alert: AlertData; action: AlertAction; analysis: RuleAnalysisItem }[] = [];

    switch (device.type) {
      case "ev_charger":
        results = evChargerAlerts(prices, device);
        break;
      case "thermostat":
        results = thermostatAlerts(prices, device);
        break;
      case "battery":
        results = batteryAlerts(prices, device);
        break;
      case "pool_pump":
        results = shiftableApplianceAlerts(prices, device, POOL_PUMP_KW);
        break;
      case "smart_water_heater":
        results = shiftableApplianceAlerts(prices, device, WATER_HEATER_KW);
        break;
      case "dryer":
        results = shiftableApplianceAlerts(prices, device, 5.0);
        break;
    }

    for (const r of results) {
      allAlerts.push(r.alert);
      allActions.push(r.action);
      allAnalysis.push(r.analysis);
    }
  }

  return { alerts: allAlerts, actions: allActions, prices, ruleAnalysis: allAnalysis };
}
