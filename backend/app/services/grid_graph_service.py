"""ACTIVSg2000 + Travis 150 grid loader — reads node and edge data from
Supabase tables (``grid_nodes``, ``travis_nodes``, ``grid_edges``) and
builds a NetworkX graph with ~2173 buses.
"""

from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Tuple

import networkx as nx
import requests

from app.config import settings

logger = logging.getLogger("blackout.grid_graph")

# ── ERCOT Weather Zone bounding boxes ────────────────────────────────
# Ordered from most specific to least; first match wins.

WEATHER_ZONES: List[Dict[str, Any]] = [
    {"name": "Far West",      "lat_min": 29.0, "lat_max": 33.0, "lon_min": -106.5, "lon_max": -101.0},
    {"name": "West",          "lat_min": 30.0, "lat_max": 33.5, "lon_min": -101.5, "lon_max": -98.5},
    {"name": "North",         "lat_min": 33.0, "lat_max": 36.5, "lon_min": -103.0, "lon_max": -95.5},
    {"name": "North Central", "lat_min": 31.5, "lat_max": 33.5, "lon_min": -98.0,  "lon_max": -95.5},
    {"name": "East",          "lat_min": 30.0, "lat_max": 34.0, "lon_min": -96.0,  "lon_max": -93.5},
    {"name": "South Central", "lat_min": 29.0, "lat_max": 32.0, "lon_min": -99.0,  "lon_max": -96.5},
    {"name": "Southern",      "lat_min": 25.5, "lat_max": 29.0, "lon_min": -100.0, "lon_max": -97.0},
    {"name": "Coast",         "lat_min": 27.5, "lat_max": 30.5, "lon_min": -97.5,  "lon_max": -93.5},
]

ZONE_CENTROIDS: Dict[str, Tuple[float, float]] = {
    "Coast":         (28.75, -95.75),
    "East":          (32.0,  -94.75),
    "Far West":      (31.0,  -103.75),
    "North":         (34.75, -99.25),
    "North Central": (32.5,  -96.75),
    "South Central": (30.5,  -97.75),
    "Southern":      (27.25, -98.5),
    "West":          (31.75, -100.0),
}


def _classify_weather_zone(lat: float, lon: float) -> str:
    """Map a lat/lon to an ERCOT weather zone (bounding-box, fallback to nearest centroid)."""
    for zone in WEATHER_ZONES:
        if (zone["lat_min"] <= lat <= zone["lat_max"]
                and zone["lon_min"] <= lon <= zone["lon_max"]):
            return zone["name"]
    # Fallback: nearest centroid
    best_zone = "South Central"
    best_dist = float("inf")
    for zname, (clat, clon) in ZONE_CENTROIDS.items():
        d = math.hypot(lat - clat, lon - clon)
        if d < best_dist:
            best_dist = d
            best_zone = zname
    return best_zone


# ── Supabase data fetching ───────────────────────────────────────────


def _supabase_headers() -> Dict[str, str]:
    key = settings.supabase_anon_key
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def _fetch_all_rows(table: str, select: str = "*") -> List[Dict[str, Any]]:
    """Fetch all rows from a Supabase table, paginating as needed.

    Supabase caps responses at 1000 rows regardless of the ``limit``
    parameter, so we page in chunks of 1000 until we get a short page.
    """
    url = settings.supabase_url
    headers = _supabase_headers()
    page_size = 1000  # Supabase hard caps at 1000
    offset = 0
    all_rows: List[Dict[str, Any]] = []

    while True:
        api_url = (
            f"{url}/rest/v1/{table}"
            f"?select={select}&order=id&limit={page_size}&offset={offset}"
        )
        resp = requests.get(api_url, headers=headers, timeout=30)
        if not resp.ok:
            logger.error("Supabase %s fetch failed (%s): %s", table, resp.status_code, resp.text[:200])
            break
        rows = resp.json()
        if not rows:
            break
        all_rows.extend(rows)
        offset += page_size
        if len(rows) < page_size:
            break

    return all_rows


