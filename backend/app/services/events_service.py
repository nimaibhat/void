"""Events Service — pre-generated Winter Storm Uri timeline events for the operator live feed."""

from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator, List

from app.models.utility import EventSeverity, TimelineEvent

# ── Uri timeline events (T+0 = cold front arrival, Feb 14 2021 ~02:00 CT) ──

_URI_EVENTS: List[dict] = [
    {
        "event_id": "EVT-001",
        "timestamp_offset_minutes": 0,
        "title": "Arctic Cold Front Arrival",
        "description": "Polar vortex-driven cold front crosses Texas panhandle. Temps dropping 30°F in 2 hours.",
        "severity": "warning",
        "region": "WTX",
        "affected_nodes": 6,
    },
    {
        "event_id": "EVT-002",
        "timestamp_offset_minutes": 30,
        "title": "Wind Turbine Icing — Lubbock",
        "description": "Ice accumulation on turbine blades at Lubbock wind farm. 1,500 MW generation offline.",
        "severity": "critical",
        "region": "WTX",
        "affected_nodes": 3,
    },
    {
        "event_id": "EVT-003",
        "timestamp_offset_minutes": 90,
        "title": "Heating Demand Surge — Dallas",
        "description": "Electric heating demand spiking 240% above normal as temps hit 8°F.",
        "severity": "warning",
        "region": "DAL",
        "affected_nodes": 10,
    },
    {
        "event_id": "EVT-004",
        "timestamp_offset_minutes": 150,
        "title": "Gas Pressure Drop — Permian Basin",
        "description": "Natural gas wellhead freeze-offs reducing supply. Gas-fired plants at 60% capacity.",
        "severity": "critical",
        "region": "WTX",
        "affected_nodes": 4,
    },
    {
        "event_id": "EVT-005",
        "timestamp_offset_minutes": 210,
        "title": "ERCOT Emergency Alert Level 1",
        "description": "Operating reserves below 2,300 MW. Conservation appeal issued to all consumers.",
        "severity": "warning",
        "region": None,
        "affected_nodes": 0,
    },
    {
        "event_id": "EVT-006",
        "timestamp_offset_minutes": 270,
        "title": "Generation Trip — Comanche Peak",
        "description": "Feedwater pump failure at nuclear unit. 1,200 MW lost unexpectedly.",
        "severity": "emergency",
        "region": "DAL",
        "affected_nodes": 8,
    },
    {
        "event_id": "EVT-007",
        "timestamp_offset_minutes": 330,
        "title": "Frequency Excursion — 59.4 Hz",
        "description": "Grid frequency dropped to 59.4 Hz. Automatic under-frequency load shedding activated.",
        "severity": "emergency",
        "region": None,
        "affected_nodes": 54,
    },
    {
        "event_id": "EVT-008",
        "timestamp_offset_minutes": 340,
        "title": "Rolling Blackouts Initiated",
        "description": "ERCOT orders controlled load shed across all regions. 10,500 MW curtailed.",
        "severity": "emergency",
        "region": None,
        "affected_nodes": 20,
    },
    {
        "event_id": "EVT-009",
        "timestamp_offset_minutes": 420,
        "title": "Houston Substation Overload",
        "description": "Main Houston transmission hub at 98% capacity. Cascading risk imminent.",
        "severity": "critical",
        "region": "HOU",
        "affected_nodes": 12,
    },
    {
        "event_id": "EVT-010",
        "timestamp_offset_minutes": 480,
        "title": "Water Treatment Plant Offline — Austin",
        "description": "Loss of power to Austin water treatment. Boil water notice issued.",
        "severity": "critical",
        "region": "AUS",
        "affected_nodes": 5,
    },
    {
        "event_id": "EVT-011",
        "timestamp_offset_minutes": 600,
        "title": "Crew Dispatch — CREW-TX-14",
        "description": "Line repair crew dispatched to Houston transmission corridor.",
        "severity": "info",
        "region": "HOU",
        "affected_nodes": 0,
    },
    {
        "event_id": "EVT-012",
        "timestamp_offset_minutes": 720,
        "title": "Gas Pipeline Freeze — San Antonio",
        "description": "Major gas pipeline instrument freeze. San Antonio peaker plants forced offline.",
        "severity": "critical",
        "region": "SAT",
        "affected_nodes": 8,
    },
    {
        "event_id": "EVT-013",
        "timestamp_offset_minutes": 960,
        "title": "Mutual Aid Requested",
        "description": "ERCOT requests mutual aid from SPP and MISO. Limited DC tie capacity available.",
        "severity": "warning",
        "region": None,
        "affected_nodes": 0,
    },
    {
        "event_id": "EVT-014",
        "timestamp_offset_minutes": 1200,
        "title": "Peak Demand — 69,150 MW",
        "description": "All-time winter peak demand reached. Available generation only 45,000 MW.",
        "severity": "emergency",
        "region": None,
        "affected_nodes": 35,
    },
    {
        "event_id": "EVT-015",
        "timestamp_offset_minutes": 1440,
        "title": "24-Hour Mark — 4.5M Without Power",
        "description": "Rolling blackouts extended. 4.5 million customers without power across Texas.",
        "severity": "emergency",
        "region": None,
        "affected_nodes": 30,
    },
    {
        "event_id": "EVT-016",
        "timestamp_offset_minutes": 1800,
        "title": "Temps Begin Rising — Dallas",
        "description": "Temperatures climb above 20°F in Dallas metro. Heating load starting to decrease.",
        "severity": "info",
        "region": "DAL",
        "affected_nodes": 0,
    },
    {
        "event_id": "EVT-017",
        "timestamp_offset_minutes": 2100,
        "title": "Generation Recovery Begins",
        "description": "Gas supply partially restored. 8,000 MW of generation returning online.",
        "severity": "info",
        "region": None,
        "affected_nodes": 0,
    },
    {
        "event_id": "EVT-018",
        "timestamp_offset_minutes": 2400,
        "title": "Load Shed Reduction",
        "description": "ERCOT reduces controlled load shed from 10,500 MW to 4,200 MW.",
        "severity": "warning",
        "region": None,
        "affected_nodes": 12,
    },
    {
        "event_id": "EVT-019",
        "timestamp_offset_minutes": 2700,
        "title": "Crew Repair Complete — Houston Hub",
        "description": "CREW-TX-14 completes emergency repairs on Houston transmission corridor.",
        "severity": "info",
        "region": "HOU",
        "affected_nodes": 0,
    },
    {
        "event_id": "EVT-020",
        "timestamp_offset_minutes": 2880,
        "title": "Partial Restoration — 48h Mark",
        "description": "Grid frequency stabilized at 60.0 Hz. 2.1 million customers still without power.",
        "severity": "warning",
        "region": None,
        "affected_nodes": 15,
    },
]

