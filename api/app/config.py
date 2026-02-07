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

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
