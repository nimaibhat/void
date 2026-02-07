/**
 * Mock data generators for grid/market APIs.
 * Mirrors: EIA Open Data (demand), ERCOT, CAISO OASIS, PJM Data Miner.
 */

export type EiaRegion =
  | "CISO"   // California
  | "ERCO"   // ERCOT
  | "PJM"    // PJM
  | "MISO"   // MISO
  | "NYIS"   // NYISO
  | "ISNE"   // ISO-NE
  | "SWPP";  // SPP

export interface EiaHourlyDemandPoint {
  period: string; // ISO8601 hourly e.g. "2025-02-05T14:00:00-00:00"
  value: string; // MWh as string (EIA API returns strings)
  "value-units"?: string;
}

export interface EiaHistoricalDemandResponse {
  response: {
    total: number;
    dateFormat: string;
    frequency: string;
    data: EiaHourlyDemandPoint[];
    "start-period"?: string;
    "end-period"?: string;
  };
  "request": {
    command: string;
    params: Record<string, string>;
  };
}

export interface WholesalePricePoint {
  timestamp: string;
  interval_start?: string;
  interval_end?: string;
  node_id?: string;
  node_name?: string;
  lmp: number;
  energy?: number;
  congestion?: number;
  loss?: number;
}

/** Generate EIA-style hourly demand for a region (mock). */
export function mockEiaHourlyDemand(
  region: EiaRegion,
  hours: number = 168,
  endTime: Date = new Date()
): EiaHistoricalDemandResponse {
  const data: EiaHourlyDemandPoint[] = [];
  const baseMw: Record<EiaRegion, number> = {
    CISO: 28500,
    ERCO: 42000,
    PJM: 95000,
    MISO: 78000,
    NYIS: 21000,
    ISNE: 15000,
    SWPP: 35000,
  };
  const base = baseMw[region] ?? 30000;
  for (let i = hours - 1; i >= 0; i--) {
    const t = new Date(endTime);
    t.setUTCHours(t.getUTCHours() - i, 0, 0, 0);
    const period = t.toISOString().replace(/\.\d{3}Z$/, "-00:00");
    const hour = t.getUTCHours();
    const dayOfWeek = t.getUTCDay();
    const weekend = dayOfWeek === 0 || dayOfWeek === 6;
    const loadFactor = weekend ? 0.85 : 1;
    const dailyShape = 0.6 + 0.4 * Math.sin(((hour - 14) * Math.PI) / 12);
    const noise = 0.95 + Math.random() * 0.1;
    const value = Math.round(base * loadFactor * dailyShape * noise);
    data.push({
      period,
      value: String(value),
      "value-units": "megawatthours",
    });
  }
  const startPeriod = data[0]?.period ?? "";
  const endPeriod = data[data.length - 1]?.period ?? "";
  return {
    response: {
      total: data.length,
      dateFormat: "YYYY-MM-DDTHH:mm:ssZ",
      frequency: "hourly",
      data,
      "start-period": startPeriod,
      "end-period": endPeriod,
    },
    request: {
      command: "series_data",
      params: {
        frequency: "hourly",
        "facets[parent]": region,
        "data[0]": "value",
      },
    },
  };
}

/** Generate ERCOT-style 15-min LMP data (mock). */
export function mockErcotWholesalePrices(
  nodeId: string = "HB_HOUSTON",
  intervals: number = 96,
  endTime: Date = new Date()
): WholesalePricePoint[] {
  return generatePriceIntervals(endTime, 15, intervals, 25, 80, nodeId, "ERCOT");
}

/** Generate CAISO OASIS-style 5-min LMP data (mock). */
export function mockCaisoWholesalePrices(
  nodeId: string = "LAPLMG1_7_B2",
  intervals: number = 288,
  endTime: Date = new Date()
): WholesalePricePoint[] {
  return generatePriceIntervals(endTime, 5, intervals, 20, 120, nodeId, "CAISO");
}

/** Generate PJM Data Miner-style hourly LMP data (mock). */
export function mockPjmWholesalePrices(
  nodeId: string = "PJM-RTO",
  hours: number = 168,
  endTime: Date = new Date()
): WholesalePricePoint[] {
  return generatePriceIntervals(endTime, 60, hours, 30, 75, nodeId, "PJM");
}

function generatePriceIntervals(
  endTime: Date,
  intervalMinutes: number,
  count: number,
  basePrice: number,
  peakPrice: number,
  nodeId: string,
  iso: string
): WholesalePricePoint[] {
  const points: WholesalePricePoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(endTime);
    start.setTime(start.getTime() - i * intervalMinutes * 60 * 1000);
    const end = new Date(start);
    end.setTime(end.getTime() + intervalMinutes * 60 * 1000);
    const hour = start.getUTCHours();
    const dailyPeak = hour >= 14 && hour <= 19 ? 1 : 0.5 + 0.3 * Math.sin((hour - 6) * (Math.PI / 12));
    const lmp = basePrice + (peakPrice - basePrice) * dailyPeak * (0.9 + Math.random() * 0.2);
    const congestion = lmp * 0.08 * (0.8 + Math.random() * 0.4);
    const loss = lmp * 0.02 * (0.8 + Math.random() * 0.4);
    points.push({
      timestamp: start.toISOString(),
      interval_start: start.toISOString(),
      interval_end: end.toISOString(),
      node_id: nodeId,
      node_name: `${nodeId} (${iso})`,
      lmp: Math.round(lmp * 100) / 100,
      energy: Math.round((lmp - congestion - loss) * 100) / 100,
      congestion: Math.round(congestion * 100) / 100,
      loss: Math.round(loss * 100) / 100,
    });
  }
  return points;
}

/** Serialize price points to CSV (ERCOT/CAISO/PJM style). */
export function wholesalePricesToCsv(points: WholesalePricePoint[], intervalLabel: string): string {
  const headers = [
    "timestamp",
    "interval_start",
    "interval_end",
    "node_id",
    "node_name",
    "lmp",
    "energy",
    "congestion",
    "loss",
  ].join(",");
  const rows = points.map((p) =>
    [
      p.timestamp,
      p.interval_start ?? "",
      p.interval_end ?? "",
      p.node_id ?? "",
      (p.node_name ?? "").replace(/,/g, " "),
      p.lmp,
      p.energy ?? "",
      p.congestion ?? "",
      p.loss ?? "",
    ].join(",")
  );
  return [headers, ...rows].join("\n");
}
