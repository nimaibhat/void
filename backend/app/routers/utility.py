"""Utility operator endpoints — overview, crews, events, outcomes, dispatch."""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.models.utility import (
    CrewOptimizationResponse,
    DispatchRecommendation,
    DispatchRequest,
    DispatchStatusResponse,
    DispatchAssignment,
    NationalOverview,
    OutcomeComparison,
    RegionOverview,
    TimelineEvent,
)
from app.schemas.responses import SuccessResponse
from app.services import (
    events_service,
    outcome_service,
    overview_service,
    utility_service,
    crew_dispatch_service,
)
from app.services.claude_service import generate_weather_events

router = APIRouter(prefix="/api/utility", tags=["utility"])


@router.get("/overview", response_model=SuccessResponse[NationalOverview])
async def overview(
    scenario: str = Query(default="uri", examples=["uri", "normal"]),
) -> SuccessResponse[NationalOverview]:
    """National grid overview with per-region status."""
    data = overview_service.get_overview(scenario=scenario)
    return SuccessResponse(data=data)


@router.get("/overview/{region}", response_model=SuccessResponse[RegionOverview])
async def region_detail(
    region: str,
    scenario: str = Query(default="uri", examples=["uri", "normal"]),
) -> SuccessResponse[RegionOverview]:
    """Single region detail."""
    data = overview_service.get_region(region_id=region, scenario=scenario)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Region not found: {region}")
    return SuccessResponse(data=data)


_ZONE_CITIES = {
    "Coast": "Houston",
    "East": "East TX",
    "Far West": "El Paso",
    "North": "Lubbock",
    "North Central": "DFW",
    "South Central": "Austin / SA",
    "Southern": "Rio Grande",
    "West": "Midland",
}


@router.get("/weather-events")
async def weather_events(
    scenario: str = Query(default="uri", examples=["uri", "normal", "live"]),
) -> SuccessResponse[list[dict]]:
    """LLM-generated weather event descriptions from real Open-Meteo data."""
    ov = overview_service.get_overview(scenario=scenario)

    zones = []
    for r in ov.regions:
        w = r.weather
        # Compute severity same as frontend
        if r.status.value in ("blackout", "critical"):
            sev = 4
        elif w.temp_f <= 10 or w.temp_f >= 105:
            sev = 4
        elif w.temp_f <= 20 or w.temp_f >= 95:
            sev = 3
        elif w.is_extreme:
            sev = 3
        elif r.status.value == "stressed":
            sev = 2
        else:
            sev = 1

        zones.append({
            "zone": r.region_id,
            "city": _ZONE_CITIES.get(r.name, r.name),
            "temp_f": w.temp_f,
            "wind_mph": w.wind_mph,
            "condition": w.condition,
            "is_extreme": w.is_extreme,
            "grid_status": r.status.value,
            "severity": sev,
        })

    # Only send zones that would appear as events (extreme weather or non-normal grid)
    event_zones = [z for z in zones if z["is_extreme"] or z["grid_status"] != "normal"]

    events = generate_weather_events(event_zones, scenario=scenario)
    return SuccessResponse(data=events)


@router.get("/crews", response_model=SuccessResponse[CrewOptimizationResponse])
async def crews(
    scenario: str = Query(default="uri", examples=["uri", "normal"]),
) -> SuccessResponse[CrewOptimizationResponse]:
    """Optimized crew assignments."""
    data = utility_service.get_crews(scenario=scenario)
    return SuccessResponse(data=data)


@router.get("/events", response_model=SuccessResponse[list[TimelineEvent]])
async def events(
    scenario: str = Query(default="uri", examples=["uri", "normal"]),
) -> SuccessResponse[list[TimelineEvent]]:
    """Pre-generated timeline events."""
    data = events_service.get_events(scenario=scenario)
    return SuccessResponse(data=data)


