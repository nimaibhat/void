/**
 * POST /api/orchestrate
 *
 * Generate weather alerts when operator runs simulation.
 * Sends ntfy notifications with Void branding via sendPushNotification.
 * Uses machine IP (not localhost) so phone can reach the dashboard.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import os from "os";
import {
  sendPushNotification,
  setNtfyTopic,
  setBaseUrl,
} from "@/lib/notify";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const NTFY_TOPIC = "void";

/**
 * Get the machine's LAN IP address (e.g. 192.168.x.x)
 */
function getLanIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      // Skip internal (loopback) and non-IPv4
      if (iface.internal || iface.family !== "IPv4") continue;
      return iface.address;
    }
  }
  return null;
}

/**
 * Derive the base URL using the machine's LAN IP so phone can reach the server.
 */
function deriveBaseUrl(req: NextRequest): string {
  // If request came from a LAN IP already (e.g. phone accessing directly), use that
  const host = req.headers.get("host");
  if (host && !host.startsWith("localhost") && !host.startsWith("127.")) {
    const proto = req.headers.get("x-forwarded-proto") || "http";
    return `${proto}://${host}`;
  }

  // Detect machine's LAN IP so phone on same WiFi can reach it
  const lanIp = getLanIp();
  if (lanIp) {
    const port = host?.split(":")[1] || "3000";
    return `http://${lanIp}:${port}`;
  }

  return process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
}

/**
 * Send ntfy notification with Void branding and Accept/Decline actions
 */
async function sendAlertNotification(
  alert: {
    title: string;
    description: string;
    alertId: string;
    estimatedSavings: number;
    deviceType: string;
    profileId: string;
  },
  baseUrl: string
): Promise<boolean> {
  const message = `${alert.description}\n\nEarn $${alert.estimatedSavings.toFixed(2)} RLUSD`;

  const tags =
    alert.deviceType === "hvac"
      ? ["thermometer"]
      : alert.deviceType === "battery"
      ? ["battery"]
      : ["zap"];

  return sendPushNotification({
    title: alert.title,
    message,
    priority: 4,
    tags,
    clickUrl: `${baseUrl}/dashboard?id=${alert.profileId}`,
    actions: [
      {
        action: "view",
        label: "Accept",
        url: `${baseUrl}/dashboard/respond?alertId=${alert.alertId}&action=ACCEPT&profileId=${alert.profileId}`,
        clear: true,
      },
      {
        action: "view",
        label: "Decline",
        url: `${baseUrl}/dashboard/respond?alertId=${alert.alertId}&action=DECLINE&profileId=${alert.profileId}`,
        clear: true,
      },
    ],
  });
}

/**
 * Generate diverse alerts based on scenario and random weather conditions
 */
