/**
 * Push notification sender via ntfy.sh
 *
 * ntfy.sh is a free, open-source push notification service.
 * No account needed — just install the ntfy app on iOS/Android,
 * subscribe to a topic, and this sends real push notifications.
 *
 * Supports action buttons so users can Accept/Decline directly
 * from the iOS notification.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
const TOPIC_KEY = "__blackout_ntfy_topic__";
const BASEURL_KEY = "__blackout_ntfy_baseurl__";

/** Get the current ntfy topic (null = notifications disabled) */
export function getNtfyTopic(): string | null {
  return g[TOPIC_KEY] ?? null;
}

/** Set the ntfy topic. Pass null to disable. */
export function setNtfyTopic(topic: string | null) {
  g[TOPIC_KEY] = topic;
}

/** Get the base URL for action button links (e.g. http://192.168.1.5:3000) */
export function getBaseUrl(): string {
  return g[BASEURL_KEY] ?? "http://localhost:3000";
}

/** Set the base URL (use your machine's local IP so phone can reach it) */
export function setBaseUrl(url: string) {
  g[BASEURL_KEY] = url.replace(/\/+$/, "");
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export interface NtfyAction {
  /** "view" opens a URL, "http" silently sends a request, "broadcast" is Android-only */
  action: "view" | "http" | "broadcast";
  label: string;
  url: string;
  /** Dismiss notification after action is tapped */
  clear?: boolean;
  /** HTTP method for "http" action (default: POST) */
  method?: "GET" | "POST" | "PUT";
  /** HTTP headers for "http" action */
  headers?: Record<string, string>;
  /** HTTP body for "http" action */
  body?: string;
}

export interface NtfyOptions {
  title: string;
  message: string;
  /** Priority: 1=min, 2=low, 3=default, 4=high, 5=urgent */
  priority?: 1 | 2 | 3 | 4 | 5;
  /** Tags/emojis shown in the notification */
  tags?: string[];
  /** URL to open when notification body is tapped */
  clickUrl?: string;
  /** Action buttons shown on the notification */
  actions?: NtfyAction[];
  /** Custom icon URL (small, shown next to text on Android) */
  icon?: string;
  /** Attach image URL (shows as image preview in the notification on iOS + Android) */
  attach?: string;
  /** Whether to skip the image attachment (default: false) */
  noAttach?: boolean;
}

/** Void logo URLs (hosted on GitHub for public access) */
const VOID_LOGO_ICON =
  "https://raw.githubusercontent.com/nimaibhat/blackout/enode-simulation/public/Void_Logo_small.png";
const VOID_LOGO_ATTACH =
  "https://raw.githubusercontent.com/nimaibhat/blackout/enode-simulation/public/Void_Logo_small.png";

/**
 * Send a push notification via ntfy.sh (JSON API for unicode support).
 * Returns true if sent, false if topic not configured.
 */
export async function sendPushNotification(
  opts: NtfyOptions
): Promise<boolean> {
  const topic = getNtfyTopic();
  if (!topic) return false;

  try {
    const payload: Record<string, unknown> = {
      topic,
      title: opts.title,
      message: opts.message,
      priority: opts.priority ?? 3,
      tags: opts.tags ?? [],
      icon: opts.icon ?? VOID_LOGO_ICON,
    };
    // Attach the Void logo as an image preview (visible on iOS + Android)
    if (!opts.noAttach) {
      payload.attach = opts.attach ?? VOID_LOGO_ATTACH;
      payload.filename = "Void_Logo.png";
    }
    if (opts.clickUrl) payload.click = opts.clickUrl;
    if (opts.actions?.length) payload.actions = opts.actions;

    const res = await fetch("https://ntfy.sh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("[ntfy] HTTP", res.status, await res.text());
    }
    return res.ok;
  } catch (err) {
    console.error("[ntfy] Failed to send notification:", err);
    return false;
  }
}
