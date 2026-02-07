/**
 * Grid Simulation Engine
 *
 * Simple scenario → impact rules. The optimizer is a placeholder
 * that will be replaced with a real ML model later.
 *
 * For now: choose a disaster scenario → each household gets a
 * recommendation with a target temperature and credits.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export interface Household {
  id: string;
  name: string;
  enodeUserId: string | null;
  enodeHvacId: string | null;
  isReal: boolean;
  hvac: {
    currentTemp: number;   // °C
    setpoint: number;      // °C
    mode: "HEAT" | "COOL" | "OFF";
  };
  credits: number;
  totalParticipations: number;
}

export type EventType =
  | "DEMAND_REDUCTION"
  | "PRICE_SPIKE"
  | "HEAT_WAVE"
  | "COLD_SNAP"
  | "RENEWABLE_SURPLUS";

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface GridEvent {
  id: string;
  type: EventType;
  title: string;
  description: string;
  severity: Severity;
  icon: string;
  timestamp: string;
  active: boolean;
  /** What the user's notification says */
  notificationTitle: string;
  notificationBody: string;
}

export interface Recommendation {
  id: string;
  eventId: string;
  householdId: string;
  currentSetpoint: number;
  recommendedSetpoint: number;
  estimatedCredits: number;
  reason: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED";
  respondedAt: string | null;
}

export interface SimulationState {
  households: Household[];
  events: GridEvent[];
  recommendations: Recommendation[];
  gridLoad: number;
  electricityPrice: number;
}

/* ------------------------------------------------------------------ */
/*  Default households (just Martinez — the one real HVAC user)        */
/* ------------------------------------------------------------------ */
const DEFAULT_HOUSEHOLDS: Household[] = [
  {
    id: "hh-martinez",
    name: "Martinez",
    enodeUserId: null,
    enodeHvacId: null,
    isReal: false,
    hvac: { currentTemp: 22, setpoint: 22, mode: "HEAT" },
    credits: 0,
    totalParticipations: 0,
  },
];

/* ------------------------------------------------------------------ */
/*  Event templates — each scenario has a user-facing notification     */
/* ------------------------------------------------------------------ */
const EVENT_TEMPLATES: Record<
  EventType,
  {
    title: string;
    description: string;
    severity: Severity;
    icon: string;
    notificationTitle: string;
    notificationBody: string;
    gridLoad: number;
    price: number;
    /** Simple rule: how many °C to adjust (negative = reduce setpoint) */
    delta: number;
    creditsPerDegree: number;
  }
