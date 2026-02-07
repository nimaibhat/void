/**
 * POST /api/alerts/respond
 *
 * Handle consumer accept/decline responses to weather-based alerts.
 * On accept: controls device via Enode API (optional), tracks savings,
 *            triggers XRPL payout at $1 threshold.
 * On decline: updates alert status, sends confirmation notification.
 *
 * Uses sendPushNotification from notify.ts (Void branding, no backend needed).
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  controlCharging,
  controlHvac,
  controlVehicleCharging,
  listAllDevices,
} from "@/lib/enode";
import { sendRLUSDPayout } from "@/lib/xrpl";
import { sendPushNotification, setNtfyTopic } from "@/lib/notify";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Payout threshold: $1 USD (like simulation)
const PAYOUT_THRESHOLD = 1.0;

/**
 * Execute device control action based on alert metadata
 */
async function executeDeviceControl(
  enodeUserId: string,
  deviceType: string,
  recommendedAction: Record<string, unknown>
): Promise<{ success: boolean; error?: string; deviceId?: string }> {
  try {
    const devices = await listAllDevices(enodeUserId);
    const device = devices.find((d) => d.deviceType === deviceType);
    if (!device) {
      return { success: false, error: `No ${deviceType} device found for user` };
    }

    const deviceId = device.id;

    switch (deviceType) {
      case "hvac": {
        await controlHvac(deviceId, recommendedAction as Record<string, unknown>);
        return { success: true, deviceId };
      }
      case "charger": {
        const action = recommendedAction.action as string;
        if (action === "START" || action === "STOP") {
          await controlCharging(deviceId, action);
          return { success: true, deviceId };
        }
        return { success: false, error: "Invalid charger action" };
      }
      case "vehicle": {
        const action = recommendedAction.action as string;
        if (action === "START" || action === "STOP") {
          await controlVehicleCharging(deviceId, action);
          return { success: true, deviceId };
        }
        return { success: false, error: "Invalid vehicle charging action" };
      }
      case "ev_charger": {
        const action = recommendedAction.action as string;
        if (action === "DEFER") {
          await controlCharging(deviceId, "STOP");
          return { success: true, deviceId };
        }
        return { success: false, error: "Invalid EV charger action" };
      }
      case "battery": {
        console.log(`[alerts] Battery action requested for device ${deviceId}:`, recommendedAction);
        return { success: true, deviceId };
      }
      default:
        return { success: false, error: `Unsupported device type: ${deviceType}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Process XRPL payout if threshold reached
 */
async function processPayoutIfReady(
  profileId: string,
  savingsPending: number
): Promise<{ payoutSent: boolean; txHash?: string; totalPaid?: number; error?: string }> {
  if (savingsPending < PAYOUT_THRESHOLD) {
    return { payoutSent: false };
  }

  try {
    // Fetch consumer's XRPL wallet address (check both columns)
    const { data: profile } = await supabase
      .from("consumer_profiles")
      .select("xrpl_wallet_address, xrpl_address, savings_paid_usd")
      .eq("id", profileId)
      .single();

    const walletAddress = profile?.xrpl_address || profile?.xrpl_wallet_address;
    if (!walletAddress) {
      return { payoutSent: false, error: "No XRPL wallet address configured" };
    }

    // Send RLUSD payout
    const payoutResult = await sendRLUSDPayout({
      destination: walletAddress,
      amount: savingsPending.toString(),
    });

    const txHash =
      typeof payoutResult.result.hash === "string"
        ? payoutResult.result.hash
        : "unknown";

    // Update consumer profile: reset pending, increment paid
    const currentPaid = Number(profile?.savings_paid_usd) || 0;
    const newTotalPaid = currentPaid + savingsPending;

    await supabase
      .from("consumer_profiles")
      .update({
        savings_pending_usd: 0,
        savings_paid_usd: newTotalPaid,
      })
      .eq("id", profileId);

    // Send payout notification via ntfy (no backend needed)
    setNtfyTopic("void");
    await sendPushNotification({
      title: "RLUSD Payout Sent!",
      message:
        `$${savingsPending.toFixed(2)} RLUSD sent to your wallet!\n` +
        `TX: ${txHash.slice(0, 16)}...\n` +
        `Total earned: $${newTotalPaid.toFixed(2)} RLUSD`,
      priority: 4,
      tags: ["moneybag", "rocket"],
      noAttach: true,
    });

    return { payoutSent: true, txHash, totalPaid: newTotalPaid };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { payoutSent: false, error: message };
  }
}

export async function POST(req: NextRequest) {
  try {
    const { alertId, response } = await req.json();

    if (!alertId || !response) {
      return NextResponse.json(
        { ok: false, error: "alertId and response are required" },
        { status: 400 }
      );
    }

    if (response !== "ACCEPT" && response !== "DECLINE") {
      return NextResponse.json(
        { ok: false, error: 'response must be "ACCEPT" or "DECLINE"' },
        { status: 400 }
      );
    }

    // Fetch alert from Supabase
    const { data: alert, error: alertError } = await supabase
      .from("live_alerts")
      .select("*")
      .eq("id", alertId)
      .single();

    if (alertError || !alert) {
      return NextResponse.json(
        { ok: false, error: "Alert not found" },
        { status: 404 }
      );
    }

    const profileId = alert.profile_id;
    if (!profileId) {
      return NextResponse.json(
        { ok: false, error: "Alert is not linked to a profile" },
        { status: 400 }
      );
    }

    // Ensure ntfy topic is set for any notifications
    setNtfyTopic("void");

    // Handle DECLINE
    if (response === "DECLINE") {
      await supabase
        .from("live_alerts")
        .update({ status: "declined", updated_at: new Date().toISOString() })
        .eq("id", alertId);

      // Send decline confirmation via ntfy
      sendPushNotification({
        title: "Alert Declined",
        message: `No changes made. "${alert.title}" was dismissed.`,
        priority: 2,
        tags: ["x"],
      });

      return NextResponse.json({
        ok: true,
        alertId,
        response: "DECLINE",
        message: "Alert declined successfully",
      });
    }

    // Handle ACCEPT
    const metadata = alert.metadata || {};
    const recommendedAction = metadata.recommended_action;
    const estimatedSavings = Number(metadata.estimated_savings_usd) || 0;
    const deviceType = metadata.device_type;

    if (!recommendedAction || !deviceType) {
      return NextResponse.json(
        { ok: false, error: "Alert missing device action metadata" },
        { status: 400 }
      );
    }

    // Fetch consumer profile
    const { data: profile, error: profileError } = await supabase
      .from("consumer_profiles")
      .select("enode_user_id, savings_pending_usd")
      .eq("id", profileId)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { ok: false, error: "Consumer profile not found" },
        { status: 404 }
      );
    }

    const enodeUserId = profile.enode_user_id;
    let deviceControlSuccess = false;
    let deviceId: string | undefined;

    // Try device control if Enode is linked (optional — works without it)
    if (enodeUserId) {
      const controlResult = await executeDeviceControl(enodeUserId, deviceType, recommendedAction);
      if (controlResult.success) {
        deviceControlSuccess = true;
        deviceId = controlResult.deviceId;
        console.log(`[alerts] Device control success: ${deviceType} ${deviceId}`);
      } else {
        console.warn(`[alerts] Device control failed (continuing anyway): ${controlResult.error}`);
      }
    } else {
      console.log(`[alerts] No Enode linked - skipping device control (demo mode)`);
    }

    // Update alert as executed
    await supabase
      .from("live_alerts")
      .update({ status: "accepted_executed", updated_at: new Date().toISOString() })
      .eq("id", alertId);

    // Add savings to pending
    const currentPending = Number(profile.savings_pending_usd) || 0;
    const newPending = currentPending + estimatedSavings;

    await supabase
      .from("consumer_profiles")
      .update({ savings_pending_usd: newPending })
      .eq("id", profileId);

    // Send accept confirmation via ntfy
    const pendingMsg = newPending >= PAYOUT_THRESHOLD
      ? `\nPayout threshold reached! Sending RLUSD...`
      : `\n$${(PAYOUT_THRESHOLD - newPending).toFixed(2)} more until RLUSD payout`;

    sendPushNotification({
      title: "Action Accepted",
      message:
        `"${alert.title}" executed successfully.\n` +
        `Earned: +$${estimatedSavings.toFixed(2)} RLUSD (pending: $${newPending.toFixed(2)})` +
        pendingMsg,
      priority: 3,
      tags: ["white_check_mark"],
    });

    // Check if payout threshold reached
    const payoutResult = await processPayoutIfReady(profileId, newPending);

    return NextResponse.json({
      ok: true,
      alertId,
      response: "ACCEPT",
      deviceControlSuccess,
      deviceId,
      savingsAdded: estimatedSavings,
      savingsPending: payoutResult.payoutSent ? 0 : newPending,
      payoutSent: payoutResult.payoutSent,
      payoutTxHash: payoutResult.txHash,
      payoutError: payoutResult.error,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[alerts/respond] Error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
