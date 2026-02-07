"""ACTIVSg2000 + Travis 150 grid loader — parses MATPOWER .m + PowerWorld .aux
files into a NetworkX graph with ~2173 buses (2000 ACTIVSg2000 + 173 Travis
County overlay), generators, and branches.
"""

from __future__ import annotations

import json
import logging
import math
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import networkx as nx
import pandas as pd
from matpowercaseframes import CaseFrames

from app.config import settings

logger = logging.getLogger("blackout.grid_graph")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CACHE_JSON = DATA_DIR / "activsg2000" / "parsed_grid.json"

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


# ── Generic AUX block parser ─────────────────────────────────────────


def _tokenize_aux_line(line: str) -> List[str]:
    """Split an AUX data line by whitespace, respecting quoted strings."""
    tokens: List[str] = []
    i = 0
    while i < len(line):
        if line[i] == '"':
            j = line.find('"', i + 1)
            if j == -1:
                j = len(line)
            tokens.append(line[i + 1:j])
            i = j + 1
        elif line[i].isspace():
            i += 1
        else:
            j = i
            while j < len(line) and not line[j].isspace() and line[j] != '"':
                j += 1
            tokens.append(line[i:j])
            i = j
    return tokens


def _parse_aux_block(aux_text: str, block_name: str) -> List[Tuple[List[str], List[List[str]]]]:
    """Parse all DATA (BlockName, [fields]) { ... } blocks from AUX text.

    Returns a list of (field_names, rows) tuples — one per matching block.
    Each row is a list of string tokens.
    """
    pattern = re.compile(
        r'DATA\s*\(' + re.escape(block_name) + r'\s*,\s*\[([^\]]+)\]\s*\)\s*\{(.*?)\}',
        re.DOTALL,
    )
    results = []
    for match in pattern.finditer(aux_text):
        header_str = match.group(1)
        body = match.group(2)

        fields = [f.strip() for f in header_str.replace("\n", " ").split(",")]

        rows: List[List[str]] = []
        for line in body.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            tokens = _tokenize_aux_line(line)
            if tokens:
                rows.append(tokens)

        results.append((fields, rows))

    return results


# ── ACTIVSg2000 AUX parser (uses generic block parser) ──────────────


def _parse_aux_bus_data(aux_path: Path) -> Dict[int, Dict[str, Any]]:
    """Parse the Bus DATA block from a PowerWorld .aux file.

    Returns {bus_num: {lat, lon, area, zone, sub_num}}.
    """
    text = aux_path.read_text(encoding="utf-8", errors="replace")
    blocks = _parse_aux_block(text, "Bus")
    if not blocks:
        raise ValueError("Could not find Bus DATA block in .aux file")

    fields, rows = blocks[0]
    field_idx = {f: i for i, f in enumerate(fields)}

    result: Dict[int, Dict[str, Any]] = {}
    for tokens in rows:
        try:
            bus_num = int(tokens[field_idx["BusNum"]])
            lat = float(tokens[field_idx["Latitude:1"]])
            lon = float(tokens[field_idx["Longitude:1"]])
            area = int(tokens[field_idx["AreaNum"]])
            zone = int(tokens[field_idx["ZoneNum"]])
            sub_num = int(tokens[field_idx["SubNum"]])
        except (ValueError, IndexError, KeyError):
            continue

        result[bus_num] = {
            "lat": lat,
            "lon": lon,
            "area": area,
            "zone": zone,
            "sub_num": sub_num,
        }

    return result


# ── ACTIVSg2000 grid builder ─────────────────────────────────────────


