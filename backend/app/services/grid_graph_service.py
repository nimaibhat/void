"""Synthetic Texas power grid — loads into a NetworkX graph on startup.

Generates a ~54-node / ~120-edge approximation of the ERCOT grid with
clusters around Houston, Dallas, Austin, San Antonio, and West TX plus
scattered nodes.  Persists to JSON so the graph is deterministic across
restarts.
"""

from __future__ import annotations

import json
import logging
import math
import random as _random
from pathlib import Path
from typing import Any, Dict, List, Tuple

import networkx as nx

logger = logging.getLogger("blackout.grid_graph")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
GRID_JSON = DATA_DIR / "synthetic_grid.json"

# ── Cluster definitions ─────────────────────────────────────────────

_CLUSTERS: Dict[str, Dict[str, Any]] = {
    "HOU": {"center": (29.76, -95.37), "count": 12, "spread": 0.30},
    "DAL": {"center": (32.78, -96.80), "count": 10, "spread": 0.25},
    "AUS": {"center": (30.27, -97.74), "count": 10, "spread": 0.20},
    "SAT": {"center": (29.42, -98.49), "count": 8, "spread": 0.20},
    "WTX": {"center": (31.95, -102.10), "count": 6, "spread": 0.50},
}

_SCATTERED: List[Tuple[str, float, float]] = [
    ("CRP", 27.80, -97.40),   # Corpus Christi
    ("LBK", 33.57, -101.85),  # Lubbock
    ("ELP", 31.76, -106.44),  # El Paso
    ("BEA", 30.08, -94.10),   # Beaumont
    ("TYL", 32.35, -95.30),   # Tyler
    ("WCO", 31.55, -97.15),   # Waco
    ("AMR", 35.22, -101.83),  # Amarillo
    ("LRD", 27.51, -99.51),   # Laredo
]

# Adjacent cluster pairs for inter-cluster transmission lines.
_INTER_CLUSTER = [
    ("HOU", "AUS", 3),
    ("HOU", "DAL", 3),
    ("HOU", "SAT", 2),
    ("AUS", "DAL", 2),
    ("AUS", "SAT", 2),
    ("DAL", "WTX", 2),
    ("WTX", "SAT", 1),
    ("AUS", "WTX", 1),
]


# ── Helpers ─────────────────────────────────────────────────────────


def _dist(a: Dict[str, Any], b: Dict[str, Any]) -> float:
    """Euclidean distance on lat/lon (good enough for Texas-scale)."""
    return math.hypot(a["lat"] - b["lat"], a["lon"] - b["lon"])


# ── Generator ───────────────────────────────────────────────────────