> = {
  DEMAND_REDUCTION: {
    title: "Grid Load Critical — 95%",
    description: "Grid is near capacity. Reducing demand prevents rolling blackouts.",
    severity: "HIGH",
    icon: "⚡",
    notificationTitle: "⚡ Grid Stress Alert",
    notificationBody:
      "Grid load has hit 95%. We recommend lowering your thermostat by {delta}°C to help prevent a blackout in your area. You'll earn {credits} resilience credits.",
    gridLoad: 95,
    price: 0.32,
    delta: -3,
    creditsPerDegree: 5,
  },
  PRICE_SPIKE: {
    title: "Electricity Price Spike — $0.45/kWh",
    description: "Real-time prices surged to 3× normal.",
    severity: "MEDIUM",
    icon: "💰",
    notificationTitle: "💰 Price Spike Alert",
    notificationBody:
      "Electricity just hit $0.45/kWh — 3× the normal rate. Adjusting your thermostat by {delta}°C saves you ~${savings}/hr and earns {credits} credits.",
    gridLoad: 78,
    price: 0.45,
    delta: -2,
    creditsPerDegree: 8,
  },
  HEAT_WAVE: {
    title: "Heat Wave — 105°F Expected",
    description: "Extreme heat at 2pm. Raise setpoint during peak to reduce grid strain.",
    severity: "CRITICAL",
    icon: "🔥",
    notificationTitle: "🔥 Heat Wave Warning",
    notificationBody:
      "Temperatures will hit 105°F at 2pm. Raising your setpoint by {delta}°C during peak hours helps prevent a neighbourhood outage. Earn {credits} credits.",
    gridLoad: 92,
    price: 0.38,
    delta: 3,
    creditsPerDegree: 6,
  },
  COLD_SNAP: {
    title: "Cold Snap — Heating Demand Surge",
    description: "Extreme cold is overloading the grid with heating demand.",
    severity: "HIGH",
    icon: "❄️",
    notificationTitle: "❄️ Cold Snap Alert",
    notificationBody:
      "Extreme cold is stressing the grid. Lowering your heat by {delta}°C helps prevent outages. You'll earn {credits} credits.",
    gridLoad: 89,
    price: 0.29,
    delta: -2,
    creditsPerDegree: 7,
  },
  RENEWABLE_SURPLUS: {
    title: "Renewable Surplus — Free Energy",
    description: "Solar + wind exceeding demand. Energy is nearly free right now!",
    severity: "LOW",
    icon: "🌱",
    notificationTitle: "🌱 Green Energy Bonus",
    notificationBody:
      "Solar and wind are producing excess energy! Raise your heat by {delta}°C — it's practically free. Earn {credits} credits for using clean energy.",
    gridLoad: 45,
    price: 0.04,
    delta: 2,
    creditsPerDegree: 3,
  },
};

/* ------------------------------------------------------------------ */
/*  State — persisted on globalThis to survive Next.js hot reloads     */
/* ------------------------------------------------------------------ */
const GLOBAL_KEY = "__blackout_sim_state__" as const;
const GLOBAL_ID_KEY = "__blackout_sim_id__" as const;