def _build_grid_data(case_path: Path, aux_path: Path) -> Dict[str, Any]:
    """Parse MATPOWER + AUX and build nodes/edges dicts."""
    logger.info("Parsing ACTIVSg2000 MATPOWER case: %s", case_path)
    cf = CaseFrames(str(case_path))

    bus_df = cf.bus
    gen_df = cf.gen
    branch_df = cf.branch

    logger.info(
        "MATPOWER: %d buses, %d generators, %d branches",
        len(bus_df), len(gen_df), len(branch_df),
    )

    # Parse AUX for lat/lon
    logger.info("Parsing AUX file for coordinates: %s", aux_path)
    aux_data = _parse_aux_bus_data(aux_path)
    logger.info("AUX: %d bus entries with lat/lon", len(aux_data))

    # Sum generator Pmax per bus
    gen_capacity: Dict[int, float] = {}
    for _, row in gen_df.iterrows():
        bus = int(row.iloc[0])  # gen bus number
        pmax = float(row.iloc[8])  # Pmax
        gen_capacity[bus] = gen_capacity.get(bus, 0.0) + pmax

    # Build nodes
    nodes: List[Dict[str, Any]] = []
    bus_to_idx: Dict[int, int] = {}

    for idx, (_, row) in enumerate(bus_df.iterrows()):
        bus_num = int(row.iloc[0])
        bus_type = int(row.iloc[1])
        pd_mw = float(row.iloc[2])  # Real power demand
        base_kv = float(row.iloc[9])  # baseKV
        area = int(row.iloc[10]) if len(row) > 10 else 1

        # Get lat/lon from AUX
        aux = aux_data.get(bus_num)
        if aux is None:
            continue  # Skip buses without location data

        lat = aux["lat"]
        lon = aux["lon"]
        grid_zone = aux["zone"]

        # Classify into ERCOT weather zone
        weather_zone = _classify_weather_zone(lat, lon)

        # Capacity: sum of generator Pmax at this bus
        cap = gen_capacity.get(bus_num, 0.0)

        # Non-generator buses: fallback capacity
        if cap <= 0:
            cap = max(pd_mw * 1.3, 1.0)

        nid = f"B{bus_num}"
        bus_to_idx[bus_num] = idx

        nodes.append({
            "id": nid,
            "bus_num": bus_num,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "base_load_mw": round(max(pd_mw, 0.0), 2),
            "capacity_mw": round(cap, 2),
            "voltage_kv": round(base_kv, 1),
            "region": "ERCOT",
            "weather_zone": weather_zone,
            "area": area,
            "grid_zone": grid_zone,
            "source": "activsg2000",
        })

    # Build edges from branch data
    edges: List[Dict[str, Any]] = []
    valid_buses = {n["bus_num"] for n in nodes}

    for _, row in branch_df.iterrows():
        fbus = int(row.iloc[0])
        tbus = int(row.iloc[1])
        rate_a = float(row.iloc[5])  # Long-term MVA rating
        impedance = float(row.iloc[3])  # reactance (x)

        if fbus not in valid_buses or tbus not in valid_buses:
            continue

        edges.append({
            "from_bus": f"B{fbus}",
            "to_bus": f"B{tbus}",
            "capacity_mva": round(rate_a, 1) if rate_a > 0 else 100.0,
            "impedance": round(impedance, 6),
        })

    logger.info("Built ACTIVSg2000 grid: %d nodes, %d edges", len(nodes), len(edges))
    return {"nodes": nodes, "edges": edges}


# ── Travis 150 grid builder ──────────────────────────────────────────


