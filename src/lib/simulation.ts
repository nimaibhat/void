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
/* ---- XRPL savings tracking ---- */
export interface SavingSession {
  id: string;
  eventType: EventType;
  startTime: number;             // Date.now()
  durationHours: number;         // assumed event window
  rateUSDPerHour: number;        // savings rate for this event
  degreeDelta: number;           // how many °C the user adjusted
  savingsUSD: number;            // rate × duration × delta (computed on creation)
}

export interface XrplWallet {
  address: string;
  seed: string;
  trustLineCreated: boolean;
}

export interface PayoutRecord {
  id: string;
  amount: string;                // USD value sent as RLUSD
  txHash: string;
  timestamp: string;
  triggerSavings: number;        // what savingsPending was before payout
}

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
  /** XRPL wallet linked to this household (null = not yet set up) */
  xrplWallet: XrplWallet | null;
  /** Accumulated savings not yet paid out (USD) */
  savingsUSD_pending: number;
  /** Total savings already paid out on XRPL (USD) */
  savingsUSD_paid: number;
  /** History of saving sessions (one per accepted recommendation) */
  savingSessions: SavingSession[];
  /** History of XRPL payouts */
  payouts: PayoutRecord[];
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
  eventType: EventType;
  householdId: string;
  currentSetpoint: number;
  recommendedSetpoint: number;
  estimatedCredits: number;
  /** Estimated USD savings for this event (time × rate × delta) */
  estimatedSavingsUSD: number;
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
/*  Default households                                                  */
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
    xrplWallet: null,
    savingsUSD_pending: 0,
    savingsUSD_paid: 0,
    savingSessions: [],
    payouts: [],
  },
  {
    id: "hh-chen",
    name: "Chen",
    enodeUserId: null,
    enodeHvacId: null,
    isReal: false,
    hvac: { currentTemp: 21, setpoint: 21, mode: "HEAT" },
    credits: 0,
    totalParticipations: 0,
    xrplWallet: null,
    savingsUSD_pending: 0,
    savingsUSD_paid: 0,
    savingSessions: [],
    payouts: [],
  },
  {
    id: "hh-okafor",
    name: "Okafor",
    enodeUserId: null,
    enodeHvacId: null,
    isReal: false,
    hvac: { currentTemp: 23, setpoint: 23, mode: "HEAT" },
    credits: 0,
    totalParticipations: 0,
    xrplWallet: null,
    savingsUSD_pending: 0,
    savingsUSD_paid: 0,
    savingSessions: [],
    payouts: [],
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
    /** Assumed event window in hours — savings accrue over this time */
    durationHours: number;
    /** USD saved per hour per degree of adjustment */
    savingsRatePerHourPerDegree: number;
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
    durationHours: 2,
    savingsRatePerHourPerDegree: 0.04,
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
    durationHours: 3,
    savingsRatePerHourPerDegree: 0.06,
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
    durationHours: 4,
    savingsRatePerHourPerDegree: 0.05,
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
    durationHours: 3,
    savingsRatePerHourPerDegree: 0.04,
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
    durationHours: 2,
    savingsRatePerHourPerDegree: 0.02,
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
  const COMFORTABLE_BASELINE = 22; // °C — the "normal" setpoint users return to

  for (const hh of s.households) {
    // ── Recovery: drift setpoint back toward the comfortable baseline ──
    // Simulates the household returning to normal between DR events.
    // This prevents the thermostat from getting stuck at 15°C floor.
    const recoveryStep = Math.round(
<<<<<<< HEAD
      (COMFORTABLE_BASELINE - hh.hvac.setpoint) * 0.7
    );
    if (recoveryStep !== 0) {
      hh.hvac.setpoint += recoveryStep;
      hh.hvac.currentTemp += Math.round(recoveryStep * 0.5);
=======
      (COMFORTABLE_BASELINE - hh.hvac.setpoint) * 0.7          // recover 70% of the gap
    );
    if (recoveryStep !== 0) {
      hh.hvac.setpoint += recoveryStep;
      hh.hvac.currentTemp += Math.round(recoveryStep * 0.5);   // temp follows partially
>>>>>>> 44f8655ddc1f10d7dfba2ef22d4f4309146ea770
    }

    const current = hh.hvac.setpoint;
    const recommended = Math.max(15, Math.min(25, current + tpl.delta));
    const diff = Math.abs(recommended - current);
    const credits = diff * tpl.creditsPerDegree;

    // Fill in notification template
    const body = tpl.notificationBody
      .replace("{delta}", `${diff}`)
      .replace("{credits}", `${credits}`)
      .replace("{savings}", `${(diff * 0.12).toFixed(2)}`);

    // Compute estimated USD savings: rate × duration × degrees changed
    const estimatedSavingsUSD = +(
      tpl.savingsRatePerHourPerDegree *
      tpl.durationHours *
      diff
    ).toFixed(4);

    const rec: Recommendation = {
      id: nextId("rec"),
      eventId: "", // will set below
      eventType: eventType,
      householdId: hh.id,
      currentSetpoint: current,
      recommendedSetpoint: recommended,
      estimatedCredits: credits,
      estimatedSavingsUSD,
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

  // ── Create a saving session (time-based savings) ──────────
  const tpl = EVENT_TEMPLATES[rec.eventType];
  if (tpl) {
    const degreeDelta = Math.abs(rec.recommendedSetpoint - rec.currentSetpoint);
    const savingsUSD = +(
      tpl.savingsRatePerHourPerDegree *
      tpl.durationHours *
      degreeDelta
    ).toFixed(4);

    const session: SavingSession = {
      id: rec.id,
      eventType: rec.eventType,
      startTime: Date.now(),
      durationHours: tpl.durationHours,
      rateUSDPerHour: tpl.savingsRatePerHourPerDegree * degreeDelta,
      degreeDelta,
      savingsUSD,
    };
    hh.savingSessions.push(session);
    hh.savingsUSD_pending += savingsUSD;
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

/* ------------------------------------------------------------------ */
/*  XRPL wallet & payout helpers                                       */
/* ------------------------------------------------------------------ */

/** Payout threshold in USD — when pending savings >= this, send RLUSD */
export const PAYOUT_THRESHOLD_USD = 1.0;

/** Link an XRPL wallet to a household. */
export function linkXrplWallet(
  householdId: string,
  address: string,
  seed: string,
  trustLineCreated: boolean = false
): Household {
  const hh = getState().households.find((h) => h.id === householdId);
  if (!hh) throw new Error(`Household ${householdId} not found`);
  hh.xrplWallet = { address, seed, trustLineCreated };
  return hh;
}

/** Mark a household's XRPL trust line as created. */
export function markTrustLineCreated(householdId: string): Household {
  const hh = getState().households.find((h) => h.id === householdId);
  if (!hh) throw new Error(`Household ${householdId} not found`);
  if (!hh.xrplWallet) throw new Error(`No XRPL wallet linked`);
  hh.xrplWallet.trustLineCreated = true;
  return hh;
}

/**
 * Check whether a household is ready for payout and record it.
 * Returns the payout amount if threshold is met, null otherwise.
 * The actual XRPL transaction should be done by the caller.
 */
export function checkAndRecordPayout(
  householdId: string,
  txHash: string
): PayoutRecord | null {
  const hh = getState().households.find((h) => h.id === householdId);
  if (!hh) throw new Error(`Household ${householdId} not found`);
  if (!hh.xrplWallet?.trustLineCreated) return null;
  if (hh.savingsUSD_pending < PAYOUT_THRESHOLD_USD) return null;

<<<<<<< HEAD
=======
  // Pay out the full pending amount (in multiples of threshold or all of it)
>>>>>>> 44f8655ddc1f10d7dfba2ef22d4f4309146ea770
  const payoutAmount = +hh.savingsUSD_pending.toFixed(2);
  const record: PayoutRecord = {
    id: nextId("payout"),
    amount: payoutAmount.toFixed(2),
    txHash,
    timestamp: new Date().toISOString(),
    triggerSavings: payoutAmount,
  };

  hh.savingsUSD_pending = 0;
  hh.savingsUSD_paid += payoutAmount;
  hh.payouts.push(record);

  return record;
}

/** Get a household by ID. */
export function getHousehold(householdId: string): Household | null {
  return getState().households.find((h) => h.id === householdId) ?? null;
}

/** Check if household has enough pending savings for a payout. */
export function isPayoutReady(householdId: string): boolean {
  const hh = getState().households.find((h) => h.id === householdId);
  if (!hh) return false;
  return (
    !!hh.xrplWallet?.trustLineCreated &&
    hh.savingsUSD_pending >= PAYOUT_THRESHOLD_USD
  );
}