function getDefaultState(): SimulationState {
  return {
    households: structuredClone(DEFAULT_HOUSEHOLDS),
    events: [],
    recommendations: [],
    gridLoad: 62,
    electricityPrice: 0.14,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (!g[GLOBAL_KEY]) {
  g[GLOBAL_KEY] = getDefaultState();
}
if (g[GLOBAL_ID_KEY] === undefined) {
  g[GLOBAL_ID_KEY] = 0;
}

function getState(): SimulationState {
  return g[GLOBAL_KEY];
}
function setState(s: SimulationState) {
  g[GLOBAL_KEY] = s;
}

function nextId(prefix: string) {
  g[GLOBAL_ID_KEY] = (g[GLOBAL_ID_KEY] ?? 0) + 1;
  return `${prefix}-${g[GLOBAL_ID_KEY]}-${Date.now().toString(36)}`;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function getSimState(): SimulationState {
  return getState();
}

export function resetSimulation(): SimulationState {
  const fresh = getDefaultState();
  setState(fresh);
  g[GLOBAL_ID_KEY] = 0;
  return fresh;
}

export function linkRealDevice(
  householdId: string,
  enodeUserId: string,
  enodeHvacId: string
) {
  const s = getState();
  const hh = s.households.find((h) => h.id === householdId);
  if (!hh) throw new Error(`Household ${householdId} not found`);
  hh.enodeUserId = enodeUserId;
  hh.enodeHvacId = enodeHvacId;
  hh.isReal = true;
  return hh;
}

/**
 * Trigger a scenario.
 * Returns the event + Martinez's recommendation.
 */
export function triggerGridEvent(eventType: EventType): {
  event: GridEvent;
  recommendations: Recommendation[];
} {
  const s = getState();
  const tpl = EVENT_TEMPLATES[eventType];
  if (!tpl) throw new Error(`Unknown event type: ${eventType}`);

  // Deactivate old
  s.events.forEach((e) => (e.active = false));

  // Update grid
  s.gridLoad = tpl.gridLoad;
  s.electricityPrice = tpl.price;

  // Expire old pending recs
  s.recommendations
    .filter((r) => r.status === "PENDING")
    .forEach((r) => (r.status = "EXPIRED"));

  // Build recommendations for each household
  const newRecs: Recommendation[] = [];
  for (const hh of s.households) {
    const current = hh.hvac.setpoint;
    const recommended = Math.max(15, Math.min(25, current + tpl.delta));
    const diff = Math.abs(recommended - current);
    const credits = diff * tpl.creditsPerDegree;

    // Fill in notification template
    const body = tpl.notificationBody
      .replace("{delta}", `${diff}`)
      .replace("{credits}", `${credits}`)
      .replace("{savings}", `${(diff * 0.12).toFixed(2)}`);

    const rec: Recommendation = {
      id: nextId("rec"),
      eventId: "", // will set below
      householdId: hh.id,
      currentSetpoint: current,
      recommendedSetpoint: recommended,
      estimatedCredits: credits,
      reason: body,
      status: "PENDING",
      respondedAt: null,
    };
    newRecs.push(rec);
  }

  const eventId = nextId("evt");
  const event: GridEvent = {
    id: eventId,
    type: eventType,
    title: tpl.title,
    description: tpl.description,
    severity: tpl.severity,
    icon: tpl.icon,
    timestamp: new Date().toISOString(),
    active: true,
    notificationTitle: tpl.notificationTitle,
    notificationBody: newRecs[0]?.reason ?? tpl.notificationBody,
  };

  // Fix event IDs
  newRecs.forEach((r) => (r.eventId = eventId));

  s.events.push(event);
  s.recommendations.push(...newRecs);

  return { event, recommendations: newRecs };
}

export function acceptRecommendation(recId: string): {
  recommendation: Recommendation;
  household: Household;
  needsEnodeCall: boolean;
} {
  const s = getState();
  const rec = s.recommendations.find((r) => r.id === recId);
  if (!rec) throw new Error(`Recommendation ${recId} not found`);
  if (rec.status !== "PENDING")
    throw new Error(`Recommendation already ${rec.status}`);

  rec.status = "ACCEPTED";
  rec.respondedAt = new Date().toISOString();

  const hh = s.households.find((h) => h.id === rec.householdId);
  if (!hh) throw new Error(`Household ${rec.householdId} not found`);

  hh.hvac.setpoint = rec.recommendedSetpoint;
  hh.credits += rec.estimatedCredits;
  hh.totalParticipations += 1;

  // Simulate temp drift for non-real devices
  if (!hh.isReal) {
    const diff = rec.recommendedSetpoint - hh.hvac.currentTemp;
    hh.hvac.currentTemp += Math.sign(diff) * Math.min(Math.abs(diff), 1);
  }

  return {
    recommendation: rec,
    household: hh,
    needsEnodeCall: hh.isReal && !!hh.enodeHvacId,
  };
}

export function declineRecommendation(recId: string): {
  recommendation: Recommendation;
  household: Household;
} {
  const s = getState();
  const rec = s.recommendations.find((r) => r.id === recId);
  if (!rec) throw new Error(`Recommendation ${recId} not found`);
  if (rec.status !== "PENDING")
    throw new Error(`Recommendation already ${rec.status}`);

  rec.status = "DECLINED";
  rec.respondedAt = new Date().toISOString();

  const hh = s.households.find((h) => h.id === rec.householdId);
  if (!hh) throw new Error(`Household ${rec.householdId} not found`);

  return { recommendation: rec, household: hh };
}

export function getLeaderboard(): Household[] {
  return [...getState().households].sort((a, b) => b.credits - a.credits);
}

export function syncHouseholdFromEnode(
  householdId: string,
  currentTemp: number,
  setpoint: number,
  mode: "HEAT" | "COOL" | "OFF"
) {
  const hh = getState().households.find((h) => h.id === householdId);
  if (!hh) return;
  hh.hvac.currentTemp = currentTemp;
  hh.hvac.setpoint = setpoint;
  hh.hvac.mode = mode;
}
