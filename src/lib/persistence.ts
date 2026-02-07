/**
 * Persistence Layer for Blackout Simulation
 *
 * Loads and saves simulation state to Supabase for cross-session persistence.
 */

import { createClient } from "@supabase/supabase-js";
import type {
  Household,
  SavingSession,
  PayoutRecord,
  GridEvent,
  Recommendation,
  SimulationState,
} from "./simulation";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

/* ------------------------------------------------------------------ */
/*  Load data from Supabase                                           */
/* ------------------------------------------------------------------ */

/**
 * Load all households from Supabase
 */
export async function loadHouseholds(): Promise<Household[]> {
  const { data, error } = await supabase
    .from("households")
    .select("*")
    .order("id");

  if (error) {
    console.error("Failed to load households:", error);
    return [];
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Map Supabase rows to Household objects
  const households: Household[] = await Promise.all(
    data.map(async (row) => {
      // Load related data
      const sessions = await loadSavingSessions(row.id);
      const payouts = await loadPayoutRecords(row.id);

      return {
        id: row.id,
        name: row.name,
        enodeUserId: row.enode_user_id,
        enodeHvacId: row.enode_hvac_id,
        isReal: row.is_real,
        hvac: {
          currentTemp: Number(row.hvac_current_temp) || 22,
          setpoint: Number(row.hvac_setpoint) || 22,
          mode: row.hvac_mode || "HEAT",
        },
        devices: row.devices || [],
        credits: row.credits || 0,
        totalParticipations: row.total_participations || 0,
        xrplWallet: row.xrpl_address
          ? {
              address: row.xrpl_address,
              seed: row.xrpl_seed,
              trustLineCreated: row.xrpl_trustline_created || false,
            }
          : null,
        savingsUSD_pending: Number(row.savings_usd_pending) || 0,
        savingsUSD_paid: Number(row.savings_usd_paid) || 0,
        savingSessions: sessions,
        payouts: payouts,
      };
    })
  );

  return households;
}

/**
 * Load saving sessions for a household
 */
async function loadSavingSessions(householdId: string): Promise<SavingSession[]> {
  const { data, error } = await supabase
    .from("saving_sessions")
    .select("*")
    .eq("household_id", householdId)
    .order("start_time", { ascending: false });

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    startTime: row.start_time,
    durationHours: Number(row.duration_hours),
    rateUSDPerHour: Number(row.rate_usd_per_hour),
    degreeDelta: Number(row.degree_delta),
    savingsUSD: Number(row.savings_usd),
  }));
}

/**
 * Load payout records for a household
 */
async function loadPayoutRecords(householdId: string): Promise<PayoutRecord[]> {
  const { data, error } = await supabase
    .from("payout_records")
    .select("*")
    .eq("household_id", householdId)
    .order("timestamp", { ascending: false });

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    amount: row.amount,
    txHash: row.tx_hash,
    timestamp: row.timestamp,
    triggerSavings: Number(row.trigger_savings),
  }));
}

/**
 * Load all grid events from Supabase
 */
export async function loadGridEvents(): Promise<GridEvent[]> {
  const { data, error } = await supabase
    .from("grid_events")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(50); // Only load recent events

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    severity: row.severity,
    icon: row.icon,
    timestamp: row.timestamp,
    active: row.active,
    notificationTitle: row.notification_title,
    notificationBody: row.notification_body,
  }));
}

/**
 * Load all recommendations from Supabase
 */
export async function loadRecommendations(): Promise<Recommendation[]> {
  const { data, error } = await supabase
    .from("recommendations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100); // Only load recent recommendations

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    eventType: row.event_type,
    householdId: row.household_id,
    currentSetpoint: Number(row.current_setpoint),
    recommendedSetpoint: Number(row.recommended_setpoint),
    estimatedCredits: row.estimated_credits,
    estimatedSavingsUSD: Number(row.estimated_savings_usd),
    reason: row.reason,
    status: row.status,
    respondedAt: row.responded_at,
  }));
}

/**
 * Load grid state (load and price)
 */
export async function loadGridState(): Promise<{ gridLoad: number; electricityPrice: number }> {
  const { data, error } = await supabase
    .from("grid_state")
    .select("*")
    .eq("id", 1)
    .single();

  if (error || !data) {
    return { gridLoad: 62, electricityPrice: 0.14 };
  }

  return {
    gridLoad: Number(data.grid_load) || 62,
    electricityPrice: Number(data.electricity_price) || 0.14,
  };
}

/**
 * Load complete simulation state from Supabase
 */