_NORMAL_EVENTS: List[dict] = [
    {
        "event_id": "EVT-N01",
        "timestamp_offset_minutes": 0,
        "title": "Scheduled Maintenance — AUS_003",
        "description": "Planned transformer maintenance at Austin substation. Backup path active.",
        "severity": "info",
        "region": "AUS",
        "affected_nodes": 1,
    },
    {
        "event_id": "EVT-N02",
        "timestamp_offset_minutes": 120,
        "title": "Vegetation Trimming — DAL Corridor",
        "description": "Routine vegetation management along Dallas-Fort Worth transmission line.",
        "severity": "info",
        "region": "DAL",
        "affected_nodes": 0,
    },
    {
        "event_id": "EVT-N03",
        "timestamp_offset_minutes": 360,
        "title": "Peak Demand Forecast Normal",
        "description": "Afternoon peak expected at 52,000 MW. Sufficient reserves available.",
        "severity": "info",
        "region": None,
        "affected_nodes": 0,
    },
    {
        "event_id": "EVT-N04",
        "timestamp_offset_minutes": 480,
        "title": "Relay Test Complete — HOU_001",
        "description": "Protective relay testing completed at Houston main substation. All systems nominal.",
        "severity": "info",
        "region": "HOU",
        "affected_nodes": 0,
    },
]


def get_events(scenario: str = "uri") -> List[TimelineEvent]:
    """Return pre-generated timeline events for the given scenario."""
    raw = _URI_EVENTS if scenario == "uri" else _NORMAL_EVENTS
    return [TimelineEvent(**e) for e in raw]


async def stream_events(scenario: str = "uri") -> AsyncGenerator[str, None]:
    """Yield SSE-formatted events with ~2s delays between them."""
    events = get_events(scenario)
    for event in events:
        data = event.model_dump_json()
        yield f"data: {data}\n\n"
        await asyncio.sleep(2.0)
    yield "data: {\"done\": true}\n\n"
