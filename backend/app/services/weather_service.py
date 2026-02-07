"""Weather Forecasting Service — powered by Open-Meteo API.

Fetches hourly weather forecasts from the free Open-Meteo API.
No GPU, no heavy ML dependencies — just HTTP calls.

Grid: sparse ~25-point grid over Texas/ERCOT region.
City: 7 hardcoded US cities with exact lat/lon lookups.
Time step: 6 hours.  Default run: 8 steps = 48 hours.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger("blackout.weather")

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


# ── Custom exceptions ───────────────────────────────────────────────


class ModelNotLoadedError(Exception):
    """Weather service has not been initialized."""


class DataFetchError(Exception):
    """Failed to fetch data from Open-Meteo API."""


class GPUOutOfMemoryError(Exception):
    """Kept for interface compatibility — never raised with Open-Meteo."""

    def __init__(self, message: str, vram_used_gb: float = 0.0):
        super().__init__(message)
        self.vram_used_gb = vram_used_gb


# ── City extraction points ──────────────────────────────────────────

CITIES: Dict[str, Tuple[float, float]] = {
    "Austin, TX": (30.27, -97.74),
    "Houston, TX": (29.76, -95.37),
    "Dallas, TX": (32.78, -96.80),
    "San Antonio, TX": (29.42, -98.49),
    "Los Angeles, CA": (34.05, -118.24),
    "New York, NY": (40.71, -74.01),
    "Chicago, IL": (41.88, -87.63),
}

# Normalized lookup: "austintx" -> "Austin, TX"
_CITY_LOOKUP: Dict[str, str] = {
    name.lower().replace(" ", "").replace(",", ""): name for name in CITIES
}


def resolve_city_name(raw: str) -> Optional[str]:
    """Flexibly resolve a city name from URL path segments.

    Accepts: "Austin, TX", "austin-tx", "austin_tx", "austintx", etc.
    """
    normalized = raw.lower().replace(" ", "").replace(",", "").replace("-", "").replace("_", "")
    return _CITY_LOOKUP.get(normalized)


# ── Texas / ERCOT region grid points ────────────────────────────────
# Sparse grid covering Texas: lat 25.5–36.5 N, lon -106.5 – -93.5 W
# Step ~2.75 degrees → 5 lat x 5 lon = 25 points

_TX_LAT_MIN, _TX_LAT_MAX = 25.5, 36.5
_TX_LON_MIN, _TX_LON_MAX = -106.5, -93.5
_GRID_STEPS = 5  # 5x5 grid


def _build_grid_points() -> List[Tuple[float, float]]:
    """Return a list of (lat, lon) for the sparse Texas grid."""
    lat_step = (_TX_LAT_MAX - _TX_LAT_MIN) / (_GRID_STEPS - 1)
    lon_step = (_TX_LON_MAX - _TX_LON_MIN) / (_GRID_STEPS - 1)
    points = []
    for i in range(_GRID_STEPS):
        for j in range(_GRID_STEPS):
            lat = round(_TX_LAT_MIN + i * lat_step, 2)
            lon = round(_TX_LON_MIN + j * lon_step, 2)
            points.append((lat, lon))
    return points


GRID_POINTS = _build_grid_points()
GRID_LATS = sorted(set(p[0] for p in GRID_POINTS), reverse=True)  # N → S
GRID_LONS = sorted(set(p[1] for p in GRID_POINTS))  # W → E


# ── Open-Meteo fetcher ──────────────────────────────────────────────


async def _fetch_open_meteo(
    client: httpx.AsyncClient,
    lat: float,
    lon: float,
    hours: int = 48,
) -> Dict[str, Any]:
    """Fetch hourly forecast for a single lat/lon point."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "temperature_2m,wind_speed_10m,wind_direction_10m,surface_pressure",
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "forecast_hours": hours,
    }
    resp = await client.get(OPEN_METEO_URL, params=params)
    resp.raise_for_status()
    return resp.json()


# ════════════════════════════════════════════════════════════════════
#  WeatherService
# ════════════════════════════════════════════════════════════════════


