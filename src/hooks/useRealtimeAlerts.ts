"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

export interface LiveAlert {
  id: string;
  session_id: string | null;
  profile_id: string | null;
  grid_region: string;
  severity: string;
  title: string;
  description: string;
  alert_type: string;
  status: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string | null;
}

export function useRealtimeAlerts(
  gridRegion: string = "ERCOT",
  profileId: string | null = null
) {
  const [liveAlerts, setLiveAlerts] = useState<LiveAlert[]>([]);

  useEffect(() => {
    // Fetch existing alerts for this profile on mount
    async function fetchExistingAlerts() {
      if (!profileId) return;

      const { data, error } = await supabase
        .from("live_alerts")
        .select("*")
        .eq("profile_id", profileId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to fetch existing alerts:", error);
        return;
      }

      if (data && data.length > 0) {
        setLiveAlerts(data as LiveAlert[]);
      }
    }

    fetchExistingAlerts();

    // Build filter: if profileId provided, filter by profile_id, otherwise by grid_region
    const filter = profileId
      ? `profile_id=eq.${profileId}`
      : `grid_region=eq.${gridRegion}`;

    const channel = supabase
      .channel("live_alerts_changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "live_alerts",
          filter,
        },
        (payload) => {
          const row = payload.new as LiveAlert;
          setLiveAlerts((prev) => [row, ...prev]);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "live_alerts",
          filter,
        },
        (payload) => {
          const row = payload.new as LiveAlert;
          setLiveAlerts((prev) =>
            prev.map((alert) => (alert.id === row.id ? row : alert))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gridRegion, profileId]);

  const clearAlerts = useCallback(() => {
    setLiveAlerts([]);
  }, []);

  return { liveAlerts, clearAlerts };
}
