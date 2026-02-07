const BASE = "/api/backend";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

async function post<T>(path: string, body: any): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
/*  WEATHER EVENTS (LLM-generated)                                     */
/* ================================================================== */
export interface WeatherEvent {
  zone: string;
  name: string;
}

export async function fetchWeatherEvents(scenario: string): Promise<WeatherEvent[]> {
  const res = await get<{ data: WeatherEvent[] }>(`/utility/weather-events?scenario=${scenario}`);
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
/*  GRID NODES                                                         */
/* ================================================================== */
export interface GridNodeData {
  id: string;
  lat: number;
  lon: number;
  base_load_mw: number;
  capacity_mw: number;
  voltage_kv: number;
  weather_zone: string;
  source?: "activsg" | "travis";
}

export interface GridEdgeData {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  source: "activsg" | "travis";
  capacity_mva: number;
}

export async function fetchGridNodes(): Promise<{ nodes: GridNodeData[]; edges: GridEdgeData[] }> {
  const res = await fetch("/api/grid-nodes");
  if (!res.ok) throw new Error(`Grid nodes ${res.status}`);
  const json = await res.json();
  const nodes = Array.isArray(json.data) ? json.data : [];
  const edges = Array.isArray(json.edges) ? json.edges : [];
  return { nodes, edges };
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

/* ================================================================== */
/*  CASCADE SIMULATION                                                 */
/* ================================================================== */
export interface FailedNodeInfo {
  id: string;
  lat: number;
  lon: number;
  load_mw: number;
  capacity_mw: number;
}

export interface CascadeStep {
  step: number;
  new_failures: FailedNodeInfo[];
  total_failed: number;
  total_load_shed_mw: number;
}

export interface FinalNodeState {
  status: "failed" | "stressed" | "nominal";
  current_load_mw: number;
  capacity_mw: number;
  load_pct: number;
}

export interface CascadeResult {
  scenario: string;
  forecast_hour: number;
  started_at: string;
  completed_at: string;
  steps: CascadeStep[];
  total_failed_nodes: number;
  total_nodes: number;
  cascade_depth: number;
  total_load_shed_mw: number;
  failed_node_ids: string[];
  final_node_states: Record<string, FinalNodeState>;
}

export async function runCascadeSimulation(
  scenario: string,
  forecastHour = 36
): Promise<CascadeResult> {
  const res = await post<{ data: CascadeResult }>("/simulate/cascade", {
    scenario,
    forecast_hour: forecastHour,
    start_time: "2021-02-13T00:00:00",
    region: "ERCOT",
  });
  return res.data;
}

/* ================================================================== */
/*  OUTCOMES                                                           */
/* ================================================================== */
export interface ScenarioOutcome {
  scenario_name: string;
  total_affected_customers: number;
  peak_price_mwh: number;
  blackout_duration_hours: number;
  regions_affected: number;
  cascade_steps: number;
  failed_nodes: number;
}

export interface OutcomeComparison {
  without_blackout: ScenarioOutcome;
  with_blackout: ScenarioOutcome;
  customers_saved: number;
  price_reduction_pct: number;
  cascade_reduction_pct: number;
}

export async function fetchOutcomes(scenario: string): Promise<OutcomeComparison> {
  const res = await get<{ data: OutcomeComparison }>(
    `/utility/outcomes?scenario=${scenario}`
  );
  return res.data;
}

/* ================================================================== */
/*  CONSUMER RECOMMENDATIONS                                           */
/* ================================================================== */
export interface OptimizedSchedule {
  appliance: string;
  original_start: number;
  optimized_start: number;
  original_cost: number;
  optimized_cost: number;
  savings: number;
  reason: string;
}

export interface ConsumerAlert {
  severity: string;
  title: string;
  description: string;
  timestamp: string;
  action: string;
}

export interface ConsumerRecommendation {
  optimized_schedule: OptimizedSchedule[];
  total_savings: number;
  readiness_score: number;
  status: string;
  alerts: ConsumerAlert[];
  next_risk_window: string | null;
}

export async function fetchRecommendations(
  profileId: string,
  region = "ERCOT",
  scenario = "live"
): Promise<ConsumerRecommendation> {
  const res = await get<{ data: ConsumerRecommendation }>(
    `/consumer/recommendations/${profileId}?region=${region}&scenario=${scenario}`
  );
  return res.data;
}