function generateAlertsForScenario(scenario: string, profileId: string) {
  const now = new Date();
  const alerts = [];

  // Random weather variations
  const peakTemp = Math.floor(Math.random() * 40) + 70; // 70-110°F
  const minTemp = Math.floor(Math.random() * 30) + 10; // 10-40°F
  const currentTime = new Date().getHours();

  // Winter Storm Uri - multiple device alerts
  if (scenario === "uri" || scenario === "winter") {
    alerts.push({
      profile_id: profileId,
      grid_region: "ERCOT",
      severity: "critical",
      title: "Winter Storm Alert",
      description: `Temperatures dropping to ${minTemp}°F. Pre-heat your home now to save during peak hours.`,
      alert_type: "weather_hvac",
      status: "pending",
      metadata: {
        device_type: "hvac",
        recommended_action: { mode: "HEAT", heatSetpoint: 74 },
        estimated_savings_usd: parseFloat((Math.random() * 0.10 + 0.05).toFixed(2)),
        typical_setpoint: 68,
        recommended_setpoint: 74,
        peak_temp_f: minTemp,
      },
      created_at: now.toISOString(),
    });

    alerts.push({
      profile_id: profileId,
      grid_region: "ERCOT",
      severity: "critical",
      title: "Battery Backup Recommended",
      description: "Grid stress expected. Charge to 100% now for emergency backup power.",
      alert_type: "weather_battery",
      status: "pending",
      metadata: {
        device_type: "battery",
        recommended_action: { action: "CHARGE", target_soc: 100 },
        estimated_savings_usd: parseFloat((Math.random() * 0.10 + 0.05).toFixed(2)),
        weather_reason: "Grid resilience during winter storm",
      },
      created_at: now.toISOString(),
    });

    alerts.push({
      profile_id: profileId,
      grid_region: "ERCOT",
      severity: "warning",
      title: "Optimize EV Charging Time",
      description: "Charge at 3 AM when rates drop to $0.06/kWh during low demand.",
      alert_type: "weather_ev",
      status: "pending",
      metadata: {
        device_type: "ev_charger",
        recommended_action: { action: "DEFER", optimal_start_hour: 3 },
        estimated_savings_usd: parseFloat((Math.random() * 0.10 + 0.05).toFixed(2)),
        weather_reason: "High demand during cold snap",
      },
      created_at: now.toISOString(),
    });
  }
  // Heat wave scenario
  else if (scenario === "heat") {
    const coolTemp = Math.floor(Math.random() * 4) + 68;
    alerts.push({
      profile_id: profileId,
      grid_region: "ERCOT",
      severity: "warning",
      title: `Heat Wave Alert: ${peakTemp}°F Expected`,
      description: `Pre-cool your home to ${coolTemp}°F now to save during peak afternoon heat.`,
      alert_type: "weather_hvac",
      status: "pending",
      metadata: {
        device_type: "hvac",
        recommended_action: { mode: "COOL", coolSetpoint: coolTemp },
        estimated_savings_usd: parseFloat((Math.random() * 0.10 + 0.05).toFixed(2)),
        typical_setpoint: 72,
        recommended_setpoint: coolTemp,
        peak_temp_f: peakTemp,
      },
      created_at: now.toISOString(),
    });

    alerts.push({
      profile_id: profileId,
      grid_region: "ERCOT",
      severity: "optimization",
      title: "Battery Arbitrage Opportunity",
      description: "Charge at night ($0.08/kWh), discharge at peak ($0.42/kWh) for maximum savings.",
      alert_type: "weather_battery",
      status: "pending",
      metadata: {
        device_type: "battery",
        recommended_action: { action: "ARBITRAGE", charge_hour: 2, discharge_hour: 16 },
        estimated_savings_usd: parseFloat((Math.random() * 0.10 + 0.05).toFixed(2)),
        weather_reason: "High afternoon prices during heat wave",
      },
      created_at: now.toISOString(),
    });
  }
  // Normal scenarios - varied alerts
  else {
    const alertTypes = ["hvac", "battery", "ev"];
    const randomType = alertTypes[Math.floor(Math.random() * alertTypes.length)];

    if (randomType === "hvac") {
      const isHeat = currentTime < 6 || currentTime > 20;
      const targetTemp = isHeat ? 70 : 69;
      alerts.push({
        profile_id: profileId,
        grid_region: "ERCOT",
        severity: "optimization",
        title: isHeat ? "Heating Cost Optimization" : "Cooling Cost Optimization",
        description: `Adjust your thermostat to ${targetTemp}°F during off-peak hours for energy savings.`,
        alert_type: "weather_hvac",
        status: "pending",
        metadata: {
          device_type: "hvac",
          recommended_action: {
            mode: isHeat ? "HEAT" : "COOL",
            [isHeat ? "heatSetpoint" : "coolSetpoint"]: targetTemp,
          },
          estimated_savings_usd: parseFloat((Math.random() * 0.10 + 0.05).toFixed(2)),
          typical_setpoint: 72,
          recommended_setpoint: targetTemp,
          peak_temp_f: peakTemp,
        },
        created_at: now.toISOString(),
      });
    } else if (randomType === "battery") {
      alerts.push({
        profile_id: profileId,
        grid_region: "ERCOT",
        severity: "optimization",
        title: "Smart Battery Scheduling",
        description: `Charge during off-peak hours (midnight-6 AM) at lowest rates for maximum savings.`,
        alert_type: "weather_battery",
        status: "pending",
        metadata: {
          device_type: "battery",
          recommended_action: {
            action: "ARBITRAGE",
            charge_hour: Math.floor(Math.random() * 6),
            discharge_hour: Math.floor(Math.random() * 6) + 12,
          },
          estimated_savings_usd: parseFloat((Math.random() * 0.10 + 0.05).toFixed(2)),
          weather_reason: "Price optimization",
        },
        created_at: now.toISOString(),
      });
    } else {
      alerts.push({
        profile_id: profileId,
        grid_region: "ERCOT",
        severity: "optimization",
        title: "EV Charging Optimization",
        description: `Schedule charging at ${Math.floor(Math.random() * 3 + 1)} AM for lowest electricity rates.`,
        alert_type: "weather_ev",
        status: "pending",
        metadata: {
          device_type: "ev_charger",
          recommended_action: {
            action: "DEFER",
            optimal_start_hour: Math.floor(Math.random() * 3 + 1),
          },
          estimated_savings_usd: parseFloat((Math.random() * 0.10 + 0.05).toFixed(2)),
          weather_reason: "Off-peak pricing",
        },
        created_at: now.toISOString(),
      });
    }
  }

  return alerts;
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const scenario = url.searchParams.get("scenario") || "normal";

    // Derive base URL from request headers (machine IP, not localhost)
    const baseUrl = deriveBaseUrl(req);
    console.log(`[orchestrate] Base URL for notifications: ${baseUrl}`);

    // Configure ntfy: set topic and base URL for sendPushNotification
    setNtfyTopic(NTFY_TOPIC);
    setBaseUrl(baseUrl);

    console.log(`[orchestrate] Running simulation for scenario: ${scenario}`);

    // Get all consumer profiles
    let { data: profiles, error: profileError } = await supabase
      .from("consumer_profiles")
      .select("id, name, ntfy_topic");

    if (profileError) {
      console.error("[orchestrate] Failed to fetch profiles:", profileError);
      return NextResponse.json(
        { ok: false, error: "Failed to fetch consumer profiles" },
        { status: 500 }
      );
    }

    // If no profiles exist, create a default one
    if (!profiles || profiles.length === 0) {
      console.log("[orchestrate] No profiles found, creating default profile");

      const defaultProfile = {
        id: "e2bfe115-5417-4d25-bac6-d5e299d8c6f5",
        name: "Test Consumer",
        grid_region: "ERCOT",
        ntfy_topic: "void",
        hvac_type: "central_ac",
        savings_pending_usd: 0,
        savings_paid_usd: 0,
        xrpl_wallet_address: "rTestWalletAddress123456789",
      };

      const { data: newProfile, error: createError } = await supabase
        .from("consumer_profiles")
        .upsert(defaultProfile)
        .select("id, name, ntfy_topic");

      if (createError) {
        console.error("[orchestrate] Failed to create default profile:", createError);
        return NextResponse.json(
          { ok: false, error: "Failed to create consumer profile" },
          { status: 500 }
        );
      }

      profiles = newProfile || [];
      console.log("[orchestrate] Created default profile");
    }

    console.log(`[orchestrate] Generating alerts for ${profiles.length} consumers`);

    let alertsCreated = 0;
    let notificationsSent = 0;

    // Generate alerts for each consumer
    for (const profile of profiles) {
      const alerts = generateAlertsForScenario(scenario, profile.id);

      // Insert alerts into Supabase
      const { data: insertedAlerts, error: insertError } = await supabase
        .from("live_alerts")
        .insert(alerts)
        .select();

      if (insertError) {
        console.error(`[orchestrate] Failed to insert alerts for ${profile.name}:`, insertError);
        continue;
      }

      alertsCreated += insertedAlerts?.length || 0;

      // Send ntfy notification for each alert (with Void logo + machine IP)
      for (const insertedAlert of insertedAlerts || []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const metadata = insertedAlert.metadata as any;
        const sent = await sendAlertNotification(
          {
            title: insertedAlert.title,
            description: insertedAlert.description,
            alertId: insertedAlert.id,
            estimatedSavings: metadata.estimated_savings_usd || 0,
            deviceType: metadata.device_type || "hvac",
            profileId: profile.id,
          },
          baseUrl
        );

        if (sent) notificationsSent++;
      }
    }

    console.log(`[orchestrate] Created ${alertsCreated} alerts, sent ${notificationsSent} notifications`);
    console.log(`[orchestrate] Notification URLs point to: ${baseUrl}/dashboard/respond`);

    return NextResponse.json({
      ok: true,
      alertsCreated,
      notificationsSent,
      scenario,
      profileCount: profiles.length,
      baseUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[orchestrate] Error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