class WeatherService:
    """Singleton service wrapping Open-Meteo API calls and caching.

    Usage
    -----
    1. Call ``await weather_service.load_model()`` once at app startup.
    2. Use ``get_forecast`` / ``get_city_forecasts`` from route handlers.
    """

    def __init__(self, cache_dir: str = "./cache/weather") -> None:
        self.model: Any = None
        self.model_loaded: bool = False
        self.load_error: Optional[str] = None
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._gpu_name: str = "N/A (Open-Meteo API)"

    # ── Model lifecycle ─────────────────────────────────────────────

    async def load_model(self) -> None:
        """No-op — Open-Meteo needs no model loading."""
        self.model_loaded = True
        logger.info("Weather service ready (Open-Meteo API — no model to load)")

    # ── Public API ──────────────────────────────────────────────────

    async def get_forecast(
        self,
        start_time: datetime,
        region: str = "us",
    ) -> Dict[str, Any]:
        """Return grid forecast, checking cache first."""
        cache_key = self._cache_key(start_time)
        cached = self._load_from_cache(cache_key)
        if cached is not None:
            return cached
        return await self.run_forecast(start_time)

    async def run_forecast(
        self,
        start_time: datetime,
        steps: int = 8,
        force: bool = False,
    ) -> Dict[str, Any]:
        """Fetch grid forecast from Open-Meteo.

        Raises
        ------
        ModelNotLoadedError  – if load_model() was never called.
        DataFetchError       – if Open-Meteo API calls fail.
        """
        cache_key = self._cache_key(start_time)

        if not force:
            cached = self._load_from_cache(cache_key)
            if cached is not None:
                return cached

        if not self.model_loaded:
            raise ModelNotLoadedError(
                self.load_error or "Weather service is not initialized"
            )

        result = await self._fetch_grid_forecast(start_time, steps)
        self._save_to_cache(cache_key, result)
        return result

    async def get_city_forecasts(
        self,
        start_time: datetime,
    ) -> Dict[str, Any]:
        """Get city-level point forecasts directly from Open-Meteo."""
        if not self.model_loaded:
            raise ModelNotLoadedError("Weather service is not initialized")

        cache_key = self._cache_key(start_time) + "_cities"
        cached = self._load_from_cache(cache_key)
        if cached is not None:
            return cached

        result = await self._fetch_city_forecasts(start_time)
        self._save_to_cache(cache_key, result)
        return result

    def get_status(self) -> Dict[str, Any]:
        """Return service / cache status info."""
        cached = sorted(p.stem for p in self.cache_dir.glob("*.json"))
        return {
            "model_loaded": self.model_loaded,
            "gpu_name": self._gpu_name,
            "cached_scenarios": cached,
            "vram_used_gb": 0.0,
        }

    # ── Grid forecast (Open-Meteo) ──────────────────────────────────

    async def _fetch_grid_forecast(
        self, start_time: datetime, steps: int
    ) -> Dict[str, Any]:
        """Fetch forecast for the sparse Texas grid from Open-Meteo."""
        logger.info(
            "Fetching grid forecast from Open-Meteo: start=%s  steps=%d  points=%d",
            start_time.isoformat(),
            steps,
            len(GRID_POINTS),
        )

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                # Batch requests to avoid rate limiting (Open-Meteo allows ~10k/day)
                results = []
                batch_size = 5
                for i in range(0, len(GRID_POINTS), batch_size):
                    batch = GRID_POINTS[i : i + batch_size]
                    batch_tasks = [
                        _fetch_open_meteo(client, lat, lon, hours=steps * 6)
                        for lat, lon in batch
                    ]
                    batch_results = await asyncio.gather(*batch_tasks)
                    results.extend(batch_results)
                    if i + batch_size < len(GRID_POINTS):
                        await asyncio.sleep(0.3)
        except httpx.HTTPStatusError as exc:
            raise DataFetchError(
                f"Open-Meteo API returned {exc.response.status_code}: {exc}"
            ) from exc
        except (httpx.HTTPError, Exception) as exc:
            raise DataFetchError(f"Open-Meteo API error: {exc}") from exc

        # Build a lookup: (lat, lon) -> response
        point_data: Dict[Tuple[float, float], Dict[str, Any]] = {}
        for (lat, lon), resp in zip(GRID_POINTS, results):
            point_data[(lat, lon)] = resp

        # Assemble into timestep grids matching the old SFNO format.
        # Each timestep has 2D arrays: [n_lats][n_lons]
        # We pick every 6th hour from the hourly data.
        n_lats = len(GRID_LATS)
        n_lons = len(GRID_LONS)

        # Determine how many 6-hour steps we have
        sample_hourly = results[0].get("hourly", {})
        total_hours = len(sample_hourly.get("time", []))
        n_steps = min(steps + 1, total_hours // 6 + 1)

        timesteps: List[Dict[str, Any]] = []
        for s in range(n_steps):
            hour = s * 6
            hour_idx = hour  # index into hourly arrays
            ts = start_time + timedelta(hours=hour)

            # Build 2D grids
            temp_grid: List[List[float]] = []
            wind_grid: List[List[float]] = []
            wdir_grid: List[List[float]] = []
            pres_grid: List[List[float]] = []

            for lat in GRID_LATS:
                temp_row: List[float] = []
                wind_row: List[float] = []
                wdir_row: List[float] = []
                pres_row: List[float] = []
                for lon in GRID_LONS:
                    hourly = point_data[(lat, lon)].get("hourly", {})
                    temps = hourly.get("temperature_2m", [])
                    winds = hourly.get("wind_speed_10m", [])
                    wdirs = hourly.get("wind_direction_10m", [])
                    press = hourly.get("surface_pressure", [])

                    idx = min(hour_idx, len(temps) - 1) if temps else 0

                    temp_row.append(round(temps[idx], 1) if idx < len(temps) else 0.0)
                    wind_row.append(round(winds[idx], 1) if idx < len(winds) else 0.0)
                    wdir_row.append(round(wdirs[idx], 1) if idx < len(wdirs) else 0.0)
                    pres_row.append(round(press[idx], 1) if idx < len(press) else 0.0)

                temp_grid.append(temp_row)
                wind_grid.append(wind_row)
                wdir_grid.append(wdir_row)
                pres_grid.append(pres_row)

            timesteps.append(
                {
                    "step": s,
                    "hour": hour,
                    "timestamp": ts.isoformat(),
                    "temperature_f": temp_grid,
                    "wind_mph": wind_grid,
                    "wind_dir_deg": wdir_grid,
                    "pressure_hpa": pres_grid,
                    "grid_bounds": {
                        "lat_min": float(GRID_LATS[-1]),
                        "lat_max": float(GRID_LATS[0]),
                        "lon_min": float(GRID_LONS[0]),
                        "lon_max": float(GRID_LONS[-1]),
                    },
                }
            )

        result = {
            "model": "open-meteo",
            "start_time": start_time.isoformat(),
            "region": "us",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "us_lats": GRID_LATS,
            "us_lons": GRID_LONS,
            "steps": timesteps,
        }

        logger.info(
            "Grid forecast complete: %d timesteps, grid %dx%d",
            len(timesteps),
            n_lats,
            n_lons,
        )
        return result

    # ── City forecasts (Open-Meteo) ─────────────────────────────────

    async def _fetch_city_forecasts(
        self, start_time: datetime
    ) -> Dict[str, Any]:
        """Fetch per-city hourly forecasts directly from Open-Meteo."""
        logger.info(
            "Fetching city forecasts from Open-Meteo for %d cities",
            len(CITIES),
        )

        city_names = list(CITIES.keys())
        coords = list(CITIES.values())

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                tasks = [
                    _fetch_open_meteo(client, lat, lon, hours=48)
                    for lat, lon in coords
                ]
                results = await asyncio.gather(*tasks)
        except (httpx.HTTPError, Exception) as exc:
            raise DataFetchError(f"Open-Meteo API error: {exc}") from exc

        cities_out: Dict[str, Any] = {}
        for name, (lat, lon), resp in zip(city_names, coords, results):
            hourly_data = resp.get("hourly", {})
            times = hourly_data.get("time", [])
            temps = hourly_data.get("temperature_2m", [])
            winds = hourly_data.get("wind_speed_10m", [])
            wdirs = hourly_data.get("wind_direction_10m", [])
            press = hourly_data.get("surface_pressure", [])

            # Build hourly list — every 6 hours to match original format
            hourly: List[Dict[str, Any]] = []
            for i in range(0, len(times), 6):
                hour = i
                ts = start_time + timedelta(hours=hour)
                hourly.append(
                    {
                        "hour": hour,
                        "timestamp": ts.isoformat(),
                        "temp_f": round(temps[i], 1) if i < len(temps) else 0.0,
                        "wind_mph": round(winds[i], 1) if i < len(winds) else 0.0,
                        "wind_dir_deg": round(wdirs[i], 1) if i < len(wdirs) else 0.0,
                        "pressure_hpa": round(press[i], 1) if i < len(press) else 0.0,
                    }
                )

            cities_out[name] = {
                "lat": lat,
                "lon": lon,
                "hourly": hourly,
            }

        result = {
            "model": "open-meteo",
            "start_time": start_time.isoformat(),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "cities": cities_out,
        }

        logger.info("City forecasts complete for %d cities", len(cities_out))
        return result

    # ── Caching ─────────────────────────────────────────────────────

    def _cache_key(self, start_time: datetime) -> str:
        return start_time.strftime("%Y%m%dT%H%M%S")

    def _load_from_cache(self, key: str) -> Optional[Dict[str, Any]]:
        path = self.cache_dir / f"{key}.json"
        if not path.exists():
            return None
        logger.info("Cache hit: %s", key)
        with open(path, "r") as f:
            return json.load(f)

    def _save_to_cache(self, key: str, data: Dict[str, Any]) -> None:
        path = self.cache_dir / f"{key}.json"
        with open(path, "w") as f:
            json.dump(data, f)
        logger.info("Cached forecast: %s", key)


# ── Module-level singleton ──────────────────────────────────────────

weather_service = WeatherService()
