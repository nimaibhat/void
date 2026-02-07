/**
 * GET  /api/simulation/notify        — Get current ntfy config
 * POST /api/simulation/notify        — Set config or send test
 *
 * Body: { topic: string }            — Set the ntfy topic
 * Body: { baseUrl: string }          — Set the base URL for action buttons
 * Body: { test: true }               — Send a test notification with buttons
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getNtfyTopic,
  setNtfyTopic,
  getBaseUrl,
  setBaseUrl,
  sendPushNotification,
} from "@/lib/notify";

export async function GET() {
  return NextResponse.json({
    ok: true,
    topic: getNtfyTopic(),
    baseUrl: getBaseUrl(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Set base URL
    if (body.baseUrl !== undefined) {
      setBaseUrl(body.baseUrl || "http://localhost:3000");
      return NextResponse.json({
        ok: true,
        baseUrl: getBaseUrl(),
        message: `Base URL set to "${getBaseUrl()}".`,
      });
    }

    // Set topic
    if (body.topic !== undefined) {
      const topic = body.topic ? String(body.topic).trim() : null;
      setNtfyTopic(topic);
      return NextResponse.json({
        ok: true,
        topic,
        message: topic
          ? `Topic set to "${topic}". Notifications will be sent to your phone.`
          : "Notifications disabled.",
      });
    }

    // Send test with action buttons
    if (body.test) {
      const topic = getNtfyTopic();
      if (!topic) {
        return NextResponse.json(
          { ok: false, error: "No ntfy topic configured. Set a topic first." },
          { status: 400 }
        );
      }
      const base = getBaseUrl();
      const acceptUrl = `${base}/simulation/respond?id=test&action=ACCEPT`;
      const declineUrl = `${base}/simulation/respond?id=test&action=DECLINE`;
      const sent = await sendPushNotification({
        title: "⚡ Blackout Test Alert",
        message:
          "This is a test notification from Blackout.\n\n" +
          "🌡️ Current: 22°C → Recommended: 19°C\n" +
          "🏆 You'll earn +15 resilience credits",
        priority: 4,
        tags: ["zap", "white_check_mark"],
        clickUrl: acceptUrl,
        actions: [
          {
            action: "view",
            label: "✓ Accept (19°C)",
            url: acceptUrl,
            clear: true,
          },
          {
            action: "view",
            label: "✗ Decline",
            url: declineUrl,
            clear: true,
          },
        ],
      });
      return NextResponse.json({ ok: true, sent });
    }

    return NextResponse.json(
      { ok: false, error: 'Provide "topic", "baseUrl", or "test"' },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
