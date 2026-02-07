"""ERCOT Load Data Service — reads hourly load by weather zone from
Supabase ``ercot_load`` table (43 818 rows, 8 zones, 2021-2025).

Provides historical ERCOT load data for the Winter Storm Uri period
(Feb 14-16, 2021) and normal baseline days.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Dict, Tuple

import requests

from app.config import settings

logger = logging.getLogger("blackout.ercot_data")

# Supabase column → ERCOT weather zone name
_SUPABASE_COL_TO_ZONE: Dict[str, str] = {
    "coast": "Coast",
    "east": "East",
    "far_west": "Far West",
    "north": "North",
    "north_central": "North Central",
    "south": "Southern",
    "south_central": "South Central",
    "west": "West",
}

# Normal baseline date
NORMAL_BASELINE = date(2021, 2, 1)


class ErcotDataService:
    """Loads and serves ERCOT hourly load data by weather zone."""

    def __init__(self) -> None:
        # {(date, hour): {"Coast": mw, "East": mw, ...}}
        self._data: Dict[Tuple[date, int], Dict[str, float]] = {}
        self.loaded = False

    def load(self) -> None:
        """Fetch ERCOT hourly load data from the Supabase ``ercot_load`` table."""
        url = settings.supabase_url
        key = settings.supabase_anon_key
        if not url or not key:
            logger.warning("Supabase not configured — skipping ERCOT load")
            return

        zone_cols = ",".join(_SUPABASE_COL_TO_ZONE.keys())
        select = f"year,month,day,hour,{zone_cols}"
        headers = {"apikey": key, "Authorization": f"Bearer {key}"}

        # Paginate — PostgREST default limit is 1000
        page_size = 5000
        offset = 0
        count = 0

        logger.info("Loading ERCOT load data from Supabase ercot_load table…")

        while True:
            api_url = (
                f"{url}/rest/v1/ercot_load"
                f"?select={select}&order=id&limit={page_size}&offset={offset}"
            )
            resp = requests.get(api_url, headers=headers, timeout=30)
            if not resp.ok:
                logger.error("Supabase ercot_load fetch failed (%s): %s", resp.status_code, resp.text[:200])
                break

            rows = resp.json()
            if not rows:
                break

            for row in rows:
                try:
                    d = date(int(row["year"]), int(row["month"]), int(row["day"]))
                    hour = int(row["hour"])
                    zone_loads: Dict[str, float] = {}
                    for col, zone_name in _SUPABASE_COL_TO_ZONE.items():
                        val = row.get(col)
                        if val is not None:
                            zone_loads[zone_name] = float(val)
                    self._data[(d, hour)] = zone_loads
                    count += 1
                except (ValueError, TypeError, KeyError):
                    continue

            offset += page_size
            if len(rows) < page_size:
                break

        self.loaded = count > 0
        logger.info("Loaded %d hourly ERCOT load records from Supabase", count)

    def get_zone_loads(self, target_date: date, hour: int) -> Dict[str, float]:
        """Get load per ERCOT weather zone for a specific date and hour.

        Returns {zone_name: load_mw}.
        """
        key = (target_date, hour % 24)
        loads = self._data.get(key)
        if loads:
            return dict(loads)

        # If exact hour not found, try nearest hour on same day
        for h_offset in range(1, 4):
            for h in [hour + h_offset, hour - h_offset]:
                key = (target_date, h % 24)
                if key in self._data:
                    return dict(self._data[key])

        return {}

    def get_scenario_loads(self, scenario: str, forecast_hour: int) -> Dict[str, float]:
        """Get zone loads for a named scenario.

        For "uri": returns Feb 14-16 2021 data at the appropriate hour offset.
            forecast_hour 0 = Feb 14 00:00, hour 36 = Feb 15 12:00 (peak crisis).
        For "normal": returns Feb 1 2021 baseline.
        """
        if scenario in ("uri", "uri_2021"):
            day_offset = forecast_hour // 24
            hour = forecast_hour % 24
            target = date(2021, 2, 14 + day_offset)
            return self.get_zone_loads(target, hour)
        else:
            hour = forecast_hour % 24
            return self.get_zone_loads(NORMAL_BASELINE, hour)

    def get_total_load(self, scenario: str, forecast_hour: int) -> float:
        """Get total ERCOT load for a scenario."""
        loads = self.get_scenario_loads(scenario, forecast_hour)
        return sum(loads.values())


# Module-level singleton
ercot_data = ErcotDataService()