def _generate_grid() -> Dict[str, Any]:
    """Produce a deterministic synthetic ERCOT grid."""
    rng = _random.Random(42)
    nodes: List[Dict[str, Any]] = []
    node_index: Dict[str, Dict[str, Any]] = {}

    # ---- Clustered nodes ----
    for cname, info in _CLUSTERS.items():
        clat, clon = info["center"]
        for i in range(info["count"]):
            nid = f"{cname}_{i + 1:03d}"
            lat = round(clat + rng.gauss(0, info["spread"] * 0.4), 4)
            lon = round(clon + rng.gauss(0, info["spread"] * 0.4), 4)
            # First node in cluster is the major substation.
            base = round(rng.uniform(350, 500) if i == 0 else rng.uniform(80, 320), 1)
            node = {
                "id": nid,
                "lat": lat,
                "lon": lon,
                "base_load_mw": base,
                "capacity_mw": round(base * 1.3, 1),
                "voltage_kv": rng.choice([138, 230, 345, 500]),
                "region": "ERCOT",
            }
            nodes.append(node)
            node_index[nid] = node

    # ---- Scattered nodes ----
    for prefix, slat, slon in _SCATTERED:
        nid = f"{prefix}_001"
        base = round(rng.uniform(50, 200), 1)
        node = {
            "id": nid,
            "lat": round(slat + rng.gauss(0, 0.05), 4),
            "lon": round(slon + rng.gauss(0, 0.05), 4),
            "base_load_mw": base,
            "capacity_mw": round(base * 1.3, 1),
            "voltage_kv": rng.choice([138, 230]),
            "region": "ERCOT",
        }
        nodes.append(node)
        node_index[nid] = node

    # ---- Intra-cluster edges (each node → 3 nearest in same cluster) ----
    edge_set: set[Tuple[str, str]] = set()

    for cname in _CLUSTERS:
        cnodes = [n for n in nodes if n["id"].startswith(cname + "_")]
        for node in cnodes:
            dists = sorted(
                ((n["id"], _dist(node, n)) for n in cnodes if n["id"] != node["id"]),
                key=lambda t: t[1],
            )
            for neighbour_id, _ in dists[:3]:
                edge_set.add(tuple(sorted([node["id"], neighbour_id])))

    # ---- Inter-cluster edges (closest node pairs) ----
    for c1, c2, count in _INTER_CLUSTER:
        c1_nodes = [n for n in nodes if n["id"].startswith(c1 + "_")]
        c2_nodes = [n for n in nodes if n["id"].startswith(c2 + "_")]
        pairs = sorted(
            ((a["id"], b["id"], _dist(a, b)) for a in c1_nodes for b in c2_nodes),
            key=lambda t: t[2],
        )
        for a_id, b_id, _ in pairs[:count]:
            edge_set.add(tuple(sorted([a_id, b_id])))

    # ---- Scattered → nearest 2 cluster nodes ----
    cluster_nodes = [n for n in nodes if not any(n["id"].startswith(s + "_") for s, _, _ in _SCATTERED)]
    for node in nodes:
        if any(node["id"].startswith(s + "_") for s, _, _ in _SCATTERED):
            dists = sorted(
                ((cn["id"], _dist(node, cn)) for cn in cluster_nodes),
                key=lambda t: t[1],
            )
            for cid, _ in dists[:2]:
                edge_set.add(tuple(sorted([node["id"], cid])))

    # ---- Build edge dicts ----
    edges: List[Dict[str, Any]] = []
    for a, b in sorted(edge_set):
        na, nb = node_index[a], node_index[b]
        cap = round(min(na["capacity_mw"], nb["capacity_mw"]) * rng.uniform(0.8, 1.4), 1)
        imp = round(rng.uniform(0.005, 0.05), 4)
        edges.append({
            "from_bus": a,
            "to_bus": b,
            "capacity_mva": cap,
            "impedance": imp,
        })

    logger.info("Generated synthetic grid: %d nodes, %d edges", len(nodes), len(edges))
    return {"nodes": nodes, "edges": edges}


# ════════════════════════════════════════════════════════════════════
#  GridGraphService  (singleton)
# ════════════════════════════════════════════════════════════════════


class GridGraphService:
    """Holds the ERCOT grid graph in memory.  Loaded once on startup."""

    def __init__(self) -> None:
        self.graph: nx.Graph = nx.Graph()
        self._raw: Dict[str, Any] = {"nodes": [], "edges": []}
        self.loaded = False

    # ── Lifecycle ────────────────────────────────────────────────────

    def load(self) -> None:
        """Load grid from JSON (generate first if missing)."""
        DATA_DIR.mkdir(parents=True, exist_ok=True)

        if not GRID_JSON.exists():
            logger.info("Generating synthetic ERCOT grid …")
            data = _generate_grid()
            GRID_JSON.write_text(json.dumps(data, indent=2))
        else:
            data = json.loads(GRID_JSON.read_text())

        self._raw = data
        self._build_networkx(data)
        self.loaded = True
        logger.info(
            "Grid loaded: %d nodes, %d edges",
            self.graph.number_of_nodes(),
            self.graph.number_of_edges(),
        )

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
            )
        for e in data["edges"]:
            g.add_edge(
                e["from_bus"],
                e["to_bus"],
                capacity_mva=e["capacity_mva"],
                impedance=e["impedance"],
            )
        self.graph = g

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


# Module-level singleton
grid_graph = GridGraphService()