def _rows_to_nodes(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Convert Supabase node rows to the internal node dict format."""
    nodes: List[Dict[str, Any]] = []
    for r in rows:
        nodes.append({
            "id": r["id"],
            "bus_num": r.get("bus_num", 0),
            "lat": float(r["lat"]),
            "lon": float(r["lon"]),
            "base_load_mw": float(r.get("base_load_mw", 0)),
            "capacity_mw": float(r.get("capacity_mw", 1)),
            "voltage_kv": float(r.get("voltage_kv", 0)),
            "region": r.get("region", "ERCOT"),
            "weather_zone": r.get("weather_zone", "South Central"),
            "area": int(r.get("area", 1)),
            "grid_zone": int(r.get("grid_zone", 0)),
            "source": r.get("source", "activsg2000"),
        })
    return nodes


def _rows_to_edges(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Convert Supabase edge rows to the internal edge dict format."""
    edges: List[Dict[str, Any]] = []
    for r in rows:
        edges.append({
            "from_bus": r["from_bus"],
            "to_bus": r["to_bus"],
            "capacity_mva": float(r.get("capacity_mva", 100)),
            "impedance": float(r.get("impedance", 0.001)),
        })
    return edges


# ── Tie line creation ────────────────────────────────────────────────


def _create_tie_lines(
    activsg_nodes: List[Dict[str, Any]],
    travis_nodes: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Create synthetic tie lines connecting Travis 150 230kV buses to
    nearby ACTIVSg2000 230kV buses in the South Central zone."""

    # Find Travis 230kV buses
    travis_230 = [n for n in travis_nodes if n["voltage_kv"] >= 200]
    if not travis_230:
        logger.warning("No Travis 150 230kV buses found for tie lines")
        return []

    # Find ACTIVSg2000 230kV buses in South Central zone
    activsg_230_sc = [
        n for n in activsg_nodes
        if n["voltage_kv"] >= 200
        and n["weather_zone"] == "South Central"
    ]
    if not activsg_230_sc:
        logger.warning("No ACTIVSg2000 230kV buses in South Central zone for tie lines")
        return []

    # Pick the 3 Travis 230kV buses with the highest generation capacity
    travis_230.sort(key=lambda n: n["capacity_mw"], reverse=True)
    tie_travis = travis_230[:3]

    tie_lines: List[Dict[str, Any]] = []
    for t_node in tie_travis:
        # Find nearest ACTIVSg2000 230kV bus
        best_a = None
        best_dist = float("inf")
        for a_node in activsg_230_sc:
            d = math.hypot(t_node["lat"] - a_node["lat"], t_node["lon"] - a_node["lon"])
            if d < best_dist:
                best_dist = d
                best_a = a_node

        if best_a is not None:
            tie_lines.append({
                "from_bus": t_node["id"],
                "to_bus": best_a["id"],
                "capacity_mva": 500.0,
                "impedance": 0.001,
            })
            logger.info(
                "Tie line: %s (%.2f, %.2f) <-> %s (%.2f, %.2f), dist=%.3f deg",
                t_node["id"], t_node["lat"], t_node["lon"],
                best_a["id"], best_a["lat"], best_a["lon"],
                best_dist,
            )

    return tie_lines


# ════════════════════════════════════════════════════════════════════
#  GridGraphService  (singleton)
# ════════════════════════════════════════════════════════════════════


class GridGraphService:
    """Holds the merged ACTIVSg2000 + Travis 150 grid graph in memory."""

    def __init__(self) -> None:
        self.graph: nx.Graph = nx.Graph()
        self._raw: Dict[str, Any] = {"nodes": [], "edges": []}
        self.loaded = False
        self._zone_index: Dict[str, List[str]] = {}  # weather_zone → [node_ids]

    # ── Lifecycle ────────────────────────────────────────────────────

    def load(self) -> None:
        """Load grid data from Supabase tables and build NetworkX graph."""
        url = settings.supabase_url
        key = settings.supabase_anon_key
        if not url or not key:
            logger.warning("Supabase not configured — cannot load grid")
            return

        data = self._fetch_and_merge()
        self._raw = data
        self._build_networkx(data)
        self._build_zone_index()
        self.loaded = True
        logger.info(
            "Grid loaded: %d nodes, %d edges",
            self.graph.number_of_nodes(),
            self.graph.number_of_edges(),
        )

    def _fetch_and_merge(self) -> Dict[str, Any]:
        """Fetch nodes + edges from Supabase and merge with tie lines."""
        # ACTIVSg2000 nodes
        logger.info("Fetching ACTIVSg2000 nodes from Supabase grid_nodes table…")
        activsg_rows = _fetch_all_rows("grid_nodes")
        activsg_nodes = _rows_to_nodes(activsg_rows)
        logger.info("Fetched %d ACTIVSg2000 nodes", len(activsg_nodes))

        # Travis 150 nodes
        logger.info("Fetching Travis 150 nodes from Supabase travis_nodes table…")
        travis_rows = _fetch_all_rows("travis_nodes")
        travis_nodes = _rows_to_nodes(travis_rows)
        logger.info("Fetched %d Travis 150 nodes", len(travis_nodes))

        # Edges (includes both ACTIVSg2000 and Travis branches)
        logger.info("Fetching edges from Supabase grid_edges table…")
        edge_rows = _fetch_all_rows("grid_edges")
        edges = _rows_to_edges(edge_rows)
        logger.info("Fetched %d edges", len(edges))

        # Create tie lines between Travis and ACTIVSg2000
        tie_lines = _create_tie_lines(activsg_nodes, travis_nodes)

        merged_nodes = activsg_nodes + travis_nodes
        merged_edges = edges + tie_lines

        logger.info(
            "Merged grid: %d nodes (%d ACTIVSg + %d Travis), %d edges (%d stored + %d ties)",
            len(merged_nodes), len(activsg_nodes), len(travis_nodes),
            len(merged_edges), len(edges), len(tie_lines),
        )
        return {"nodes": merged_nodes, "edges": merged_edges}

    def _build_networkx(self, data: Dict[str, Any]) -> None:
        g = nx.Graph()
        for n in data["nodes"]:
            g.add_node(
                n["id"],
                lat=n["lat"],
                lon=n["lon"],
                base_load_mw=n["base_load_mw"],
                capacity_mw=n["capacity_mw"],
                voltage_kv=n["voltage_kv"],
                region=n["region"],
                weather_zone=n["weather_zone"],
                area=n["area"],
                grid_zone=n["grid_zone"],
                source=n.get("source", "activsg2000"),
            )
        node_ids = set(g.nodes)
        skipped = 0
        for e in data["edges"]:
            if e["from_bus"] in node_ids and e["to_bus"] in node_ids:
                g.add_edge(
                    e["from_bus"],
                    e["to_bus"],
                    capacity_mva=e["capacity_mva"],
                    impedance=e["impedance"],
                )
            else:
                skipped += 1
        if skipped:
            logger.warning("Skipped %d edges with missing endpoint nodes", skipped)
        self.graph = g

    def _build_zone_index(self) -> None:
        """Build weather_zone → [node_ids] lookup."""
        self._zone_index = {}
        for nid in self.graph.nodes:
            wz = self.graph.nodes[nid].get("weather_zone", "South Central")
            self._zone_index.setdefault(wz, []).append(nid)

    # ── Accessors ────────────────────────────────────────────────────

    def get_topology(self) -> Dict[str, Any]:
        """Return raw nodes + edges for the API."""
        return self._raw

    def get_node_ids(self) -> List[str]:
        return list(self.graph.nodes)

    def get_node(self, node_id: str) -> Dict[str, Any] | None:
        if node_id not in self.graph.nodes:
            return None
        attrs = dict(self.graph.nodes[node_id])
        attrs["id"] = node_id
        attrs["connected_nodes"] = list(self.graph.neighbors(node_id))
        return attrs

    def get_edges_raw(self) -> List[Dict[str, Any]]:
        return self._raw["edges"]

    def get_nodes_in_weather_zone(self, zone: str) -> List[str]:
        """Return all node IDs in the given ERCOT weather zone."""
        return self._zone_index.get(zone, [])

    def get_weather_zones(self) -> List[str]:
        """Return all weather zone names present in the grid."""
        return sorted(self._zone_index.keys())


# Module-level singleton
grid_graph = GridGraphService()
