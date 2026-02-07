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

    # ACTIVSg2000 grid data
    activsg_case_file: str = "app/data/activsg2000/case_ACTIVSg2000.m"
    activsg_aux_file: str = "app/data/activsg2000/ACTIVSg2000.aux"

    # Travis 150 grid data (Travis County overlay)
    travis150_aux_file: str = "app/data/travis150/Travis150_Electric_Data.aux"

    # ERCOT load data
    ercot_load_file: str = "app/data/ercot/Native_Load_2021.xlsx"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
