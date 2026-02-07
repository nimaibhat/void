/**
 * POST /api/enode/devices/[id]/actions
 *
 * Send a command to a specific device.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  controlCharging,
  controlHvac,
  hvacFollowSchedule,
  controlVehicleCharging,
} from "@/lib/enode";

// Type guards for action validation
function isStartStopAction(action: unknown): action is "START" | "STOP" {
  return action === "START" || action === "STOP";
}

function isHvacAction(
  action: unknown
): action is { mode?: string; heatSetpoint?: number; coolSetpoint?: number } {
  return (
    typeof action === "object" &&
    action !== null &&
    ("mode" in action || "heatSetpoint" in action || "coolSetpoint" in action)
  );
}

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
        if (!isStartStopAction(action)) {
          return NextResponse.json(
            {
              ok: false,
              error: 'Invalid action for charger. Expected "START" or "STOP"',
            },
            { status: 400 }
          );
        }
        result = await controlCharging(deviceId, action);
        break;

      case "hvac":
        if (action === "FOLLOW_SCHEDULE") {
          result = await hvacFollowSchedule(deviceId);
        } else if (isHvacAction(action)) {
          result = await controlHvac(deviceId, action);
        } else {
          return NextResponse.json(
            {
              ok: false,
              error:
                'Invalid action for HVAC. Expected "FOLLOW_SCHEDULE" or object with mode/heatSetpoint/coolSetpoint',
            },
            { status: 400 }
          );
        }
        break;

      case "vehicle":
        if (!isStartStopAction(action)) {
          return NextResponse.json(
            {
              ok: false,
              error: 'Invalid action for vehicle. Expected "START" or "STOP"',
            },
            { status: 400 }
          );
        }
        result = await controlVehicleCharging(deviceId, action);
        break;

      default:
        return NextResponse.json(
          { ok: false, error: `Unsupported deviceType: ${deviceType}` },
          { status: 400 }
        );
    }

    return NextResponse.json({ ok: true, action: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
