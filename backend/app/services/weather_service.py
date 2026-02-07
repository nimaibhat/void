"""SFNO Weather Forecasting Service — powered by NVIDIA Earth2Studio.

Loads the SFNO (Spherical Fourier Neural Operator) model once on startup,
runs 48-hour deterministic forecasts on a 0.25-degree global grid, and
extracts US-region grids and city-level point forecasts.

Grid: 721 lat x 1440 lon, 0.25-degree equirectangular.
Time step: 6 hours.  Default run: 8 steps = 48 hours.
Data sources: ARCO (ERA5 reanalysis) for historical, GFS for recent.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger("blackout.weather")


# ── Custom exceptions ───────────────────────────────────────────────


class ModelNotLoadedError(Exception):
    """SFNO model has not been loaded (or failed to load)."""


class DataFetchError(Exception):
    """Failed to fetch initial-condition data from ARCO/GFS."""


class GPUOutOfMemoryError(Exception):
    """GPU ran out of VRAM during inference."""

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


# ── US region bounds ────────────────────────────────────────────────
# SFNO uses 0-360 longitude convention (ERA5).
# US CONUS: lat 24-50 N, lon 235-294 E  (= -125 to -66 W).

US_LAT_MIN, US_LAT_MAX = 24.0, 50.0
US_LON_MIN_360, US_LON_MAX_360 = 235.0, 294.0

# Variables to extract from SFNO output.
# Maps our internal key -> list of possible names in the zarr output.
_VAR_ALIASES: Dict[str, List[str]] = {
    "t2m": ["t2m", "2t", "2m_temperature"],
    "u10m": ["u10m", "u10", "10u", "10m_u_component_of_wind"],
    "v10m": ["v10m", "v10", "10v", "10m_v_component_of_wind"],
    "msl": ["msl", "mean_sea_level_pressure", "sp"],
    "tcwv": ["tcwv", "total_column_water_vapour", "total_column_water_vapor"],
}


# ── Unit conversions ────────────────────────────────────────────────


def _kelvin_to_f(k: np.ndarray) -> np.ndarray:
    return (k - 273.15) * 9.0 / 5.0 + 32.0


def _ms_to_mph(ms: np.ndarray) -> np.ndarray:
    return ms * 2.23694


def _pa_to_hpa(pa: np.ndarray) -> np.ndarray:
    return pa / 100.0


def _wind_direction_deg(u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Meteorological wind direction (direction wind blows FROM), degrees."""
    return (np.degrees(np.arctan2(-u, -v)) + 360.0) % 360.0


# ════════════════════════════════════════════════════════════════════
#  WeatherService
# ════════════════════════════════════════════════════════════════════


