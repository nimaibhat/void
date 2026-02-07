import requests
import json
import os 
# EIA Open Data API v2
# Get your API key at: https://www.eia.gov/opendata/register.php
API_KEY = os.getenv("EIA_API_KEY")


BASE_URL = "https://api.eia.gov/v2"

# --- Electricity demand (hourly) for Texas (ERCOT region) ---
def pull_electricity_demand():
    url = f"{BASE_URL}/electricity/rto/region-data/data/"
    params = {
        "api_key": API_KEY,
        "frequency": "hourly",
        "data[0]": "value",
        "facets[respondent][]": "TEX",
        "facets[type][]": "D",
        "start": "2021-02-10T00",
        "end": "2021-02-23T23",
        "sort[0][column]": "period",
        "sort[0][direction]": "asc",
        "length": 5000,
    }
    resp = requests.get(url, params=params)
    resp.raise_for_status()
    return resp.json()

# --- Net generation by energy source for Texas ---
def pull_generation_by_source():
    url = f"{BASE_URL}/electricity/rto/fuel-type-data/data/"
    params = {
        "api_key": API_KEY,
        "frequency": "hourly",
        "data[0]": "value",
        "facets[respondent][]": "TEX",
        "start": "2021-02-10T00",
        "end": "2021-02-23T23",
        "sort[0][column]": "period",
        "sort[0][direction]": "asc",
        "length": 5000,
    }
    resp = requests.get(url, params=params)
    resp.raise_for_status()
    return resp.json()

# --- Interchange (imports/exports) for Texas ---
def pull_interchange():
    url = f"{BASE_URL}/electricity/rto/interchange-data/data/"
    params = {
        "api_key": API_KEY,
        "frequency": "hourly",
        "data[0]": "value",
        "facets[fromba][]": "ERCO",
        "start": "2021-02-10T00",
        "end": "2021-02-23T23",
        "sort[0][column]": "period",
        "sort[0][direction]": "asc",
        "length": 5000,
    }
    resp = requests.get(url, params=params)
    resp.raise_for_status()
    return resp.json()


if __name__ == "__main__":
    print("Pulling ERCOT electricity demand...")
    demand = pull_electricity_demand()
    with open("eia_texas_demand.json", "w") as f:
        json.dump(demand, f, indent=2)
    print(f"  -> {demand['response']['total']} records saved to eia_texas_demand.json")

    print("Pulling ERCOT generation by fuel type...")
    generation = pull_generation_by_source()
    with open("eia_texas_generation.json", "w") as f:
        json.dump(generation, f, indent=2)
    print(f"  -> {generation['response']['total']} records saved to eia_texas_generation.json")

    print("Pulling ERCOT interchange data...")
    interchange = pull_interchange()
    with open("eia_texas_interchange.json", "w") as f:
        json.dump(interchange, f, indent=2)
    print(f"  -> {interchange['response']['total']} records saved to eia_texas_interchange.json")

    print("Done.")
