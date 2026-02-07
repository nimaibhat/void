# Blackout API

FastAPI backend for grid forecasting, cascade simulation, and consumer energy intelligence.

## Quick Start

```bash
# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate   # Linux/macOS
# .venv\Scripts\activate    # Windows

# Install dependencies
pip install -r requirements.txt

# Copy environment config
cp .env.example .env

# Run the server
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`.

## API Documentation

Once the server is running, interactive docs are available at:

- **Swagger UI** — [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc** — [http://localhost:8000/redoc](http://localhost:8000/redoc)

## Architecture

```
api/
├── main.py                  # FastAPI entry point, middleware, exception handlers
├── requirements.txt
├── .env.example
├── app/
│   ├── config.py            # Pydantic BaseSettings — reads .env
│   ├── routers/             # HTTP routing only — no business logic
│   │   ├── forecast.py      # /api/forecast/*
│   │   ├── grid.py          # /api/grid/*
│   │   ├── simulate.py      # /api/simulate/*
│   │   ├── consumer.py      # /api/consumer/*
│   │   └── utility.py       # /api/utility/*
│   ├── models/              # Pydantic request/response models per domain
│   │   ├── forecast.py
│   │   ├── grid.py
│   │   ├── simulate.py
│   │   ├── consumer.py
│   │   └── utility.py
│   ├── services/            # Business logic stubs (replace TODOs)
│   │   ├── forecast_service.py
│   │   ├── grid_service.py
│   │   ├── simulate_service.py
│   │   ├── consumer_service.py
│   │   └── utility_service.py
│   └── schemas/
│       └── responses.py     # SuccessResponse / ErrorResponse envelopes
```

### Separation of Concerns

| Layer | Responsibility |
|-------|---------------|
| **Routers** | HTTP routing, request validation, calling services, returning responses |
| **Services** | All business logic — swap out stub data for real implementations |
| **Models** | Pydantic schemas for request/response validation and serialization |
| **Schemas** | Shared response envelopes (`SuccessResponse`, `ErrorResponse`) |

### Adding Business Logic

1. Open the relevant service file (e.g., `app/services/forecast_service.py`)
2. Find the `# TODO` comment in the function you want to implement
3. Replace the placeholder data with your actual logic
4. The endpoint works immediately — no changes needed in the router layer

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/forecast/weather` | Earth-2 weather prediction for a region |
| GET | `/api/forecast/prices` | Wholesale price forecast by ISO |
| GET | `/api/grid/status` | Current grid stress levels nationally |
| POST | `/api/simulate/cascade` | Run cascade failure simulation |
| GET | `/api/consumer/recommendations` | Personalized household actions |
| GET | `/api/consumer/profiles` | List consumer profiles |
| POST | `/api/consumer/profiles/custom` | Create custom consumer profile |
| GET | `/api/utility/crew-optimization` | Optimal crew positioning by region |
| GET | `/health` | Health check |
