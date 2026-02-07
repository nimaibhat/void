"""Crew Dispatch Service — assignment algorithm, state machine, and ETA tracking.

Given a set of failed nodes from the cascade simulation and available crews,
computes optimal crew assignments based on:
  - Haversine distance (→ ETA)
  - Specialty match (voltage-level → crew type)
  - Failure severity (MW of load shed)

State is persisted on the module so it survives across requests within a
single backend process.  A reset is triggered when a new scenario is loaded.
"""

from __future__ import annotations

import math
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from app.models.utility import (
    Crew,
    CrewStatus,
    DispatchAssignment,
    DispatchRecommendation,
    DispatchStatusResponse,
    FailedNode,
)

# ── Constants ─────────────────────────────────────────────────────────

EARTH_RADIUS_KM = 6_371.0
DRIVE_SPEED_KMH = 80.0       # Normal conditions
STORM_SPEED_MULT = 0.65      # During severe weather (Uri, ice storm)
SPECIALTY_EXACT = 2.0         # Score multiplier for exact match
SPECIALTY_PARTIAL = 1.0       # Adjacent skill
SPECIALTY_MISMATCH = 0.3      # Wrong skill entirely

# Voltage → failure type → crew specialty mapping
VOLTAGE_SPECIALTY: List[Tuple[float, str, str]] = [
    (200.0, "transmission", "line_repair"),
    (69.0,  "substation",   "substation"),
    (0.0,   "distribution", "distribution"),
]

# Adjacent skills (can do the job, just not ideal)
ADJACENT_SKILLS: Dict[str, Set[str]] = {
    "line_repair":  {"substation"},
    "substation":   {"line_repair", "distribution"},
    "distribution": {"substation"},
    "generation":   set(),
}

# Repair time by failure type (minutes)
REPAIR_TIME: Dict[str, int] = {
    "transmission": 180,   # 3 hours
    "substation":   120,   # 2 hours
    "distribution":  60,   # 1 hour
    "generation":   240,   # 4 hours
    "unknown":       90,
}


# ── Haversine ─────────────────────────────────────────────────────────


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km between two lat/lon points."""
    rlat1, rlon1 = math.radians(lat1), math.radians(lon1)
    rlat2, rlon2 = math.radians(lat2), math.radians(lon2)
    dlat = rlat2 - rlat1
    dlon = rlon2 - rlon1
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
    return EARTH_RADIUS_KM * 2 * math.asin(math.sqrt(a))


def eta_minutes(distance_km: float, storm: bool = True) -> int:
    """Estimated drive time in minutes."""
    speed = DRIVE_SPEED_KMH * (STORM_SPEED_MULT if storm else 1.0)
    return max(1, round(distance_km / speed * 60))


# ── Classify node failure type ────────────────────────────────────────


def classify_failure(voltage_kv: float, has_generator: bool = False) -> Tuple[str, str]:
    """Return (failure_type, ideal_specialty) based on voltage level."""
    if has_generator:
        return "generation", "generation"
    for threshold, ftype, specialty in VOLTAGE_SPECIALTY:
        if voltage_kv >= threshold:
            return ftype, specialty
    return "distribution", "distribution"


def specialty_match_score(crew_specialty: str, ideal_specialty: str) -> Tuple[float, str]:
    """Score how well a crew's specialty matches the required work."""
    if crew_specialty == ideal_specialty:
        return SPECIALTY_EXACT, "exact"
    if ideal_specialty in ADJACENT_SKILLS.get(crew_specialty, set()):
        return SPECIALTY_PARTIAL, "partial"
    return SPECIALTY_MISMATCH, "mismatch"


# ── Module-level state ────────────────────────────────────────────────

_assignments: Dict[str, DispatchAssignment] = {}
_crews: Dict[str, Crew] = {}
_failed_nodes: Dict[str, FailedNode] = {}
_repaired_nodes: Set[str] = set()
_id_counter = 0
_storm_mode = True


def _next_id() -> str:
    global _id_counter
    _id_counter += 1
    return f"DISP-{_id_counter:04d}"


# ── Public API ────────────────────────────────────────────────────────


