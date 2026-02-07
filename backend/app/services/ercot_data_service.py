"""ERCOT Load Data Service — parses Native_Load_2021.xlsx for actual
hourly load by weather zone.

Provides historical ERCOT load data for the Winter Storm Uri period
(Feb 14-16, 2021) and normal baseline days.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from pathlib import Path
from typing import Dict, Tuple

import openpyxl

from app.config import settings

logger = logging.getLogger("blackout.ercot_data")

# Column name mapping from ERCOT xlsx to our weather zone names
_COL_TO_ZONE: Dict[str, str] = {
    "COAST": "Coast",
    "EAST": "East",
    "FWEST": "Far West",
    "FAR_WEST": "Far West",
    "NORTH": "North",
    "NCENT": "North Central",
    "NORTH_C": "North Central",
    "SOUTH": "Southern",
    "SOUTHERN": "Southern",
    "SCENT": "South Central",
    "SOUTH_C": "South Central",
    "WEST": "West",
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
        """Parse the ERCOT Native Load xlsx file.

        Format: "Hour Ending" column has combined datetime (e.g. "01/01/2021 01:00"),
        followed by zone columns (COAST, EAST, FWEST, NORTH, NCENT, SOUTH, SCENT, WEST, ERCOT).
        """
        xlsx_path = Path(settings.ercot_load_file)
        if not xlsx_path.exists():
            logger.warning("ERCOT load file not found: %s", xlsx_path)
            return

        logger.info("Loading ERCOT load data from %s", xlsx_path)
        wb = openpyxl.load_workbook(str(xlsx_path), read_only=True, data_only=True)
        ws = wb.active

        # Read header row
        rows = ws.iter_rows()
        header_row = next(rows)
        headers = [str(cell.value).strip() if cell.value else "" for cell in header_row]

        # Find the "Hour Ending" column (combined date+hour)
        hour_ending_col = None
        zone_cols: Dict[int, str] = {}

        for i, h in enumerate(headers):
            h_upper = h.upper().replace(" ", "_")
            if h_upper in ("HOUR_ENDING", "HOURENDING"):
                hour_ending_col = i
            else:
                for col_key, zone_name in _COL_TO_ZONE.items():
                    if h_upper == col_key:
                        zone_cols[i] = zone_name
                        break

        if hour_ending_col is None:
            logger.error("Could not find 'Hour Ending' column. Headers: %s", headers)
            wb.close()
            return

        logger.info("Found %d zone columns: %s", len(zone_cols),
                     {headers[i]: z for i, z in zone_cols.items()})

        count = 0
        for row in rows:
            try:
                he_val = row[hour_ending_col].value
                if he_val is None:
                    continue

                # Parse combined datetime from "Hour Ending" column
                if isinstance(he_val, datetime):
                    dt = he_val
                elif isinstance(he_val, str):
                    # Format: "MM/DD/YYYY HH:MM"
                    he_val = he_val.strip()
                    dt = datetime.strptime(he_val, "%m/%d/%Y %H:%M")
                else:
                    continue

                d = dt.date()
                # Hour Ending: 01:00 means hour 0 (midnight-1am), 24:00 means hour 23
                hour = dt.hour
                if hour == 0:
                    # "24:00" would parse as next day 00:00, adjust back
                    hour = 23
                else:
                    hour = hour - 1

                # Read zone loads
                zone_loads: Dict[str, float] = {}
                for col_idx, zone_name in zone_cols.items():
                    val = row[col_idx].value
                    if val is not None:
                        zone_loads[zone_name] = float(val)

                self._data[(d, hour)] = zone_loads
                count += 1

            except (ValueError, TypeError, IndexError):
                continue

        wb.close()
        self.loaded = True
        logger.info("Loaded %d hourly ERCOT load records", count)

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
