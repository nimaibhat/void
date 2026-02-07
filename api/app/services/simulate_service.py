import uuid
from datetime import datetime, timezone

from app.models.simulate import (
    CascadeEvent,
    CascadeScenario,
    CascadeSimulationResponse,
)


async def run_cascade_simulation(
    scenario: CascadeScenario,
) -> CascadeSimulationResponse:
    """Run a cascade failure simulation for the given scenario.

    This should execute a grid cascade model that simulates how an initial
    trigger event (heatwave, equipment failure, etc.) propagates through
    the interconnected power grid, causing secondary failures, load
    shedding, and customer outages.

    Args:
        scenario: The CascadeScenario defining trigger, region, severity, etc.

    Returns:
        CascadeSimulationResponse with timeline of cascade events and metrics.
    """
    # TODO: Implement actual cascade simulation engine here
    now = datetime.now(timezone.utc)
    cascade_events = [
        CascadeEvent(
            hour=0,
            event=f"Initial {scenario.trigger.value} trigger in {scenario.region}",
            affected_region=scenario.region,
            load_shed_mw=0.0,
            customers_affected=0,
        ),
        CascadeEvent(
            hour=2,
            event="Generator trip due to thermal limits",
            affected_region=scenario.region,
            load_shed_mw=500.0,
            customers_affected=45000,
        ),
        CascadeEvent(
            hour=4,
            event="Transmission line overload — automatic relay trip",
            affected_region=scenario.region,
            load_shed_mw=1200.0,
            customers_affected=130000,
        ),
        CascadeEvent(
            hour=6,
            event="Rolling blackouts initiated by operator",
            affected_region=scenario.region,
            load_shed_mw=3000.0,
            customers_affected=450000,
        ),
        CascadeEvent(
            hour=12,
            event="Peak load shed — maximum cascade extent",
            affected_region=scenario.region,
            load_shed_mw=5000.0 * scenario.severity,
            customers_affected=int(800000 * scenario.severity),
        ),
    ]

    if scenario.include_secondary_effects:
        cascade_events.append(
            CascadeEvent(
                hour=8,
                event="Water treatment plant backup power activated",
                affected_region=scenario.region,
                load_shed_mw=150.0,
                customers_affected=0,
            )
        )

    cascade_events.sort(key=lambda e: e.hour)

    return CascadeSimulationResponse(
        simulation_id=str(uuid.uuid4()),
        scenario=scenario,
        started_at=now,
        completed_at=now,
        total_load_shed_mw=sum(e.load_shed_mw for e in cascade_events),
        peak_customers_affected=max(e.customers_affected for e in cascade_events),
        cascade_events=cascade_events,
        risk_score=round(scenario.severity * 8.5, 1),
    )