export async function loadSimulationState(): Promise<SimulationState | null> {
  try {
    const [households, events, recommendations, gridState] = await Promise.all([
      loadHouseholds(),
      loadGridEvents(),
      loadRecommendations(),
      loadGridState(),
    ]);

    return {
      households,
      events,
      recommendations,
      gridLoad: gridState.gridLoad,
      electricityPrice: gridState.electricityPrice,
    };
  } catch (err) {
    console.error("Failed to load simulation state:", err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Save data to Supabase                                             */
/* ------------------------------------------------------------------ */

/**
 * Save a household to Supabase
 */
export async function saveHousehold(household: Household): Promise<void> {
  const { error } = await supabase
    .from("households")
    .upsert(
      {
        id: household.id,
        name: household.name,
        enode_user_id: household.enodeUserId,
        enode_hvac_id: household.enodeHvacId,
        is_real: household.isReal,
        hvac_current_temp: household.hvac.currentTemp,
        hvac_setpoint: household.hvac.setpoint,
        hvac_mode: household.hvac.mode,
        devices: household.devices,
        credits: household.credits,
        total_participations: household.totalParticipations,
        xrpl_address: household.xrplWallet?.address || null,
        xrpl_seed: household.xrplWallet?.seed || null,
        xrpl_trustline_created: household.xrplWallet?.trustLineCreated || false,
        savings_usd_pending: household.savingsUSD_pending,
        savings_usd_paid: household.savingsUSD_paid,
      },
      { onConflict: "id" }
    );

  if (error) {
    console.error("Failed to save household:", error);
    throw error;
  }
}

/**
 * Save a saving session to Supabase
 */
export async function saveSavingSession(
  householdId: string,
  session: SavingSession
): Promise<void> {
  const { error } = await supabase.from("saving_sessions").upsert(
    {
      id: session.id,
      household_id: householdId,
      event_type: session.eventType,
      start_time: session.startTime,
      duration_hours: session.durationHours,
      rate_usd_per_hour: session.rateUSDPerHour,
      degree_delta: session.degreeDelta,
      savings_usd: session.savingsUSD,
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("Failed to save saving session:", error);
  }
}

/**
 * Save a payout record to Supabase
 */
export async function savePayoutRecord(
  householdId: string,
  record: PayoutRecord
): Promise<void> {
  const { error } = await supabase.from("payout_records").upsert(
    {
      id: record.id,
      household_id: householdId,
      amount: record.amount,
      tx_hash: record.txHash,
      timestamp: record.timestamp,
      trigger_savings: record.triggerSavings,
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("Failed to save payout record:", error);
  }
}

/**
 * Save a grid event to Supabase
 */
export async function saveGridEvent(event: GridEvent): Promise<void> {
  const { error } = await supabase.from("grid_events").upsert(
    {
      id: event.id,
      type: event.type,
      title: event.title,
      description: event.description,
      severity: event.severity,
      icon: event.icon,
      timestamp: event.timestamp,
      active: event.active,
      notification_title: event.notificationTitle,
      notification_body: event.notificationBody,
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("Failed to save grid event:", error);
  }
}

/**
 * Save a recommendation to Supabase
 */
export async function saveRecommendation(rec: Recommendation): Promise<void> {
  const { error } = await supabase.from("recommendations").upsert(
    {
      id: rec.id,
      event_id: rec.eventId,
      event_type: rec.eventType,
      household_id: rec.householdId,
      current_setpoint: rec.currentSetpoint,
      recommended_setpoint: rec.recommendedSetpoint,
      estimated_credits: rec.estimatedCredits,
      estimated_savings_usd: rec.estimatedSavingsUSD,
      reason: rec.reason,
      status: rec.status,
      responded_at: rec.respondedAt,
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("Failed to save recommendation:", error);
  }
}

/**
 * Save grid state (load and price) to Supabase
 */
export async function saveGridState(gridLoad: number, electricityPrice: number): Promise<void> {
  const { error } = await supabase
    .from("grid_state")
    .upsert(
      {
        id: 1,
        grid_load: gridLoad,
        electricity_price: electricityPrice,
      },
      { onConflict: "id" }
    );

  if (error) {
    console.error("Failed to save grid state:", error);
  }
}

/**
 * Batch save all simulation state to Supabase
 */
export async function saveSimulationState(state: SimulationState): Promise<void> {
  try {
    // Save households
    await Promise.all(state.households.map(saveHousehold));

    // Save grid events (only active ones to avoid duplication)
    const activeEvents = state.events.filter((e) => e.active);
    await Promise.all(activeEvents.map(saveGridEvent));

    // Save recommendations (only recent pending/accepted ones)
    const recentRecs = state.recommendations.filter(
      (r) => r.status === "PENDING" || r.status === "ACCEPTED"
    );
    await Promise.all(recentRecs.map(saveRecommendation));

    // Save grid state
    await saveGridState(state.gridLoad, state.electricityPrice);

    console.log("[persistence] Simulation state saved to Supabase");
  } catch (err) {
    console.error("[persistence] Failed to save simulation state:", err);
  }
}
