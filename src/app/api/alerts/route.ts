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
import { controlCharging, controlHvac } from "@/lib/enode";
import { sendPushNotification, getBaseUrl } from "@/lib/notify";

/* ------------------------------------------------------------------ */
/*  Supabase (server-side)                                             */
/* ------------------------------------------------------------------ */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

/* ------------------------------------------------------------------ */
/*  In-memory action store (survives hot reloads via globalThis)       */
/* ------------------------------------------------------------------ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
const ACTIONS_KEY = "__blackout_alert_actions__";
if (!g[ACTIONS_KEY]) g[ACTIONS_KEY] = new Map<string, AlertAction>();
function getActionsStore(): Map<string, AlertAction> {
  return g[ACTIONS_KEY];
}

/* ------------------------------------------------------------------ */
/*  GET /api/alerts?profileId=X                                        */
/* ------------------------------------------------------------------ */
export async function GET(req: NextRequest) {
  const profileId = req.nextUrl.searchParams.get("profileId");
  const scenario = req.nextUrl.searchParams.get("scenario") ?? "normal";

  let devices: SmartDevice[] = [];
  let region = "ERCOT";

  if (profileId) {
    const { data, error } = await supabase
      .from("consumer_profiles")
      .select("smart_devices, grid_region")
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
  } else {
    // Default devices for demo
    devices = [
      { type: "thermostat", name: "Thermostat" },
      { type: "ev_charger", name: "EV Charger", level: "Level 2" },
      { type: "battery", name: "Powerwall", level_pct: 78 },
    ];
  }

  const result = await generatePriceAlerts(devices, region, scenario);

  // Store actions so POST can look them up
  const store = getActionsStore();
  for (const action of result.actions) {
    store.set(action.alertId, action);
  }

  return NextResponse.json({
    ok: true,
    alerts: result.alerts,
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

    // Remove from store
    store.delete(alertId);

    return NextResponse.json({
      ok: true,
      alertId,
      action: action.actionType,
      device: action.deviceName,
      enodeResult,
      enodeError,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
