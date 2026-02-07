/**
 * GET  /api/alerts?profileId=X  — Generate price-driven savings alerts for a profile
 * POST /api/alerts              — Accept an alert action (triggers device control + ntfy)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  generatePriceAlerts,
  type SmartDevice,
  type AlertAction,
} from "@/lib/priceAlerts";
import { enhanceAlertsWithClaude, summarizePrices } from "@/lib/claude-alerts";
import { controlCharging, controlHvac } from "@/lib/enode";
import { sendPushNotification, getBaseUrl } from "@/lib/notify";

/* ------------------------------------------------------------------ */
/*  Supabase (server-side)                                             */
/* ------------------------------------------------------------------ */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

/* ------------------------------------------------------------------ */
/*  In-memory action store (survives hot reloads via globalThis)       */
/* ------------------------------------------------------------------ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
const ACTIONS_KEY = "__blackout_alert_actions__";
const SAVINGS_KEY = "__blackout_alert_savings__";
if (!g[ACTIONS_KEY]) g[ACTIONS_KEY] = new Map<string, AlertAction>();
if (!g[SAVINGS_KEY]) g[SAVINGS_KEY] = new Map<string, number>();
function getActionsStore(): Map<string, AlertAction> {
  return g[ACTIONS_KEY];
}
function getSavingsStore(): Map<string, number> {
  return g[SAVINGS_KEY];
}

/* ------------------------------------------------------------------ */
/*  GET /api/alerts?profileId=X                                        */
/* ------------------------------------------------------------------ */
export async function GET(req: NextRequest) {
  const profileId = req.nextUrl.searchParams.get("profileId");
  const scenario = req.nextUrl.searchParams.get("scenario") ?? "live";

  let devices: SmartDevice[] = [];
  let region = "ERCOT";
  let zone: string | undefined;

  if (profileId) {
    const { data, error } = await supabase
      .from("consumer_profiles")
      .select("smart_devices, grid_region, weather_zone")
      .eq("id", profileId)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { ok: false, error: "Profile not found" },
        { status: 404 }
      );
    }

    devices = (data.smart_devices ?? []) as SmartDevice[];
    region = data.grid_region ?? "ERCOT";
    zone = data.weather_zone ?? undefined;
  } else {
    // Default devices for demo
    devices = [
      { type: "thermostat", name: "Thermostat" },
      { type: "ev_charger", name: "EV Charger", level: "Level 2" },
      { type: "battery", name: "Powerwall", level_pct: 78 },
    ];
  }

  const result = await generatePriceAlerts(devices, region, scenario, zone);

  // Enhance alert text with Claude (falls back to rule-based on error/timeout)
  const priceSummary = summarizePrices(result.prices);
  const enhancedAlerts = await enhanceAlertsWithClaude(
    result.alerts,
    priceSummary,
    result.ruleAnalysis
  );

  // Store actions + savings so POST can look them up
  const store = getActionsStore();
  const savingsStore = getSavingsStore();
  for (const action of result.actions) {
    store.set(action.alertId, action);
  }
  for (const item of result.ruleAnalysis) {
    savingsStore.set(item.alertId, item.savingsDollars);
  }

  return NextResponse.json({
    ok: true,
    alerts: enhancedAlerts,
    prices: result.prices,
    actionCount: result.actions.length,
  });
}

/* ------------------------------------------------------------------ */
/*  POST /api/alerts  — Accept an alert action                         */
/* ------------------------------------------------------------------ */
export async function POST(req: NextRequest) {
  try {
    const { alertId, profileId } = await req.json();

    if (!alertId) {
      return NextResponse.json(
        { ok: false, error: "alertId is required" },
        { status: 400 }
      );
    }

    const store = getActionsStore();
    const action = store.get(alertId);
    if (!action) {
      return NextResponse.json(
        { ok: false, error: "Alert action not found or expired" },
        { status: 404 }
      );
    }

    // Attempt device control via Enode (if applicable)
    let enodeResult = null;
    let enodeError = null;

    try {
      switch (action.actionType) {
        case "pause_charger":
        case "shift_charge": {
          // Look up the user's Enode charger ID from profile if available
          // For now, just log the intent — real device control requires Enode link
          console.log(
            `[alerts] Would shift ${action.deviceName} charge to hour ${action.params.startHour}`
          );
          break;
        }
        case "pre_cool":
        case "raise_setpoint": {
          console.log(
            `[alerts] Would adjust ${action.deviceName}: ${action.actionType}`,
            action.params
          );
          break;
        }
        case "charge_battery":
        case "discharge_battery": {
          console.log(
            `[alerts] Would schedule battery: ${action.actionType}`,
            action.params
          );
          break;
        }
        case "shift_appliance": {
          console.log(
            `[alerts] Would shift ${action.deviceName} to hour ${action.params.startHour}`
          );
          break;
        }
      }
    } catch (err) {
      enodeError =
        err instanceof Error ? err.message : String(err);
    }

    // Send push notification confirmation
    const baseUrl = getBaseUrl();
    await sendPushNotification({
      title: "Action Accepted",
      message: `${action.deviceName}: ${action.actionType.replace(/_/g, " ")} scheduled.`,
      priority: 3,
      tags: ["white_check_mark", "zap"],
      clickUrl: profileId
        ? `${baseUrl}/dashboard?id=${profileId}`
        : `${baseUrl}/dashboard`,
      actions: [
        {
          action: "view",
          label: "View Dashboard",
          url: profileId
            ? `${baseUrl}/dashboard?id=${profileId}`
            : `${baseUrl}/dashboard`,
          clear: true,
        },
      ],
    });

    // Increment savings in Supabase for this profile
    const savingsStore = getSavingsStore();
    const savingsAmount = savingsStore.get(alertId) ?? 0;
    if (profileId && savingsAmount > 0) {
      // Fetch current savings, then increment
      const { data: profile } = await supabase
        .from("consumer_profiles")
        .select("estimated_savings_dollars")
        .eq("id", profileId)
        .single();

      const current = Number(profile?.estimated_savings_dollars) || 0;
      await supabase
        .from("consumer_profiles")
        .update({ estimated_savings_dollars: Math.round((current + savingsAmount) * 100) / 100 })
        .eq("id", profileId);
    }

    // Remove from stores
    store.delete(alertId);
    savingsStore.delete(alertId);

    return NextResponse.json({
      ok: true,
      alertId,
      action: action.actionType,
      device: action.deviceName,
      savings: savingsAmount,
      enodeResult,
      enodeError,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
