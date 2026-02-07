# void

## Hackathon Tracks

### Best Financial Hack (Capital One)
Capital One's energy initiatives really appealed to us while building this. We wanted something that crosses both finance and sustainability, not just one or the other. On the consumer side, void forecasts wholesale electricity prices 48 hours out using an XGBoost model trained on 43,818 hours of real ERCOT load data, then acts on the citizen's behalf, automatically shifting EV charging, pre-cooling homes, and scheduling battery discharge so households get hands-off savings without thinking about it. On the operator side, the city view is focused on sustainability: grid operators see cascade risk in real time, dispatch repair crews, and manage load across 2,173 nodes to keep the grid stable. The end result is that peak load goes down and households save money. We think this could realistically be adopted by energy companies, local governments, or bundled into utility apps.

### Best Use of CodeRabbit
In the CodeRabbit tech talk we learned that you could customize the tone of code reviews to do pretty much anything, including roasting your teammates. We thought that was hilarious, so we ran with it. Our `.coderabbit.yaml` has CodeRabbit configured to review PRs like Gordon Ramsay in a kitchen nightmare. It calls bugs "raw chicken", clean code "a Michelin star", and bad PRs get the full Hell's Kitchen treatment. Beyond the comedy, we actually used CodeRabbit throughout the entire hackathon for real code reviews on every PR, catching type errors, missing RLS policies, and performance issues we would have missed at 3am. The combination of genuinely useful reviews delivered through an unhinged personality made us actually look forward to opening PR comments.

### Best Use of XRPL (Build an MVP that leverages the XRP Ledger's core features)
When a consumer follows a price alert and shifts their energy usage, the savings are real but small, often a few dollars. void uses the XRP Ledger to pay those savings out as RLUSD stablecoin directly to the household's wallet. The system creates Testnet wallets, sets up RLUSD trustlines, and sends micropayouts automatically when accumulated savings cross a threshold. XRPL's near-zero transaction fees make sub-dollar energy rebates actually viable, which is something traditional payment rails can't do without eating the entire payout in processing fees.

---

void is a full-stack grid intelligence platform that forecasts electricity prices, simulates cascade failures across the Texas power grid, dispatches repair crews, and gives consumers real-time alerts to shift their energy usage. It combines a 2,173-node synthetic grid model with historical ERCOT load data, live weather from Open-Meteo, and an XGBoost price prediction model trained on 43,818 hourly records.

Built for the scenario where Winter Storm Uri hits again and the grid needs to respond in real time.

## Table of Contents