@router.get("/events/stream")
async def events_stream(
    scenario: str = Query(default="uri", examples=["uri", "normal"]),
) -> StreamingResponse:
    """SSE live event stream (2-3s intervals)."""
    return StreamingResponse(
        events_service.stream_events(scenario=scenario),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.get("/outcomes", response_model=SuccessResponse[OutcomeComparison])
async def outcomes(
    scenario: str = Query(default="uri", examples=["uri", "normal"]),
) -> SuccessResponse[OutcomeComparison]:
    """Without/With Blackout comparison."""
    data = outcome_service.get_outcomes(scenario=scenario)
    return SuccessResponse(data=data)


# ── Crew Dispatch ─────────────────────────────────────────────────────


@router.post("/crews/dispatch/init", response_model=SuccessResponse[dict])
async def dispatch_init(
    scenario: str = Query(default="uri", examples=["uri", "normal"]),
) -> SuccessResponse[dict]:
    """Initialize the dispatch system: load crews, run cascade, classify failed nodes.

    Must be called before recommend or dispatch.  Re-calling resets state.
    """
    from app.services import grid_graph_service, cascade_service, demand_service

    # Reset dispatch state
    crew_dispatch_service.reset(storm=(scenario == "uri"))

    # Load crews
    crew_data = utility_service.get_crews(scenario=scenario)
    crew_dispatch_service.load_crews(crew_data.crews)

    # Run cascade to get failed nodes
    graph = grid_graph_service.grid_graph.graph
    multipliers = demand_service.compute_demand_multipliers(
        scenario=("uri" if scenario == "uri" else "normal"), forecast_hour=36
    )
    cascade_result = cascade_service.run_cascade(graph, multipliers, scenario_label=scenario)

    # Get node attributes for classification
    graph_nodes = {}
    for nid in graph.nodes:
        nd = graph.nodes[nid]
        graph_nodes[nid] = {
            "voltage_kv": nd.get("voltage_kv", nd.get("base_kv", 0.0)),
            "capacity_mw": nd.get("capacity_mw", 0),
            "base_load_mw": nd.get("base_load_mw", 0),
            "weather_zone": nd.get("weather_zone", ""),
        }

    failed = crew_dispatch_service.load_failed_nodes(cascade_result, graph_nodes)

    return SuccessResponse(data={
        "status": "initialized",
        "crews_loaded": len(crew_data.crews),
        "failed_nodes": len(failed),
        "cascade_depth": cascade_result["cascade_depth"],
        "total_load_shed_mw": cascade_result["total_load_shed_mw"],
    })


@router.get("/crews/dispatch/recommend", response_model=SuccessResponse[DispatchRecommendation])
async def dispatch_recommend() -> SuccessResponse[DispatchRecommendation]:
    """Get recommended crew assignments based on the dispatch algorithm.

    Returns assignments sorted by priority (highest severity first).
    Does not actually dispatch — call POST /crews/dispatch to confirm.
    """
    rec = crew_dispatch_service.recommend_dispatch()
    return SuccessResponse(data=rec)


@router.post("/crews/dispatch", response_model=SuccessResponse[DispatchAssignment])
async def dispatch_single(body: DispatchRequest) -> SuccessResponse[DispatchAssignment]:
    """Dispatch a single crew to a specific failed node."""
    try:
        assignment = crew_dispatch_service.dispatch_crew(body.crew_id, body.target_node_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return SuccessResponse(data=assignment)


@router.post("/crews/dispatch/all", response_model=SuccessResponse[list[DispatchAssignment]])
async def dispatch_all() -> SuccessResponse[list[DispatchAssignment]]:
    """Accept all recommended assignments at once.

    Runs recommend_dispatch() then dispatches every recommended crew.
    """
    rec = crew_dispatch_service.recommend_dispatch()
    confirmed = crew_dispatch_service.dispatch_all(rec)
    return SuccessResponse(data=confirmed)


@router.get("/crews/dispatch/status", response_model=SuccessResponse[DispatchStatusResponse])
async def dispatch_status() -> SuccessResponse[DispatchStatusResponse]:
    """Get current dispatch status (assignments, crew positions, repaired nodes)."""
    data = crew_dispatch_service.get_status()
    return SuccessResponse(data=data)


@router.post("/crews/dispatch/tick", response_model=SuccessResponse[DispatchStatusResponse])
async def dispatch_tick() -> SuccessResponse[DispatchStatusResponse]:
    """Advance the dispatch state machine.

    Call periodically (e.g., every 5-10 seconds) to progress crews
    through DISPATCHED → EN_ROUTE → ON_SITE → REPAIRING → COMPLETE.
    Returns updated status.
    """
    data = crew_dispatch_service.tick()
    return SuccessResponse(data=data)