def reset(storm: bool = True) -> None:
    """Clear all dispatch state (called when a new scenario starts)."""
    global _storm_mode, _id_counter
    _assignments.clear()
    _crews.clear()
    _failed_nodes.clear()
    _repaired_nodes.clear()
    _id_counter = 0
    _storm_mode = storm


def load_crews(crews: List[Crew]) -> None:
    """Load current crew roster into dispatch state.

    All crews are reset to STANDBY so they're available for fresh dispatch,
    regardless of whatever static status they had before (DEPLOYED, EN_ROUTE, etc.).
    """
    _crews.clear()
    for c in crews:
        copy = c.model_copy()
        copy.status = CrewStatus.STANDBY
        copy.assigned_region = None
        copy.eta_minutes = None
        _crews[c.crew_id] = copy


def load_failed_nodes(
    cascade_result: Dict[str, Any],
    graph_nodes: Optional[Dict[str, Dict[str, Any]]] = None,
) -> List[FailedNode]:
    """Extract failed nodes from cascade result and classify them.

    Parameters
    ----------
    cascade_result : dict
        Output of ``cascade_service.run_cascade()``.
    graph_nodes : dict, optional
        If provided, used to look up voltage_kv for failure type classification.
        Keys are node IDs, values have ``voltage_kv`` and optionally ``capacity_mw``.
    """
    _failed_nodes.clear()
    nodes: List[FailedNode] = []

    for step in cascade_result.get("steps", []):
        for nf in step.get("new_failures", []):
            nid = nf["id"]
            if nid in _failed_nodes:
                continue  # already tracked from an earlier step

            voltage_kv = 0.0
            has_gen = False
            if graph_nodes and nid in graph_nodes:
                voltage_kv = graph_nodes[nid].get("voltage_kv", 0.0)
                # A node with capacity >> base_load likely has a generator
                cap = graph_nodes[nid].get("capacity_mw", 0)
                base = graph_nodes[nid].get("base_load_mw", 0)
                has_gen = cap > base * 2 and cap > 200

            ftype, _ = classify_failure(voltage_kv, has_gen)

            fn = FailedNode(
                id=nid,
                lat=nf["lat"],
                lon=nf["lon"],
                load_mw=nf["load_mw"],
                capacity_mw=nf["capacity_mw"],
                voltage_kv=voltage_kv,
                weather_zone=graph_nodes.get(nid, {}).get("weather_zone", "") if graph_nodes else "",
                failure_type=ftype,
            )
            _failed_nodes[nid] = fn
            nodes.append(fn)

    return nodes


def get_available_crews() -> List[Crew]:
    """Return crews that are available for dispatch (standby or complete)."""
    available_statuses = {CrewStatus.STANDBY, CrewStatus.COMPLETE}
    return [c for c in _crews.values() if c.status in available_statuses]


def get_assigned_crew_ids() -> Set[str]:
    """Return IDs of crews that are currently assigned (not available)."""
    active = {CrewStatus.DISPATCHED, CrewStatus.EN_ROUTE, CrewStatus.ON_SITE, CrewStatus.REPAIRING}
    return {c.crew_id for c in _crews.values() if c.status in active}


def get_unassigned_failed_nodes() -> List[FailedNode]:
    """Return failed nodes that don't yet have a crew assigned."""
    assigned_targets = {a.target_node_id for a in _assignments.values()
                        if a.status not in (CrewStatus.COMPLETE,)}
    return [fn for fn in _failed_nodes.values()
            if fn.id not in assigned_targets and fn.id not in _repaired_nodes]


