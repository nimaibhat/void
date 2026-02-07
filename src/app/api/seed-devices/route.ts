/**
 * POST /api/seed-devices
 *
 * Upserts 3 citizen profiles into consumer_profiles with branded smart_devices.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const CITIZEN_PROFILES = [
  {
    name: "Martinez Family",
    city: "Austin",
    state: "TX",
    zip_code: "78701",
    grid_region: "ERCOT",
    home_type: "Single Family",
    square_footage: 2400,
    status: "PROTECTED",
    readiness_score: 94,
    next_risk_window: "Tue 2/10 — Wed 2/11",
    estimated_savings_dollars: 14.2,
    enode_user_id: null,
    smart_devices: [
      {
        type: "thermostat",
        name: "Carrier Infinity HVAC",
        brand: "Carrier",
        model: "Infinity System",
        status: "active",
      },
      {
        type: "battery",
        name: "Tesla Powerwall",
        brand: "Tesla",
        model: "Powerwall",
        status: "active",
        level_pct: 78,
        capacity_kw: 13.5,
      },
      {
        type: "solar_inverter",
        name: "SolarEdge HD-Wave Inverter",
        brand: "SolarEdge",
        model: "HD-Wave",
        status: "active",
        capacity_kw: 5.2,
      },
    ],
    smart_actions: [
      { action: "pre-cool", device: "HVAC", hour: 14 },
      { action: "charge-battery", device: "Powerwall", hour: 2 },
      { action: "shift-solar", device: "Inverter", hour: 10 },
    ],
    active_threats: [
      { event: "Ice Storm", area: "Austin Metro", severity: 3 },
      { event: "Extreme Heat", area: "TX South", severity: 4 },
    ],
  },
  {
    name: "Priya Sharma",
    city: "Austin",
    state: "TX",
    zip_code: "78704",
    grid_region: "ERCOT",
    home_type: "Apartment",
    square_footage: 850,
    status: "MONITORING",
    readiness_score: 72,
    next_risk_window: "Wed 2/11 — Thu 2/12",
    estimated_savings_dollars: 6.8,
    enode_user_id: null,
    smart_devices: [
      {
        type: "thermostat",
        name: "Ecobee SmartThermostat",
        brand: "Ecobee",
        model: "SmartThermostat Premium",
        status: "active",
      },
      {
        type: "solar_inverter",
        name: "Enphase IQ8+ Microinverter",
        brand: "Enphase",
        model: "IQ8+",
        status: "active",
        capacity_kw: 3.8,
      },
    ],
    smart_actions: [
      { action: "pre-cool", device: "Thermostat", hour: 15 },
    ],
    active_threats: [
      { event: "Extreme Heat", area: "TX South", severity: 4 },
    ],
  },
  {
    name: "James & Linda Chen",
    city: "Austin",
    state: "TX",
    zip_code: "78703",
    grid_region: "ERCOT",
    home_type: "Single Family",
    square_footage: 3800,
    status: "PROTECTED",
    readiness_score: 97,
    next_risk_window: "Tue 2/10 — Thu 2/12",
    estimated_savings_dollars: 28.5,
    enode_user_id: null,
    smart_devices: [
      {
        type: "thermostat",
        name: "Nest Learning Thermostat",
        brand: "Google Nest",
        model: "Learning Thermostat 4th Gen",
        status: "active",
      },
      {
        type: "battery",
        name: "Tesla Powerwall+",
        brand: "Tesla",
        model: "Powerwall+",
        status: "active",
        level_pct: 92,
        capacity_kw: 13.5,
      },
      {
        type: "solar_inverter",
        name: "SMA Sunny Boy Inverter",
        brand: "SMA",
        model: "Sunny Boy 7.6",
        status: "active",
        capacity_kw: 7.6,
      },
      {
        type: "ev_charger",
        name: "ChargePoint Home Flex",
        brand: "ChargePoint",
        model: "Home Flex",
        status: "active",
        level: "Level 2",
      },
      {
        type: "pool_pump",
        name: "Hayward VS Pool Pump",
        brand: "Hayward",
        model: "VS Series",
        status: "active",
        capacity_kw: 1.5,
      },
      {
        type: "smart_water_heater",
        name: "Rheem ProTerra Smart Water Heater",
        brand: "Rheem",
        model: "ProTerra",
        status: "active",
        capacity_kw: 4.5,
      },
    ],
    smart_actions: [
      { action: "pre-cool", device: "HVAC", hour: 14 },
      { action: "charge-battery", device: "Powerwall+", hour: 2 },
      { action: "shift-ev", device: "EV Charger", hour: 1 },
      { action: "defer-pump", device: "Pool Pump", hour: 22 },
      { action: "shift-heater", device: "Water Heater", hour: 3 },
    ],
    active_threats: [
      { event: "Ice Storm", area: "Austin Metro", severity: 3 },
      { event: "Extreme Heat", area: "TX South", severity: 4 },
      { event: "Grid Congestion", area: "ERCOT Central", severity: 2 },
    ],
  },
];

export async function POST() {
  try {
    const results = [];

    for (const profile of CITIZEN_PROFILES) {
      const { data, error } = await supabase
        .from("consumer_profiles")
        .upsert(profile, { onConflict: "name" })
        .select("id, name")
        .single();

      if (error) {
        results.push({ name: profile.name, error: error.message });
      } else {
        results.push({
          name: profile.name,
          id: data.id,
          devices: profile.smart_devices.length,
        });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
