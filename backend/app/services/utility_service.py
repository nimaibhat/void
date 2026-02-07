"""Utility Service — crew assignments for operator dashboard."""

from __future__ import annotations

from typing import List

from app.models.utility import Crew, CrewOptimizationResponse, CrewStatus

# ── Pre-populated Uri crews ─────────────────────────────────────────

_URI_CREWS: List[dict] = [
    {
        "crew_id": "CREW-TX-14",
        "name": "Houston Line Alpha",
        "status": "deployed",
        "lat": 29.76,
        "lon": -95.37,
        "city": "Houston",
        "specialty": "line_repair",
        "assigned_region": "HOU",
        "eta_minutes": 0,
    },
    {
        "crew_id": "CREW-TX-22",
        "name": "Dallas Substation Bravo",
        "status": "deployed",
        "lat": 32.78,
        "lon": -96.80,
        "city": "Dallas",
        "specialty": "substation",
        "assigned_region": "DAL",
        "eta_minutes": 0,
    },
    {
        "crew_id": "CREW-TX-08",
        "name": "Austin Distribution Charlie",
        "status": "en_route",
        "lat": 30.27,
        "lon": -97.74,
        "city": "Austin",
        "specialty": "distribution",
        "assigned_region": "AUS",
        "eta_minutes": 45,
    },
    {
        "crew_id": "CREW-TX-31",
        "name": "San Antonio Gen Delta",
        "status": "deployed",
        "lat": 29.42,
        "lon": -98.49,
        "city": "San Antonio",
        "specialty": "generation",
        "assigned_region": "SAT",
        "eta_minutes": 0,
    },
    {
        "crew_id": "CREW-NY-05",
        "name": "New York Mutual Aid Echo",
        "status": "en_route",
        "lat": 32.00,
        "lon": -97.00,
        "city": "New York (Mutual Aid)",
        "specialty": "line_repair",
        "assigned_region": "DAL",
        "eta_minutes": 180,
    },
    {
        "crew_id": "CREW-TX-17",
        "name": "Midland Gen Foxtrot",
        "status": "standby",
        "lat": 31.99,
        "lon": -102.08,
        "city": "Midland",
        "specialty": "generation",
        "assigned_region": "WTX",
        "eta_minutes": None,
    },
    {
        "crew_id": "CREW-TX-42",
        "name": "Corpus Christi Dist Golf",
        "status": "standby",
        "lat": 27.80,
        "lon": -97.40,
        "city": "Corpus Christi",
        "specialty": "distribution",
        "assigned_region": None,
        "eta_minutes": None,
    },
]

_NORMAL_CREWS: List[dict] = [
    {
        "crew_id": "CREW-TX-14",
        "name": "Houston Line Alpha",
        "status": "standby",
        "lat": 29.76,
        "lon": -95.37,
        "city": "Houston",
        "specialty": "line_repair",
        "assigned_region": None,
        "eta_minutes": None,
    },
    {
        "crew_id": "CREW-TX-22",
        "name": "Dallas Substation Bravo",
        "status": "standby",
        "lat": 32.78,
        "lon": -96.80,
        "city": "Dallas",
        "specialty": "substation",
        "assigned_region": None,
        "eta_minutes": None,
    },
    {
        "crew_id": "CREW-TX-08",
        "name": "Austin Distribution Charlie",
        "status": "standby",
        "lat": 30.27,
        "lon": -97.74,
        "city": "Austin",
        "specialty": "distribution",
        "assigned_region": None,
        "eta_minutes": None,
    },
]


def get_crews(scenario: str = "uri") -> CrewOptimizationResponse:
    """Return crew assignments for the given scenario."""
    raw = _URI_CREWS if scenario == "uri" else _NORMAL_CREWS
    crews = [Crew(**c) for c in raw]
    deployed = sum(1 for c in crews if c.status in (CrewStatus.DEPLOYED, CrewStatus.EN_ROUTE))
    total = len(crews)
    coverage = round(deployed / total, 2) if total else 0.0
    return CrewOptimizationResponse(
        crews=crews,
        total_deployed=deployed,
        coverage_pct=coverage,
    )