def recommend_dispatch() -> DispatchRecommendation:
    """Run the greedy dispatch algorithm and return recommended assignments.

    Does NOT actually dispatch — returns recommendations for the operator
    to confirm.  Call ``dispatch_crew()`` to execute individual assignments.
    """
    available = {c.crew_id: c for c in get_available_crews()}
    unassigned = get_unassigned_failed_nodes()

    # Sort failed nodes by severity (highest load shed first)
    unassigned.sort(key=lambda n: n.load_mw, reverse=True)

    assignments: List[DispatchAssignment] = []
    used_crews: Set[str] = set()
    leftover_nodes: List[FailedNode] = []

    for node in unassigned:
        _, ideal_specialty = classify_failure(node.voltage_kv, node.failure_type == "generation")

        best_score = -1.0
        best_crew: Optional[Crew] = None
        best_dist = 0.0
        best_eta = 0
        best_match_score = 0.0
        best_match_label = "mismatch"

        for cid, crew in available.items():
            if cid in used_crews:
                continue

            dist = haversine_km(crew.lat, crew.lon, node.lat, node.lon)
            minutes = eta_minutes(dist, storm=_storm_mode)
            match_mult, match_label = specialty_match_score(crew.specialty, ideal_specialty)

            # Score: specialty match × severity weight / distance
            # Add 1 to distance to avoid division by zero
            severity_weight = min(5.0, node.load_mw / 500.0)  # cap at 5×
            score = match_mult * max(0.5, severity_weight) / (dist + 1.0) * 1000

            if score > best_score:
                best_score = score
                best_crew = crew
                best_dist = dist
                best_eta = minutes
                best_match_score = match_mult
                best_match_label = match_label

        if best_crew is not None:
            used_crews.add(best_crew.crew_id)
            repair_mins = REPAIR_TIME.get(node.failure_type, 90)

            assignments.append(DispatchAssignment(
                assignment_id=_next_id(),
                crew_id=best_crew.crew_id,
                crew_name=best_crew.name,
                target_node_id=node.id,
                target_lat=node.lat,
                target_lon=node.lon,
                distance_km=round(best_dist, 1),
                eta_minutes=best_eta,
                specialty_match=best_match_label,
                match_score=round(best_score, 2),
                failure_type=node.failure_type,
                status=CrewStatus.DISPATCHED,
                repair_minutes=repair_mins,
            ))
        else:
            leftover_nodes.append(node)

    total_available = len(available)
    avg_eta = (sum(a.eta_minutes for a in assignments) / len(assignments)) if assignments else 0.0

    return DispatchRecommendation(
        assignments=assignments,
        unassigned_nodes=leftover_nodes,
        total_crews_available=total_available,
        total_failed_nodes=len(unassigned),
        avg_eta_minutes=round(avg_eta, 1),
        coverage_pct=round(len(assignments) / max(len(unassigned), 1), 2),
    )


def dispatch_crew(crew_id: str, target_node_id: str) -> DispatchAssignment:
    """Confirm dispatch of a specific crew to a specific failed node.

    Updates crew status to DISPATCHED and records the assignment.
    """
    crew = _crews.get(crew_id)
    if crew is None:
        raise ValueError(f"Unknown crew: {crew_id}")
    if crew.status not in (CrewStatus.STANDBY, CrewStatus.COMPLETE, CrewStatus.DEPLOYED):
        raise ValueError(f"Crew {crew_id} is not available (status={crew.status})")

    node = _failed_nodes.get(target_node_id)
    if node is None:
        raise ValueError(f"Unknown or non-failed node: {target_node_id}")

    dist = haversine_km(crew.lat, crew.lon, node.lat, node.lon)
    minutes = eta_minutes(dist, storm=_storm_mode)
    _, ideal = classify_failure(node.voltage_kv, node.failure_type == "generation")
    match_mult, match_label = specialty_match_score(crew.specialty, ideal)
    repair_mins = REPAIR_TIME.get(node.failure_type, 90)

    now = datetime.now(timezone.utc)

    assignment = DispatchAssignment(
        assignment_id=_next_id(),
        crew_id=crew_id,
        crew_name=crew.name,
        target_node_id=target_node_id,
        target_lat=node.lat,
        target_lon=node.lon,
        distance_km=round(dist, 1),
        eta_minutes=minutes,
        specialty_match=match_label,
        match_score=round(match_mult, 2),
        failure_type=node.failure_type,
        status=CrewStatus.EN_ROUTE,
        repair_minutes=repair_mins,
        dispatched_at=now,
    )

    # Update crew state
    crew.status = CrewStatus.EN_ROUTE
    crew.assigned_region = target_node_id
    crew.eta_minutes = minutes

    _assignments[assignment.assignment_id] = assignment
    return assignment


