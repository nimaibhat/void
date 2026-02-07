/**
 * POST /api/enode/devices/[id]/actions
 *
 * Send a command to a specific device.
 *
 * Body:
 *   { deviceType: "charger" | "hvac" | "vehicle", action: ... }
 *
 * For chargers/vehicles:
 *   { deviceType: "charger", action: "START" | "STOP" }
 *
 * For HVAC:
 *   { deviceType: "hvac", action: { mode?: string, heatSetpoint?: number, coolSetpoint?: number } }
 *   { deviceType: "hvac", action: "FOLLOW_SCHEDULE" }
 */
import { NextRequest, NextResponse } from "next/server";
import {
  controlCharging,
  controlHvac,
  hvacFollowSchedule,
  controlVehicleCharging,
} from "@/lib/enode";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: deviceId } = await params;
    const { deviceType, action } = await req.json();

    if (!deviceType || action === undefined) {
      return NextResponse.json(
        { ok: false, error: "deviceType and action are required" },
        { status: 400 }
      );
    }

    let result;

    switch (deviceType) {
      case "charger":
        result = await controlCharging(deviceId, action);
        break;
      case "hvac":
        if (action === "FOLLOW_SCHEDULE") {
          result = await hvacFollowSchedule(deviceId);
        } else {
          result = await controlHvac(deviceId, action);
        }
        break;
      case "vehicle":
        result = await controlVehicleCharging(deviceId, action);
        break;
      default:
        return NextResponse.json(
          {
            ok: false,
            error: `Unsupported deviceType: ${deviceType}. Use charger, hvac, or vehicle.`,
          },
          { status: 400 }
        );
    }

    return NextResponse.json({ ok: true, action: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