- [Architecture](#architecture)
- [Pages](#pages)
- [Tech Stack](#tech-stack)
- [External APIs and Data Sources](#external-apis-and-data-sources)
- [ML Models](#ml-models)
- [Database Schema](#database-schema)
- [Setup](#setup)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)

## Architecture

```
User
  |
  v
Frontend (Next.js 16 + React 19)
  |  Landing Page, Consumer Dashboard, Operator Dashboard
  |  Cascade Overlay, react-globe.gl, Framer Motion, Price Alerts UI
  |
  | REST API (Next.js rewrites /api/backend/* -> localhost:8000/api/*)
  v
Backend (Python + FastAPI)
  |  Price Service (XGBoost), Grid Graph (NetworkX), Crew Dispatch
  |  Cascade Sim, Demand Service, ERCOT Data Service
  |
  | SQL / REST
  v
Supabase (PostgreSQL + Realtime)
  Grid & ERCOT Data (43k rows), Auth (RLS + Anon Key)

Side integrations:
  Open-Meteo API  -->  Backend (hourly forecast, zone weather)
  Backend  -->  ntfy.sh (push notifications)
  Backend  -->  Claude Haiku (alert text, weather events)
  Frontend -->  Supabase Realtime (live simulation updates)
  Frontend -->  XRPL Testnet (RLUSD reward payouts)
  Frontend -->  Enode API (smart device control)
```

## Pages

| Route | What it does |
|---|---|
| `/` | Landing page with a particle globe, operator/citizen entry panels, and scrolling tech marquees |
| `/dashboard` | Consumer view with readiness score, 48-hour price forecast chart, smart device alerts, and XRPL wallet |
| `/operator` | Operator dashboard with a 3D globe showing grid nodes, hotspots, arcs, crew markers, and cascade animation |
| `/devices` | Enode-linked device management for EV chargers, HVAC, batteries, and solar |
| `/simulation` | Interactive demand response scenario picker (price spike, heat wave, grid overload) |
| `/simulation/respond` | Consumer response interface for live simulation events |
| `/simulation/admin` | Admin panel for triggering grid events |

## Tech Stack

### Frontend
- Next.js 16 (App Router), React 19, TypeScript 5
- Tailwind CSS 4
- Framer Motion 12 for animations
- Three.js + React Three Fiber for the 3D globe
- Recharts for data visualization
- Supabase JS client for database and realtime subscriptions
- xrpl.js for XRP Ledger integration
- Geist Sans + Geist Mono fonts

### Backend
- Python 3.9+, FastAPI, Uvicorn
- Pydantic 2 for request/response validation
- NetworkX for grid graph operations
- XGBoost + scikit-learn for price prediction
- NumPy and Pandas for data processing
- httpx for async HTTP calls

## External APIs and Data Sources

### Open-Meteo (weather)
- **Forecast API** (`api.open-meteo.com/v1/forecast`): Hourly temperature, wind speed, wind direction, and surface pressure. Used to compute demand multipliers and zone-specific price adjustments.
- **Archive API** (`archive-api.open-meteo.com/v1/archive`): Historical weather for the Feb 2021 Uri storm period and normal baseline. Used in demand service scenario modeling.
- Free tier, no API key needed. Rate limited to ~10k requests/day. Backend batches 5 coordinate points per request with a 0.3s delay.

### Supabase (database + realtime)
- All grid topology, ERCOT load history, crew rosters, and consumer profiles are stored in Supabase PostgreSQL.
- Realtime subscriptions on `simulation_sessions` and `live_alerts` tables push live updates to the frontend during cascade simulations.
- RLS policies on all tables. The anon key provides read access; the publishable key is used on the frontend.

### Anthropic Claude API
- Model: `claude-haiku-4-5-20251001`
- Rewrites rule-generated alert text into context-aware language with ERCOT pricing details.
- Generates NWS-style weather event headlines for the operator timeline.
- Falls back to the original rule-based text if the API times out or errors.

### ntfy.sh (push notifications)
- Sends JSON push notifications to consumer devices when price alerts trigger or simulation events occur.
- No authentication required. Topic-based pub/sub.

### Enode API (smart device control)
- OAuth2 sandbox integration for linking consumer devices (EV chargers, HVAC, batteries, solar inverters).
- Supports device listing, status polling, and control actions (shift charging, HVAC mode changes).

### XRPL Testnet (blockchain rewards)
- Creates RLUSD wallets and trustlines for consumer households.
- Sends RLUSD payouts when accumulated energy savings hit a threshold.
- Multi-endpoint fallback with 15-second connection timeout.

### ERCOT Load Data
- 43,818 hourly demand records across 8 weather zones from 2021 to 2025.
- Sourced from public ERCOT data and stored in the `ercot_load` Supabase table.
- Used for training the price model and computing historical demand baselines.

### ACTIVSg2000 + Travis 150 Grid
- Synthetic 2,000-bus test case (ACTIVSg2000) representing the US grid, filtered to Texas.
- 173-bus Travis County model (Travis 150) for local detail.
- 3,517 transmission branches plus 3 synthetic tie lines connecting the two networks.
- All stored in Supabase (`grid_nodes`, `travis_nodes`, `grid_edges`).

## ML Models

### Price Prediction (`models/price_model.pkl`, 2 MB)
- **Algorithm**: sklearn Pipeline with StandardScaler and XGBRegressor
- **Training data**: 43,818 rows from Supabase `ercot_load` joined with Open-Meteo weather
- **Features** (16): temperature, wind speed, hour of day, day of week, month, weekend flag, heating/cooling degree hours, demand estimate, renewable generation %, grid utilization %, rolling 24h averages, temperature change, extreme weather flags
- **Performance**: Full R² = 0.9965, Cross-validation R² = 0.7776, Normal MAE = $2.59/MWh
- **Zone pricing**: 8 ERCOT zones with structural multipliers from 0.85 (Far West, wind-rich) to 1.08 (North Central, demand premium)

### Load Prediction (`models/load_model.pkl`, 268 MB)
- **Algorithm**: XGBoost regressor
- **Purpose**: Predict hourly ERCOT demand from 10 weather features
- **Used by**: Demand service for "live" scenario mode

### Training

```bash
# Price model
python3 scripts/train_price_model.py --data-source supabase --output-dir models

# Load model
python3 scripts/weather_to_load.py --train-only
```

Training produces the model pickle, metadata JSON, feature importance rankings, a text report, and an evaluation chart.

## Database Schema

All tables live in Supabase PostgreSQL with RLS enabled.

| Table | Rows | Description |
|---|---|---|
| `grid_nodes` | 2,000 | ACTIVSg2000 buses. Columns: id, bus_num, lat, lon, load_mw, capacity_mw, voltage_kv, zone, source |
| `travis_nodes` | 173 | Travis 150 buses. Same schema as grid_nodes |
| `grid_edges` | 3,517+ | Transmission branches. Columns: from_bus, to_bus, capacity_mva, impedance |
| `ercot_load` | 43,818 | Hourly demand by zone, 2021-2025. Columns: timestamp, zone, demand_mw |
| `crews` | 30 | Crew roster. Columns: crew_id, name, specialty, lat, lon, scenario |
| `consumer_profiles` | ~50 | User profiles with smart devices, zip code, weather zone |
| `simulation_sessions` | dynamic | Orchestrator pipeline progress. Realtime-enabled |
| `live_alerts` | dynamic | Generated alerts for consumers. Realtime-enabled |

## Setup

### Prerequisites
- Node.js 18+
- Python 3.9+
- A Supabase project with the tables listed above
- API keys for Anthropic (Claude) and optionally Mapbox

### 1. Clone the repo

```bash
git clone https://github.com/nimaibhat/blackout.git
cd blackout
```

### 2. Set up environment variables

Create a `.env` file in the project root:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=sb_publishable_...
SUPABASE_ANON_KEY=eyJhbGci...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-api03-...

# Mapbox (optional, for map features)
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1...
```

### 3. Install and run the frontend

```bash
npm install
npm run dev
```

Runs on [http://localhost:3000](http://localhost:3000).

### 4. Install and run the backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install scikit-learn xgboost

uvicorn main:app --reload
```

Runs on [http://localhost:8000](http://localhost:8000). Swagger docs at [http://localhost:8000/docs](http://localhost:8000/docs).

The backend reads `../.env` automatically for Supabase and Anthropic credentials.

On startup it fetches all grid nodes, edges, and ERCOT load data from Supabase, builds the NetworkX graph, and loads the price model from `models/price_model.pkl`.

### 5. Train the price model (optional)

If you need to retrain from scratch:

```bash
python3 scripts/train_price_model.py --data-source supabase --output-dir models
```

This pulls all ERCOT load data and matching weather from Open-Meteo, trains the XGBoost pipeline, and saves the model artifacts to `models/`.

## Environment Variables

| Variable | Used by | Required | Description |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Frontend | Yes | Supabase project URL |
| `SUPABASE_URL` | Backend | Yes | Supabase project URL (same value) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Frontend | Yes | Supabase publishable key for client-side access |
| `SUPABASE_ANON_KEY` | Backend | Yes | Supabase anon JWT for REST API access |
| `ANTHROPIC_API_KEY` | Both | Yes | Claude API key for alert enhancement and weather events |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Frontend | No | Mapbox token for map rendering |

## API Reference

### Price Forecast
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/forecast/prices/{region}` | 48-hour price forecast. Params: `mode` (ml/rules/hybrid), `scenario` (uri_2021/normal), `zone` (ERCOT zone) |
| GET | `/api/forecast/prices/model-info` | XGBoost model status, training date, R² score, feature list |

### Grid
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/grid/status` | Grid state with demand applied to all 2,173 nodes |
| GET | `/api/grid/topology` | Raw nodes and edges for the frontend globe |
| GET | `/api/grid/cascade-probability` | Cascade risk score per ISO region |
| GET | `/api/grid/nodes/{node_id}` | Single node detail |
| GET | `/api/grid/hotspots` | City-level severity markers |
| GET | `/api/grid/arcs` | Transmission line arcs between hotspots |

### Simulation
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/simulate/cascade` | Run cascade simulation (weather to demand to failure propagation) |
| POST | `/api/orchestrate/run` | Full pipeline: demand, cascade, price, alerts, crew dispatch |

### Consumer
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/consumer/recommendations/{profile_id}` | Optimized appliance schedule and savings |
| GET | `/api/consumer/savings/{profile_id}` | Savings summary |
| GET | `/api/consumer/profiles` | List all consumer profiles |
| POST | `/api/consumer/profiles/custom` | Create a new profile |

### Weather
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/forecast/weather` | Grid weather forecast (5x5 Texas grid, 6h intervals) |
| GET | `/api/forecast/weather/cities` | City-level forecasts for 7 US cities |
| GET | `/api/forecast/weather/status` | Service and cache status |

### Utility / Operator
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/utility/overview` | National grid overview with per-region status |
| GET | `/api/utility/weather-events` | LLM-generated weather event descriptions |
| GET | `/api/utility/crews` | Crew assignments |
| GET | `/api/utility/events` | Timeline events |
| GET | `/api/utility/events/stream` | SSE live event stream |
| GET | `/api/utility/outcomes` | With/without void comparison |

### Crew Dispatch
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/utility/crews/dispatch/init` | Initialize dispatch system, load crews, run cascade, classify failures |
| GET | `/api/utility/crews/dispatch/recommend` | Get recommended crew-to-node assignments |
| POST | `/api/utility/crews/dispatch` | Dispatch a single crew to a node |
| POST | `/api/utility/crews/dispatch/all` | Accept all recommendations |
| GET | `/api/utility/crews/dispatch/status` | Current dispatch status and crew positions |
| POST | `/api/utility/crews/dispatch/tick` | Advance the state machine (call every 5-10s) |

### Frontend API Routes (Next.js)
| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/alerts` | Generate or accept price alerts with ntfy push |
| GET | `/api/grid-nodes` | Fetch grid nodes and edges from Supabase |
| POST | `/api/enode/link` | Generate Enode OAuth link session |
| GET | `/api/enode/devices` | List linked smart devices |
| GET | `/api/xrpl/status` | RLUSD balance and transaction history |
| POST | `/api/xrpl/payout` | Send RLUSD reward payout |
| GET/POST | `/api/simulation` | Simulation state management |
