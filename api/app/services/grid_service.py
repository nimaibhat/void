from datetime import datetime, timezone

from app.models.grid import GridStatusResponse, RegionGridStatus, StressLevel


async def get_grid_status() -> GridStatusResponse:
    """Fetch current grid stress levels across all major ISO regions.

    This should aggregate real-time data from ISO APIs (CAISO OASIS,
    ERCOT MIS, PJM Data Miner, etc.) to compute stress metrics
    for each region including load, capacity, and reserve margins.

    Returns:
        GridStatusResponse with per-region stress data.
    """
    # TODO: Implement actual grid data aggregation here
    now = datetime.now(timezone.utc)
    regions = [
        RegionGridStatus(
            region="CAISO",
            stress_level=StressLevel.MODERATE,
            load_mw=28500.0,
            capacity_mw=37000.0,
            reserve_margin_pct=22.9,
            renewable_pct=42.3,
            outages_active=3,
        ),
        RegionGridStatus(
            region="ERCOT",
            stress_level=StressLevel.HIGH,
            load_mw=62000.0,
            capacity_mw=71000.0,
            reserve_margin_pct=12.7,
            renewable_pct=31.5,
            outages_active=7,
        ),
        RegionGridStatus(
            region="PJM",
            stress_level=StressLevel.LOW,
            load_mw=95000.0,
            capacity_mw=140000.0,
            reserve_margin_pct=32.1,
            renewable_pct=12.8,
            outages_active=2,
        ),
        RegionGridStatus(
            region="MISO",
            stress_level=StressLevel.MODERATE,
            load_mw=78000.0,
            capacity_mw=100000.0,
            reserve_margin_pct=22.0,
            renewable_pct=18.4,
            outages_active=5,
        ),
        RegionGridStatus(
            region="NYISO",
            stress_level=StressLevel.LOW,
            load_mw=21000.0,
            capacity_mw=33000.0,
            reserve_margin_pct=36.4,
            renewable_pct=22.1,
            outages_active=1,
        ),
        RegionGridStatus(
            region="ISO-NE",
            stress_level=StressLevel.LOW,
            load_mw=15000.0,
            capacity_mw=25000.0,
            reserve_margin_pct=40.0,
            renewable_pct=19.7,
            outages_active=0,
        ),
        RegionGridStatus(
            region="SPP",
            stress_level=StressLevel.LOW,
            load_mw=35000.0,
            capacity_mw=55000.0,
            reserve_margin_pct=36.4,
            renewable_pct=38.9,
            outages_active=1,
        ),
    ]
    return GridStatusResponse(
        generated_at=now,
        national_stress=StressLevel.MODERATE,
        regions=regions,
    )
