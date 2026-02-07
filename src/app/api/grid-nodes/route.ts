import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "";

const PAGE_SIZE = 1000; // Supabase hard-caps at 1000 rows per request

/** Paginate through all rows of a Supabase table. */
async function fetchAllRows(
  table: string,
  select: string,
  headers: Record<string, string>
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let offset = 0;

  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}&order=id&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
    const rows: Record<string, unknown>[] = await res.json();
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}

export async function GET() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
  const nodeSelect = "id,lat,lon,base_load_mw,capacity_mw,voltage_kv,weather_zone";
  const edgeSelect = "from_bus,to_bus,capacity_mva";

  try {
    const [gridNodes, travisNodes, edges] = await Promise.all([
      fetchAllRows("grid_nodes", nodeSelect, headers),
      fetchAllRows("travis_nodes", nodeSelect, headers),
      fetchAllRows("grid_edges", edgeSelect, headers),
    ]);

    // Build node lookup: id → { lat, lon, source }
    const nodeLookup = new Map<string, { lat: number; lon: number; source: string }>();
    for (const n of gridNodes) {
      nodeLookup.set(n.id as string, { lat: n.lat as number, lon: n.lon as number, source: "activsg" });
    }
    for (const n of travisNodes) {
      nodeLookup.set(n.id as string, { lat: n.lat as number, lon: n.lon as number, source: "travis" });
    }

    // Resolve edges to coordinates, deduplicate parallel lines
    const seen = new Set<string>();
    const resolvedEdges: {
      fromLat: number; fromLon: number;
      toLat: number; toLon: number;
      source: string; capacity_mva: number;
    }[] = [];

    for (const e of edges) {
      const fromId = e.from_bus as string;
      const toId = e.to_bus as string;
      const key = fromId < toId ? `${fromId}-${toId}` : `${toId}-${fromId}`;
      if (seen.has(key)) continue; // skip parallel lines
      seen.add(key);

      const from = nodeLookup.get(fromId);
      const to = nodeLookup.get(toId);
      if (!from || !to) continue;

      // Classify: if either end is Travis → "travis", else "activsg"
      const source = from.source === "travis" || to.source === "travis" ? "travis" : "activsg";

      resolvedEdges.push({
        fromLat: from.lat, fromLon: from.lon,
        toLat: to.lat, toLon: to.lon,
        source,
        capacity_mva: e.capacity_mva as number,
      });
    }

    // Tag nodes
    const nodes = [
      ...gridNodes.map((n) => ({ ...n, source: "activsg" })),
      ...travisNodes.map((n) => ({ ...n, source: "travis" })),
    ];

    return NextResponse.json({ data: nodes, edges: resolvedEdges });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
