"""Utility Service — crew roster from Supabase with hardcoded fallback."""

from __future__ import annotations

import logging
from typing import List

import requests

from app.config import settings
from app.models.utility import Crew, CrewOptimizationResponse, CrewStatus

logger = logging.getLogger("blackout.utility")

# ── Supabase fetch ────────────────────────────────────────────────────


def _fetch_crews_from_supabase(scenario: str) -> List[dict] | None:
    """Fetch crews from Supabase REST API.  Returns None on failure."""
    url = settings.supabase_url
    key = settings.supabase_anon_key
    if not url or not key:
        return None

    try:
        resp = requests.get(
            f"{url}/rest/v1/crews",
            params={"scenario": f"eq.{scenario}", "select": "*"},
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
            },
            timeout=5,
        )
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            return None
        logger.info("Loaded %d crews from Supabase (scenario=%s)", len(rows), scenario)
        return rows
    except Exception as e:
        logger.warning("Supabase crew fetch failed, using fallback: %s", e)
        return None


# ── Hardcoded fallback (7 Uri + 3 normal — original set) ─────────────

_URI_CREWS_FALLBACK: List[dict] = [
    {"crew_id": "CREW-TX-14", "name": "Houston Line Alpha",          "specialty": "line_repair",  "city": "Houston",        "lat": 29.76, "lon": -95.37},
    {"crew_id": "CREW-TX-22", "name": "Dallas Substation Bravo",     "specialty": "substation",   "city": "Dallas",         "lat": 32.78, "lon": -96.80},
    {"crew_id": "CREW-TX-08", "name": "Austin Distribution Charlie", "specialty": "distribution", "city": "Austin",         "lat": 30.27, "lon": -97.74},
    {"crew_id": "CREW-TX-31", "name": "San Antonio Gen Delta",       "specialty": "generation",   "city": "San Antonio",    "lat": 29.42, "lon": -98.49},
    {"crew_id": "CREW-NY-05", "name": "New York Mutual Aid Echo",    "specialty": "line_repair",  "city": "New York (MA)",  "lat": 32.00, "lon": -97.00},
    {"crew_id": "CREW-TX-17", "name": "Midland Gen Foxtrot",         "specialty": "generation",   "city": "Midland",        "lat": 31.99, "lon": -102.08},
    {"crew_id": "CREW-TX-42", "name": "Corpus Christi Dist Golf",    "specialty": "distribution", "city": "Corpus Christi", "lat": 27.80, "lon": -97.40},
]

_NORMAL_CREWS_FALLBACK: List[dict] = [
    {"crew_id": "CREW-TX-14", "name": "Houston Line Alpha",          "specialty": "line_repair",  "city": "Houston", "lat": 29.76, "lon": -95.37},
    {"crew_id": "CREW-TX-22", "name": "Dallas Substation Bravo",     "specialty": "substation",   "city": "Dallas",  "lat": 32.78, "lon": -96.80},
    {"crew_id": "CREW-TX-08", "name": "Austin Distribution Charlie", "specialty": "distribution", "city": "Austin",  "lat": 30.27, "lon": -97.74},
]


def get_crews(scenario: str = "uri") -> CrewOptimizationResponse:
    """Return crew roster for the given scenario (from Supabase or fallback)."""
    rows = _fetch_crews_from_supabase(scenario)
    if rows is None:
        rows = _URI_CREWS_FALLBACK if scenario == "uri" else _NORMAL_CREWS_FALLBACK

    crews = [
        Crew(
            crew_id=r["crew_id"],
            name=r["name"],
            status=CrewStatus.STANDBY,
            lat=r["lat"],
            lon=r["lon"],
            city=r["city"],
            specialty=r["specialty"],
        )
        for r in rows
    ]
    return CrewOptimizationResponse(
        crews=crews,
        total_deployed=0,
        coverage_pct=0.0,
    )
