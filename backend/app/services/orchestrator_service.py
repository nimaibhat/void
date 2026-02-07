"""Orchestrator Service — chains demand → cascade → price → alerts → crew dispatch.

Each step writes to Supabase ``simulation_sessions`` and ``live_alerts`` tables,
triggering Realtime events that the frontend subscribes to.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

import requests

from app.config import settings
from app.models.price import PricingMode
from app.services import cascade_service
from app.services.crew_dispatch_service import (
    dispatch_all,
    load_crews,
    load_failed_nodes,
    recommend_dispatch,
    reset as dispatch_reset,
)
from app.services.demand_service import compute_demand_multipliers
from app.services.grid_graph_service import grid_graph
from app.services.price_service import price_service
from app.services.claude_service import enhance_alerts
from app.services.utility_service import get_crews
from app.services.weather_alert_service import generate_weather_alerts
from app.services.alert_notification_service import broadcast_weather_alerts

logger = logging.getLogger("blackout.orchestrator")


# ── Supabase helpers ──────────────────────────────────────────────────


def _headers() -> Dict[str, str]:
    key = settings.supabase_anon_key
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _sb_url(path: str) -> str:
    return f"{settings.supabase_url}/rest/v1/{path}"


def _insert_session(session: Dict[str, Any]) -> Dict[str, Any]:
    """INSERT into simulation_sessions, return the created row."""
    resp = requests.post(
        _sb_url("simulation_sessions"),
        headers=_headers(),
        json=session,
        timeout=10,
    )
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else session


def _update_session(session_id: str, fields: Dict[str, Any]) -> None:
    """PATCH a simulation_sessions row by id."""
    resp = requests.patch(
        _sb_url(f"simulation_sessions?id=eq.{session_id}"),
        headers=_headers(),
        json=fields,
        timeout=10,
    )
    resp.raise_for_status()


def _insert_alerts(alerts: List[Dict[str, Any]]) -> None:
    """INSERT into live_alerts (batch)."""
    if not alerts:
        return
    resp = requests.post(
        _sb_url("live_alerts"),
        headers=_headers(),
        json=alerts,
        timeout=10,
    )
    resp.raise_for_status()


def _fetch_all_consumer_profiles() -> List[Dict[str, Any]]:
    """Fetch all consumer profiles from Supabase."""
    try:
        resp = requests.get(
            _sb_url("consumer_profiles"),
            params={"select": "*"},
            headers=_headers(),
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        logger.warning("Failed to fetch consumer profiles: %s", exc)
        return []


# ── Main pipeline ─────────────────────────────────────────────────────


def run_orchestrated_simulation(
    scenario: str = "uri",
    forecast_hour: int = 36,
    grid_region: str = "ERCOT",
) -> Dict[str, Any]:
    """Run the full simulation pipeline, writing progress to Supabase.

    Each UPDATE to ``simulation_sessions`` fires a Realtime event that the
    operator dashboard subscribes to.  Each INSERT into ``live_alerts``
    fires a Realtime event that the consumer dashboard subscribes to.
    """

    # ── 1. Create session ────────────────────────────────────────
    row = _insert_session({
        "scenario": scenario,
        "grid_region": grid_region,
        "forecast_hour": forecast_hour,
        "status": "running",
    })
    session_id = row["id"]
    logger.info("Orchestrator: session %s created (scenario=%s)", session_id, scenario)

    # ── 2. Demand multipliers ────────────────────────────────────
    multipliers = compute_demand_multipliers(scenario=scenario, forecast_hour=forecast_hour)
    logger.info("Orchestrator: computed %d demand multipliers", len(multipliers))

    # ── 3. Cascade simulation ────────────────────────────────────
    cascade_result = cascade_service.run_cascade(
        graph=grid_graph.graph,
        demand_multipliers=multipliers,
        scenario_label=scenario,
        forecast_hour=forecast_hour,
    )

    _update_session(session_id, {
        "status": "cascade_done",
        "total_failed_nodes": cascade_result["total_failed_nodes"],
        "cascade_depth": cascade_result["cascade_depth"],
        "total_load_shed_mw": cascade_result["total_load_shed_mw"],
        "failed_node_ids": cascade_result["failed_node_ids"],
    })
    logger.info(
        "Orchestrator: cascade done — %d failed, %.0f MW shed",
        cascade_result["total_failed_nodes"],
        cascade_result["total_load_shed_mw"],
    )

    # ── 4. Price forecast ────────────────────────────────────────
    prices = price_service.get_price_forecast(
        region=grid_region,
        mode=PricingMode.HYBRID if price_service.model else PricingMode.RULES,
        scenario="uri_2021" if scenario == "uri" else "normal",
        hours=48,
    )

    peak_price = max(p.price_mwh for p in prices) if prices else 0
    avg_price = (sum(p.price_mwh for p in prices) / len(prices)) if prices else 0

    _update_session(session_id, {
        "status": "prices_done",
        "peak_price_mwh": round(peak_price, 2),
        "avg_price_mwh": round(avg_price, 2),
    })
    logger.info("Orchestrator: prices done — peak $%.2f/MWh, avg $%.2f/MWh", peak_price, avg_price)

    # ── 5. Generate alerts ───────────────────────────────────────
    alerts: List[Dict[str, Any]] = []

    # 5a. Generate personalized weather alerts for each consumer
    consumer_profiles = _fetch_all_consumer_profiles()
    logger.info("Orchestrator: generating weather alerts for %d consumer profiles", len(consumer_profiles))

    for profile in consumer_profiles:
        profile_id = profile.get("id")
        if not profile_id:
            continue

        try:
            # Generate weather-based alerts for this consumer
            weather_alerts = asyncio.run(generate_weather_alerts(
                profile_id=profile_id,
                region=grid_region,
                scenario="uri_2021" if scenario == "uri" else "normal",
            ))

            # Convert DeviceAlert objects to live_alerts format
            for wa in weather_alerts:
                alerts.append({
                    "session_id": session_id,
                    "profile_id": profile_id,  # Link to specific consumer
                    "grid_region": grid_region,
                    "severity": wa.severity,
                    "title": wa.title,
                    "description": wa.description,
                    "alert_type": f"weather_{wa.device_type}",
                    "metadata": {
                        "device_type": wa.device_type,
                        "recommended_action": wa.recommended_action,
                        "estimated_savings_usd": wa.estimated_savings_usd,
                        "weather_reason": wa.weather_reason,
                        **wa.metadata,
                    },
                })
        except Exception as exc:
            logger.warning("Failed to generate weather alerts for profile %s: %s", profile_id, exc)

    logger.info("Orchestrator: generated %d personalized weather alerts", len(alerts))

    # 5b. Cascade warning
    if cascade_result["total_failed_nodes"] > 0:
        alerts.append({
            "session_id": session_id,
            "grid_region": grid_region,
            "severity": "critical",
            "title": f"Cascade Alert — {cascade_result['total_failed_nodes']} nodes failed",
            "description": (
                f"{cascade_result['total_load_shed_mw']:.0f} MW load shed across "
                f"{cascade_result['cascade_depth']} cascade steps. "
                f"Grid region: {grid_region}."
            ),
            "alert_type": "cascade_warning",
            "metadata": {
                "total_failed_nodes": cascade_result["total_failed_nodes"],
                "total_load_shed_mw": cascade_result["total_load_shed_mw"],
                "cascade_depth": cascade_result["cascade_depth"],
            },
        })

    # 5c. Price spike alert
    if peak_price > 100:
        severity = "critical" if peak_price > 1000 else "warning"
        alerts.append({
            "session_id": session_id,
            "grid_region": grid_region,
            "severity": severity,
            "title": f"Price Spike — ${peak_price:.0f}/MWh peak",
            "description": (
                f"Wholesale prices forecast to spike to ${peak_price:.0f}/MWh "
                f"(avg ${avg_price:.0f}/MWh). Consider shifting flexible loads to off-peak hours."
            ),
            "alert_type": "price_spike",
            "metadata": {
                "peak_price_mwh": round(peak_price, 2),
                "avg_price_mwh": round(avg_price, 2),
            },
        })

    # 5d. Device savings alert (for consumers with smart devices)
    if peak_price > 50:
        consumer_peak = max(p.consumer_price_kwh for p in prices) if prices else 0
        consumer_low = min(p.consumer_price_kwh for p in prices) if prices else 0
        savings_per_kwh = consumer_peak - consumer_low
        alerts.append({
            "session_id": session_id,
            "grid_region": grid_region,
            "severity": "optimization",
            "title": f"Shift Loads — Save ${savings_per_kwh * 30:.2f} on 30 kWh",
            "description": (
                f"Peak retail: ${consumer_peak:.3f}/kWh vs valley: ${consumer_low:.3f}/kWh. "
                f"Defer EV charging and heavy appliances to off-peak hours."
            ),
            "alert_type": "device_savings",
            "metadata": {
                "consumer_peak_kwh": round(consumer_peak, 4),
                "consumer_low_kwh": round(consumer_low, 4),
            },
        })

    # 5e. Load shed warning
    if cascade_result["total_load_shed_mw"] > 500:
        alerts.append({
            "session_id": session_id,
            "grid_region": grid_region,
            "severity": "warning",
            "title": f"Load Shed Warning — {cascade_result['total_load_shed_mw']:.0f} MW",
            "description": (
                f"Significant load shedding of {cascade_result['total_load_shed_mw']:.0f} MW "
                f"detected. Rolling blackouts may affect your area. "
                f"Ensure battery reserves are charged."
            ),
            "alert_type": "load_shed",
            "metadata": {
                "total_load_shed_mw": cascade_result["total_load_shed_mw"],
            },
        })

    # Enhance alert text with Claude (falls back to originals on error)
    alerts = enhance_alerts(alerts)

    _insert_alerts(alerts)

    # Broadcast weather alerts via ntfy push notifications
    weather_alerts = [a for a in alerts if a.get("alert_type", "").startswith("weather_")]
    if weather_alerts:
        try:
            notification_result = asyncio.run(broadcast_weather_alerts(weather_alerts))
            logger.info(
                "Orchestrator: sent %d weather notifications (%d failed)",
                notification_result.get("success", 0),
                notification_result.get("failed", 0),
            )
        except Exception as exc:
            logger.error("Failed to broadcast weather alerts: %s", exc)

    _update_session(session_id, {
        "status": "alerts_done",
        "alerts_generated": len(alerts),
    })
    logger.info("Orchestrator: %d alerts generated", len(alerts))

    # ── 6. Crew dispatch ─────────────────────────────────────────
    crews_dispatched = 0
    avg_eta = 0.0

    if cascade_result["total_failed_nodes"] > 0:
        dispatch_reset(storm=(scenario in ("uri", "uri_2021")))

        crew_roster = get_crews(scenario=scenario)
        load_crews(crew_roster.crews)

        graph_nodes = {
            nid: dict(grid_graph.graph.nodes[nid])
            for nid in grid_graph.graph.nodes
        }
        load_failed_nodes(cascade_result, graph_nodes)

        recommendation = recommend_dispatch()
        confirmed = dispatch_all(recommendation)

        crews_dispatched = len(confirmed)
        avg_eta = recommendation.avg_eta_minutes

    _update_session(session_id, {
        "status": "completed",
        "crews_dispatched": crews_dispatched,
        "avg_eta_minutes": round(avg_eta, 1),
        "completed_at": datetime.now(timezone.utc).isoformat(),
    })
    logger.info(
        "Orchestrator: completed — %d crews dispatched, avg ETA %.1f min",
        crews_dispatched, avg_eta,
    )

    return {
        "session_id": session_id,
        "scenario": scenario,
        "grid_region": grid_region,
        "status": "completed",
        "total_failed_nodes": cascade_result["total_failed_nodes"],
        "cascade_depth": cascade_result["cascade_depth"],
        "total_load_shed_mw": cascade_result["total_load_shed_mw"],
        "peak_price_mwh": round(peak_price, 2),
        "avg_price_mwh": round(avg_price, 2),
        "alerts_generated": len(alerts),
        "crews_dispatched": crews_dispatched,
        "avg_eta_minutes": round(avg_eta, 1),
    }