def dispatch_all(recommendation: DispatchRecommendation) -> List[DispatchAssignment]:
    """Confirm all recommended assignments at once."""
    confirmed: List[DispatchAssignment] = []
    for rec in recommendation.assignments:
        try:
            a = dispatch_crew(rec.crew_id, rec.target_node_id)
            confirmed.append(a)
        except ValueError:
            continue  # crew or node became unavailable
    return confirmed


def tick() -> DispatchStatusResponse:
    """Advance the state machine — call periodically (e.g., every poll or SSE tick).

    Crews progress through states based on elapsed time:
      DISPATCHED/EN_ROUTE → ON_SITE (after ETA elapsed)
      ON_SITE → REPAIRING (immediate)
      REPAIRING → COMPLETE (after repair_minutes elapsed)

    Returns current state of all assignments and crews.
    """
    now = datetime.now(timezone.utc)

    for a in _assignments.values():
        crew = _crews.get(a.crew_id)
        if crew is None:
            continue

        if a.status in (CrewStatus.DISPATCHED, CrewStatus.EN_ROUTE):
            # Check if ETA has elapsed
            if a.dispatched_at:
                elapsed = (now - a.dispatched_at).total_seconds() / 60.0
                remaining = max(0, a.eta_minutes - int(elapsed))
                crew.eta_minutes = remaining

                if remaining <= 0:
                    a.status = CrewStatus.ON_SITE
                    a.arrived_at = now
                    crew.status = CrewStatus.ON_SITE
                    crew.eta_minutes = 0
                    # Update crew position to target
                    crew.lat = a.target_lat
                    crew.lon = a.target_lon
                else:
                    # Interpolate crew position
                    progress = elapsed / max(a.eta_minutes, 1)
                    progress = min(1.0, max(0.0, progress))
                    orig_lat = crew.lat + (a.target_lat - crew.lat) * progress
                    orig_lon = crew.lon + (a.target_lon - crew.lon) * progress
                    crew.lat = round(orig_lat, 4)
                    crew.lon = round(orig_lon, 4)

        elif a.status == CrewStatus.ON_SITE:
            # Immediately start repairing
            a.status = CrewStatus.REPAIRING
            crew.status = CrewStatus.REPAIRING

        elif a.status == CrewStatus.REPAIRING:
            if a.arrived_at:
                repair_elapsed = (now - a.arrived_at).total_seconds() / 60.0
                if repair_elapsed >= a.repair_minutes:
                    a.status = CrewStatus.COMPLETE
                    a.completed_at = now
                    crew.status = CrewStatus.COMPLETE
                    _repaired_nodes.add(a.target_node_id)

    # Build response
    active_assignments = list(_assignments.values())
    all_crews = list(_crews.values())

    return DispatchStatusResponse(
        assignments=active_assignments,
        crews=all_crews,
        repaired_nodes=sorted(_repaired_nodes),
        total_dispatched=sum(1 for a in active_assignments if a.status in (CrewStatus.DISPATCHED, CrewStatus.EN_ROUTE)),
        total_repairing=sum(1 for a in active_assignments if a.status == CrewStatus.REPAIRING),
        total_complete=sum(1 for a in active_assignments if a.status == CrewStatus.COMPLETE),
    )


def get_status() -> DispatchStatusResponse:
    """Get current dispatch status without advancing the state machine."""
    active_assignments = list(_assignments.values())
    all_crews = list(_crews.values())

    return DispatchStatusResponse(
        assignments=active_assignments,
        crews=all_crews,
        repaired_nodes=sorted(_repaired_nodes),
        total_dispatched=sum(1 for a in active_assignments if a.status in (CrewStatus.DISPATCHED, CrewStatus.EN_ROUTE)),
        total_repairing=sum(1 for a in active_assignments if a.status == CrewStatus.REPAIRING),
        total_complete=sum(1 for a in active_assignments if a.status == CrewStatus.COMPLETE),
    )
