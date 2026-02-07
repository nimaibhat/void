from typing import List

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Blackout API"
    app_version: str = "0.1.0"
    debug: bool = False

    # CORS
    cors_origins: List[str] = ["http://localhost:3000", "http://localhost:5173"]

    # External APIs
    earth2_api_key: str = ""
    earth2_base_url: str = "https://api.earth2.example.com"

    # Database (for future use)
    database_url: str = "sqlite+aiosqlite:///./blackout.db"

    # ISO / grid data providers
    iso_api_key: str = ""

    # SFNO weather model
    weather_cache_dir: str = "./cache/weather"

    # Next.js mock data APIs (historical demand, wholesale prices)
    # When set, backend can proxy to these instead of real EIA/ERCOT/CAISO/PJM.
    next_mock_api_base: str = "http://localhost:3000"

    # Supabase (grid data, ERCOT load, crews, etc.)
    supabase_url: str = ""
    supabase_anon_key: str = ""

    model_config = {"env_file": ["../.env", ".env"], "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
