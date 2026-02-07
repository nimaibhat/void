const BASE = "/api/backend";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

/* ================================================================== */
/*  OVERVIEW                                                           */
/* ================================================================== */
export interface RegionWeather {
  temp_f: number;
  wind_mph: number;
  condition: string;
  is_extreme: boolean;
}

export interface RegionOverview {
  region_id: string;
  name: string;
  status: "normal" | "stressed" | "critical" | "blackout";
  load_mw: number;
  capacity_mw: number;
  utilization_pct: number;
  weather: RegionWeather;
  outage_count: number;
  affected_customers: number;
}

export interface OverviewData {
  national_status: string;
  grid_frequency_hz: number;
  total_load_mw: number;
  total_capacity_mw: number;
  regions: RegionOverview[];
}

export async function fetchOverview(scenario: string): Promise<OverviewData> {
  const res = await get<{ data: OverviewData }>(`/utility/overview?scenario=${scenario}`);
  return res.data;
}

/* ================================================================== */
/*  HOTSPOTS                                                           */
/* ================================================================== */
export interface Hotspot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  status: string;
  load_mw: number;
  capacity_mw: number;
  outage_risk_pct: number;
}

export async function fetchHotspots(scenario: string): Promise<Hotspot[]> {
  const res = await get<{ data: { hotspots: Hotspot[] } }>(`/grid/hotspots?scenario=${scenario}`);
  return res.data.hotspots;
}

/* ================================================================== */
/*  ARCS                                                               */
/* ================================================================== */
export interface Arc {
  source: string;
  target: string;
  source_coords: [number, number];
  target_coords: [number, number];
  flow_mw: number;
  capacity_mw: number;
  utilization_pct: number;
  status: string;
}

export async function fetchArcs(scenario: string): Promise<Arc[]> {
  const res = await get<{ data: { arcs: Arc[] } }>(`/grid/arcs?scenario=${scenario}`);
  return res.data.arcs;
}

/* ================================================================== */
/*  CASCADE PROBABILITY                                                */
/* ================================================================== */
export interface CascadeProbability {
  probabilities: Record<string, number>;
  forecast_hour: number;
  scenario: string;
}

export async function fetchCascadeProbability(
  scenario: string,
  forecastHour = 36
): Promise<CascadeProbability> {
  const res = await get<{ data: CascadeProbability }>(
    `/grid/cascade-probability?scenario=${scenario}&forecast_hour=${forecastHour}`
  );
  return res.data;
}

/* ================================================================== */
/*  CREWS                                                              */
/* ================================================================== */
export interface Crew {
  crew_id: string;
  name: string;
  status: "deployed" | "en_route" | "standby";
  lat: number;
  lon: number;
  city: string;
  specialty: string;
  assigned_region: string;
  eta_minutes: number;
}

export async function fetchCrews(scenario: string): Promise<{ crews: Crew[]; coverage_pct: number }> {
  const res = await get<{ data: { crews: Crew[]; coverage_pct: number } }>(
    `/utility/crews?scenario=${scenario}`
  );
  return res.data;
}

/* ================================================================== */
/*  EVENTS                                                             */
/* ================================================================== */
export interface TimelineEvent {
  event_id: string;
  timestamp_offset_minutes: number;
  title: string;
  description: string;
  severity: string;
  region: string | null;
  affected_nodes: number;
}

export async function fetchEvents(scenario: string): Promise<TimelineEvent[]> {
  const res = await get<{ data: TimelineEvent[] }>(`/utility/events?scenario=${scenario}`);
  return res.data;
}

/* ================================================================== */
/*  PRICES                                                             */
/* ================================================================== */
export interface HourlyPrice {
  hour: number;
  timestamp: string;
  price_mwh: number;
  consumer_price_kwh: number;
  demand_factor: number;
  wind_gen_factor: number;
  grid_utilization_pct: number;
}

export async function fetchPrices(region: string, scenario: string, mode?: string): Promise<HourlyPrice[]> {
  const modeParam = mode ? `&mode=${mode}` : "";
  const res = await get<{ data: { prices: HourlyPrice[] } }>(
    `/forecast/prices/${region}?scenario=${scenario}${modeParam}`
  );
  return res.data.prices;
}
