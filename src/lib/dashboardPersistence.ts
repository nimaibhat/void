/**
 * Dashboard Persistence Helper
 *
 * Persists XRPL rewards and smart device states to Supabase consumer_profiles table
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export interface XRPLWalletData {
  address: string;
  seed: string;
  trustLineCreated: boolean;
  savingsUsdPending: number;
  savingsUsdPaid: number;
}

export interface PayoutRecord {
  id: string;
  profileId: string;
  amount: string;
  txHash: string;
  timestamp: string;
}

/**
 * Get XRPL wallet data for a profile
 */
export async function getProfileXRPLData(profileId: string): Promise<XRPLWalletData | null> {
  const { data, error } = await supabase
    .from("consumer_profiles")
    .select("xrpl_address, xrpl_seed, xrpl_trustline_created, savings_usd_pending, savings_usd_paid")
    .eq("id", profileId)
    .single();

  if (error || !data) {
    return null;
  }

  if (!data.xrpl_address) {
    return null;
  }

  return {
    address: data.xrpl_address,
    seed: data.xrpl_seed,
    trustLineCreated: data.xrpl_trustline_created || false,
    savingsUsdPending: Number(data.savings_usd_pending) || 0,
    savingsUsdPaid: Number(data.savings_usd_paid) || 0,
  };
}

/**
 * Save XRPL wallet data for a profile
 */
export async function saveProfileXRPLWallet(
  profileId: string,
  address: string,
  seed: string
): Promise<void> {
  const { error } = await supabase
    .from("consumer_profiles")
    .update({
      xrpl_address: address,
      xrpl_seed: seed,
      xrpl_trustline_created: false,
    })
    .eq("id", profileId);

  if (error) {
    console.error("Failed to save XRPL wallet:", error);
    throw error;
  }
}

/**
 * Mark trust line as created for a profile
 */
export async function markProfileTrustLineCreated(profileId: string): Promise<void> {
  const { error } = await supabase
    .from("consumer_profiles")
    .update({ xrpl_trustline_created: true })
    .eq("id", profileId);

  if (error) {
    console.error("Failed to mark trust line created:", error);
    throw error;
  }
}

/**
 * Update savings for a profile
 */
export async function updateProfileSavings(
  profileId: string,
  pendingDelta: number = 0,
  paidDelta: number = 0
): Promise<void> {
  // Get current values
  const current = await getProfileXRPLData(profileId);
  if (!current) {
    throw new Error("Profile XRPL data not found");
  }

  const newPending = Math.max(0, current.savingsUsdPending + pendingDelta);
  const newPaid = Math.max(0, current.savingsUsdPaid + paidDelta);

  const { error } = await supabase
    .from("consumer_profiles")
    .update({
      savings_usd_pending: newPending,
      savings_usd_paid: newPaid,
    })
    .eq("id", profileId);

  if (error) {
    console.error("Failed to update savings:", error);
    throw error;
  }
}

/**
 * Record a payout for a profile
 */
export async function recordProfilePayout(
  profileId: string,
  amount: string,
  txHash: string
): Promise<void> {
  // Insert payout record
  const { error: payoutError } = await supabase.from("profile_payouts").insert({
    id: `payout-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    profile_id: profileId,
    amount,
    tx_hash: txHash,
    timestamp: new Date().toISOString(),
  });

  if (payoutError) {
    console.error("Failed to record payout:", payoutError);
    throw payoutError;
  }

  // Update savings (move pending to paid)
  const current = await getProfileXRPLData(profileId);
  if (current) {
    await updateProfileSavings(profileId, -current.savingsUsdPending, current.savingsUsdPending);
  }
}

/**
 * Get payout history for a profile
 */
export async function getProfilePayouts(profileId: string): Promise<PayoutRecord[]> {
  const { data, error } = await supabase
    .from("profile_payouts")
    .select("*")
    .eq("profile_id", profileId)
    .order("timestamp", { ascending: false })
    .limit(20);

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    profileId: row.profile_id,
    amount: row.amount,
    txHash: row.tx_hash,
    timestamp: row.timestamp,
  }));
}