class WeatherService:
    """Singleton service wrapping SFNO model inference and caching.

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
        self._gpu_name: str = "N/A"

    # ── Model lifecycle ─────────────────────────────────────────────

    async def load_model(self) -> None:
        """Load SFNO model onto GPU.  Called once during FastAPI lifespan."""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._load_model_sync)

    def _load_model_sync(self) -> None:
        try:
            import torch
            from earth2studio.models.px import SFNO

            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            logger.info("Loading SFNO model on %s …", device)

            if torch.cuda.is_available():
                self._gpu_name = torch.cuda.get_device_name(0)
                props = torch.cuda.get_device_properties(0)
                vram_gb = props.total_mem / (1024**3)
                logger.info("GPU: %s  |  VRAM: %.1f GB", self._gpu_name, vram_gb)

            package = SFNO.load_default_package()
            self.model = SFNO.load_model(package)
            self.model_loaded = True

            if torch.cuda.is_available():
                used_gb = torch.cuda.memory_allocated(0) / (1024**3)
                logger.info("SFNO loaded.  VRAM used: %.2f GB", used_gb)
            else:
                logger.info("SFNO loaded (CPU mode — inference will be slow).")

        except Exception as exc:
            self.load_error = str(exc)
            logger.error("Failed to load SFNO model: %s", exc)

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
        """Run SFNO inference.  Returns processed forecast dict.

        Raises
        ------
        ModelNotLoadedError  – if the model was never loaded.
        DataFetchError       – if ARCO/GFS data fetch fails.
        GPUOutOfMemoryError  – if the GPU runs out of VRAM.
        """
        cache_key = self._cache_key(start_time)

        if not force:
            cached = self._load_from_cache(cache_key)
            if cached is not None:
                return cached

        if not self.model_loaded:
            raise ModelNotLoadedError(
                self.load_error or "SFNO model is not loaded"
            )

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, self._run_inference_sync, start_time, steps
        )

        self._save_to_cache(cache_key, result)
        return result

    async def get_city_forecasts(
        self,
        start_time: datetime,
    ) -> Dict[str, Any]:
        """Get city-level point forecasts (runs grid forecast if needed)."""
        forecast = await self.get_forecast(start_time)
        return self._extract_cities(forecast)

    def get_status(self) -> Dict[str, Any]:
        """Return model / GPU / cache status info."""
        vram_used = 0.0
        try:
            import torch

            if torch.cuda.is_available():
                vram_used = torch.cuda.memory_allocated(0) / (1024**3)
        except ImportError:
            pass

        cached = sorted(p.stem for p in self.cache_dir.glob("*.json"))
        return {
            "model_loaded": self.model_loaded,
            "gpu_name": self._gpu_name,
            "cached_scenarios": cached,
            "vram_used_gb": round(vram_used, 2),
        }

    # ── Inference (blocking — runs inside thread executor) ──────────

    def _run_inference_sync(
        self, start_time: datetime, steps: int
    ) -> Dict[str, Any]:
        import torch

        try:
            from earth2studio.data import ARCO, GFS
            from earth2studio.io import ZarrBackend
            from earth2studio.run import deterministic
        except ImportError as exc:
            raise ModelNotLoadedError(
                f"earth2studio is not installed: {exc}"
            ) from exc

        # ARCO for historical (ERA5 reanalysis); GFS for recent/real-time.
        # ERA5 typically available through ~18 months ago; ARCO mirrors it.
        cutoff = datetime(2023, 6, 1, tzinfo=timezone.utc)
        st = (
            start_time
            if start_time.tzinfo
            else start_time.replace(tzinfo=timezone.utc)
        )
        source_name = "ARCO/ERA5" if st < cutoff else "GFS"
        logger.info(
            "SFNO inference: start=%s  steps=%d  source=%s",
            start_time.isoformat(),
            steps,
            source_name,
        )

        try:
            data_source = ARCO() if st < cutoff else GFS()
        except Exception as exc:
            raise DataFetchError(
                f"Failed to initialise {source_name} data source: {exc}"
            ) from exc

        time_str = start_time.strftime("%Y-%m-%dT%H:%M:%S")

        try:
            io = deterministic(
                time=[time_str],
                nsteps=steps,
                prognostic=self.model,
                data=data_source,
                output=ZarrBackend(),
            )
        except torch.cuda.OutOfMemoryError as exc:
            vram = torch.cuda.memory_allocated(0) / (1024**3)
            raise GPUOutOfMemoryError(str(exc), vram_used_gb=vram) from exc
        except (ConnectionError, TimeoutError, OSError) as exc:
            raise DataFetchError(
                f"Network error fetching initial conditions: {exc}"
            ) from exc

        # ── Extract arrays from ZarrBackend ─────────────────────────
        try:
            root = io.root
        except AttributeError:
            root = io  # fallback for older earth2studio versions

        available_keys = list(root.keys())
        lats = np.array(root["lat"])  # (721,)  90 → -90
        lons = np.array(root["lon"])  # (1440,) 0 → 359.75

        # Resolve variable names (canonical → whatever the output uses)
        var_map: Dict[str, str] = {}
        for target, aliases in _VAR_ALIASES.items():
            for alias in aliases:
                if alias in available_keys:
                    var_map[target] = alias
                    break
            else:
                logger.warning(
                    "Variable %s not in output.  Available: %s",
                    target,
                    available_keys,
                )

        # Load arrays — drop batch dim → (n_steps+1, 721, 1440)
        raw: Dict[str, np.ndarray] = {}
        for key, zarr_name in var_map.items():
            arr = np.array(root[zarr_name])
            if arr.ndim == 4:
                arr = arr[0]  # drop batch dim
            raw[key] = arr

        # ── Slice US region ─────────────────────────────────────────
        lat_mask = (lats >= US_LAT_MIN) & (lats <= US_LAT_MAX)
        lon_mask = (lons >= US_LON_MIN_360) & (lons <= US_LON_MAX_360)
        lat_idx = np.where(lat_mask)[0]
        lon_idx = np.where(lon_mask)[0]

        us_lats = lats[lat_idx]
        us_lons = lons[lon_idx]
        # Convert 0-360 → -180..180 for frontend consumption.
        us_lons_180 = np.where(us_lons > 180, us_lons - 360, us_lons)

        n_total = next(iter(raw.values())).shape[0] if raw else steps + 1

        timesteps: List[Dict[str, Any]] = []
        for s in range(n_total):
            hour = s * 6
            ts = start_time + timedelta(hours=hour)

            # Slice each variable to the US region.
            us: Dict[str, np.ndarray] = {}
            for key in raw:
                us[key] = raw[key][s][np.ix_(lat_idx, lon_idx)]

            t2m = us.get("t2m")
            u = us.get("u10m")
            v = us.get("v10m")
            msl = us.get("msl")

            # Convert units.
            temp_f = (
                np.round(_kelvin_to_f(t2m), 1) if t2m is not None else np.array([[]])
            )
            wind_speed = (
                np.round(_ms_to_mph(np.sqrt(u**2 + v**2)), 1)
                if u is not None and v is not None
                else np.array([[]])
            )
            wind_dir = (
                np.round(_wind_direction_deg(u, v), 1)
                if u is not None and v is not None
                else np.array([[]])
            )
            pressure = (
                np.round(_pa_to_hpa(msl), 1) if msl is not None else np.array([[]])
            )

            timesteps.append(
                {
                    "step": s,
                    "hour": hour,
                    "timestamp": ts.isoformat(),
                    "temperature_f": temp_f.tolist(),
                    "wind_mph": wind_speed.tolist(),
                    "wind_dir_deg": wind_dir.tolist(),
                    "pressure_hpa": pressure.tolist(),
                    "grid_bounds": {
                        "lat_min": float(us_lats.min()),
                        "lat_max": float(us_lats.max()),
                        "lon_min": float(us_lons_180.min()),
                        "lon_max": float(us_lons_180.max()),
                    },
                }
            )

        result = {
            "model": "earth2studio-sfno",
            "start_time": start_time.isoformat(),
            "region": "us",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "us_lats": us_lats.tolist(),
            "us_lons": us_lons_180.tolist(),
            "steps": timesteps,
        }

        logger.info(
            "Inference complete: %d timesteps, grid %dx%d",
            len(timesteps),
            len(us_lats),
            len(us_lons),
        )
        return result

    # ── City extraction ─────────────────────────────────────────────

    def _extract_cities(self, forecast: Dict[str, Any]) -> Dict[str, Any]:
        """Extract city-level point forecasts from a full grid forecast."""
        us_lats = np.array(forecast["us_lats"])
        us_lons = np.array(forecast["us_lons"])

        cities_out: Dict[str, Any] = {}
        for city_name, (lat, lon) in CITIES.items():
            lat_idx = int(np.argmin(np.abs(us_lats - lat)))
            lon_idx = int(np.argmin(np.abs(us_lons - lon)))

            hourly: List[Dict[str, Any]] = []
            for step in forecast["steps"]:
                temp_grid = step["temperature_f"]
                wind_grid = step["wind_mph"]
                wdir_grid = step["wind_dir_deg"]
                pres_grid = step["pressure_hpa"]

                # Guard against empty grids from missing variables.
                def _pick(grid: Any, li: int, lo: int) -> float:
                    try:
                        return float(grid[li][lo])
                    except (IndexError, TypeError):
                        return 0.0

                hourly.append(
                    {
                        "hour": step["hour"],
                        "timestamp": step["timestamp"],
                        "temp_f": _pick(temp_grid, lat_idx, lon_idx),
                        "wind_mph": _pick(wind_grid, lat_idx, lon_idx),
                        "wind_dir_deg": _pick(wdir_grid, lat_idx, lon_idx),
                        "pressure_hpa": _pick(pres_grid, lat_idx, lon_idx),
                    }
                )

            cities_out[city_name] = {
                "lat": lat,
                "lon": lon,
                "hourly": hourly,
            }

        return {
            "model": forecast["model"],
            "start_time": forecast["start_time"],
            "generated_at": forecast["generated_at"],
            "cities": cities_out,
        }

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