def _build_travis150_data(aux_path: Path) -> Dict[str, Any]:
    """Parse Travis 150 Electric AUX into nodes + edges.

    The Travis 150 AUX has a different structure than ACTIVSg2000:
    - Lat/lon lives on the Substation block, not Bus
    - Load data is in a separate Load block
    - Bus numbers 1-173 (no overlap with ACTIVSg2000's 1001-3999)
    """
    logger.info("Parsing Travis 150 AUX: %s", aux_path)
    text = aux_path.read_text(encoding="utf-8", errors="replace")

    # 1. Parse Substation block → {sub_num: {lat, lon}}
    sub_blocks = _parse_aux_block(text, "Substation")
    if not sub_blocks:
        raise ValueError("Could not find Substation DATA block in Travis 150 AUX")
    sub_fields, sub_rows = sub_blocks[0]
    sub_idx = {f: i for i, f in enumerate(sub_fields)}

    substations: Dict[int, Dict[str, float]] = {}
    for tokens in sub_rows:
        try:
            sub_num = int(tokens[sub_idx["SubNum"]])
            lat = float(tokens[sub_idx["Latitude"]])
            lon = float(tokens[sub_idx["Longitude"]])
        except (ValueError, IndexError, KeyError):
            continue
        substations[sub_num] = {"lat": lat, "lon": lon}

    logger.info("Travis 150: %d substations", len(substations))

    # 2. Parse Bus block → {bus_num: {sub_num, voltage_kv}}
    bus_blocks = _parse_aux_block(text, "Bus")
    if not bus_blocks:
        raise ValueError("Could not find Bus DATA block in Travis 150 AUX")
    bus_fields, bus_rows = bus_blocks[0]
    bus_idx = {f: i for i, f in enumerate(bus_fields)}

    buses: Dict[int, Dict[str, Any]] = {}
    for tokens in bus_rows:
        try:
            bus_num = int(tokens[bus_idx["BusNum"]])
            voltage_kv = float(tokens[bus_idx["BusNomVolt"]])
            sub_num = int(tokens[bus_idx["SubNum"]])
        except (ValueError, IndexError, KeyError):
            continue
        sub = substations.get(sub_num)
        if sub is None:
            continue
        buses[bus_num] = {
            "sub_num": sub_num,
            "voltage_kv": voltage_kv,
            "lat": sub["lat"],
            "lon": sub["lon"],
        }

    logger.info("Travis 150: %d buses", len(buses))

    # 3. Parse Load block → {bus_num: load_mw}
    load_blocks = _parse_aux_block(text, "Load")
    load_per_bus: Dict[int, float] = {}
    if load_blocks:
        load_fields, load_rows = load_blocks[0]
        load_idx = {f: i for i, f in enumerate(load_fields)}
        for tokens in load_rows:
            try:
                bus_num = int(tokens[load_idx["BusNum"]])
                status = tokens[load_idx["LoadStatus"]]
                if status != "Closed":
                    continue
                load_mw = float(tokens[load_idx["LoadSMW"]])
            except (ValueError, IndexError, KeyError):
                continue
            load_per_bus[bus_num] = load_per_bus.get(bus_num, 0.0) + load_mw

    logger.info("Travis 150: %d buses with loads, total %.1f MW",
                len(load_per_bus), sum(load_per_bus.values()))

    # 4. Parse Gen block → {bus_num: total_gen_mw}
    gen_blocks = _parse_aux_block(text, "Gen")
    gen_per_bus: Dict[int, float] = {}
    if gen_blocks:
        gen_fields, gen_rows = gen_blocks[0]
        gen_idx = {f: i for i, f in enumerate(gen_fields)}
        for tokens in gen_rows:
            try:
                bus_num = int(tokens[gen_idx["BusNum"]])
                status = tokens[gen_idx["GenStatus"]]
                if status != "Closed":
                    continue
                gen_mw_max = float(tokens[gen_idx["GenMWMax"]])
            except (ValueError, IndexError, KeyError):
                continue
            gen_per_bus[bus_num] = gen_per_bus.get(bus_num, 0.0) + gen_mw_max

    logger.info("Travis 150: %d buses with generation, total %.1f MW",
                len(gen_per_bus), sum(gen_per_bus.values()))

    # 5. Parse Branch blocks (there are TWO — lines + transformers)
    branch_blocks = _parse_aux_block(text, "Branch")
    raw_edges: List[Dict[str, Any]] = []
    for br_fields, br_rows in branch_blocks:
        br_idx = {f: i for i, f in enumerate(br_fields)}
        for tokens in br_rows:
            try:
                fbus = int(tokens[br_idx["BusNum"]])
                tbus = int(tokens[br_idx["BusNum:1"]])
                status = tokens[br_idx["LineStatus"]]
                if status != "Closed":
                    continue
                line_x = float(tokens[br_idx["LineX"]])
                line_mva = float(tokens[br_idx["LineAMVA"]])
            except (ValueError, IndexError, KeyError):
                continue
            raw_edges.append({
                "fbus": fbus, "tbus": tbus,
                "capacity_mva": line_mva, "impedance": line_x,
            })

    logger.info("Travis 150: %d branch entries (closed)", len(raw_edges))

    # 6. Build nodes
    nodes: List[Dict[str, Any]] = []
    valid_bus_nums = set(buses.keys())

    for bus_num, bdata in buses.items():
        base_load = load_per_bus.get(bus_num, 0.0)
        cap = gen_per_bus.get(bus_num, 0.0)
        if cap <= 0:
            cap = max(base_load * 1.3, 1.0)

        nodes.append({
            "id": f"T{bus_num}",
            "bus_num": bus_num,
            "lat": round(bdata["lat"], 6),
            "lon": round(bdata["lon"], 6),
            "base_load_mw": round(max(base_load, 0.0), 2),
            "capacity_mw": round(cap, 2),
            "voltage_kv": round(bdata["voltage_kv"], 1),
            "region": "ERCOT",
            "weather_zone": "South Central",
            "area": 9,
            "grid_zone": 0,
            "source": "travis150",
        })

    # 7. Build edges
    edges: List[Dict[str, Any]] = []
    for e in raw_edges:
        if e["fbus"] not in valid_bus_nums or e["tbus"] not in valid_bus_nums:
            continue
        edges.append({
            "from_bus": f"T{e['fbus']}",
            "to_bus": f"T{e['tbus']}",
            "capacity_mva": round(e["capacity_mva"], 1) if e["capacity_mva"] > 0 else 100.0,
            "impedance": round(abs(e["impedance"]), 6),
        })

    logger.info("Built Travis 150 grid: %d nodes, %d edges", len(nodes), len(edges))
    return {"nodes": nodes, "edges": edges}


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
        """Load grid from cache or parse MATPOWER+AUX files + Travis 150."""
        DATA_DIR.mkdir(parents=True, exist_ok=True)

        if CACHE_JSON.exists():
            logger.info("Loading cached parsed grid from %s", CACHE_JSON)
            data = json.loads(CACHE_JSON.read_text())
            # Check if cache includes Travis 150 (has source field)
            if data["nodes"] and "source" not in data["nodes"][0]:
                logger.info("Cache missing Travis 150 data, rebuilding...")
                CACHE_JSON.unlink()
                data = self._build_merged_grid()
                CACHE_JSON.write_text(json.dumps(data))
                logger.info("Cached merged grid to %s", CACHE_JSON)
        else:
            data = self._build_merged_grid()
            CACHE_JSON.write_text(json.dumps(data))
            logger.info("Cached merged grid to %s", CACHE_JSON)

        self._raw = data
        self._build_networkx(data)
        self._build_zone_index()
        self.loaded = True
        logger.info(
            "Grid loaded: %d nodes, %d edges",
            self.graph.number_of_nodes(),
            self.graph.number_of_edges(),
        )

    def _build_merged_grid(self) -> Dict[str, Any]:
        """Build the merged ACTIVSg2000 + Travis 150 grid data."""
        # ACTIVSg2000
        case_path = Path(settings.activsg_case_file)
        aux_path = Path(settings.activsg_aux_file)
        activsg_data = _build_grid_data(case_path, aux_path)

        # Travis 150
        travis_path = Path(settings.travis150_aux_file)
        if travis_path.exists():
            travis_data = _build_travis150_data(travis_path)

            # Create tie lines
            tie_lines = _create_tie_lines(activsg_data["nodes"], travis_data["nodes"])

            # Merge
            merged_nodes = activsg_data["nodes"] + travis_data["nodes"]
            merged_edges = activsg_data["edges"] + travis_data["edges"] + tie_lines

            logger.info(
                "Merged grid: %d nodes (%d ACTIVSg + %d Travis), %d edges (%d + %d + %d ties)",
                len(merged_nodes), len(activsg_data["nodes"]), len(travis_data["nodes"]),
                len(merged_edges), len(activsg_data["edges"]), len(travis_data["edges"]),
                len(tie_lines),
            )
            return {"nodes": merged_nodes, "edges": merged_edges}
        else:
            logger.warning("Travis 150 AUX not found at %s, using ACTIVSg2000 only", travis_path)
            return activsg_data

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
        for e in data["edges"]:
            g.add_edge(
                e["from_bus"],
                e["to_bus"],
                capacity_mva=e["capacity_mva"],
                impedance=e["impedance"],
            )
        self.graph = g

    def _build_zone_index(self) -> None:
        """Build weather_zone → [node_ids] lookup."""
        self._zone_index = {}
        for nid in self.graph.nodes:
            wz = self.graph.nodes[nid]["weather_zone"]
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
