"""Shared fixtures: load goldvalue.py by path and give every test a private cache.

The tiny price tables below are hand-made (not real LBMA data) so expected values
can be computed by hand. Tests never touch the network: `_download` raises unless a
test replaces it, and GOLDVALUE_OFFLINE=1 is the default.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / ".agents" / "skills" / "gold-value-normalizer" / "scripts" / "goldvalue.py"

TODAY = "2026-09-29"

# (date, usd_am, usd_pm); empty string means the fix is missing.
DAILY = [
    ("1968-01-02", "35.18", ""),
    ("1968-01-03", "35.20", ""),
    ("1968-03-14", "38.00", ""),
    ("1968-04-01", "38.50", "38.60"),
    ("1968-04-02", "38.70", "38.80"),
    ("1980-01-18", "830.00", "835.00"),
    ("1980-01-21", "843.00", "850.00"),
    ("1980-01-22", "845.00", ""),
    ("2018-12-03", "1230.00", "1200.00"),
    ("2018-12-04", "1240.00", "1210.00"),
    ("2018-12-05", "1250.00", "1220.00"),
    ("2026-01-02", "3000.00", "3010.00"),
    ("2026-02-02", "3100.00", "3110.00"),
    ("2026-09-21", "3395.00", "3400.00"),
    ("2026-09-22", "3405.00", "3410.00"),
    ("2026-09-23", "3415.00", "3420.00"),
    ("2026-09-24", "3425.00", "3430.00"),
    ("2026-09-25", "3435.00", "3440.00"),
]

# (month, usd)
MONTHLY = (
    [(f"1955-{m:02d}", "35.00") for m in range(1, 13)]
    + [(f"1965-{m:02d}", "35.10" if m == 6 else "35.00") for m in range(1, 13)]
    + [(f"1968-{m:02d}", "38.00") for m in range(1, 13)]
    + [("1980-01", "675.00"), ("2018-12", "1250.00")]
    + [(f"2026-{m:02d}", "3200.00") for m in range(1, 9)]
)


def write_cache(directory: Path, daily=DAILY, monthly=MONTHLY) -> tuple[Path, Path]:
    directory.mkdir(parents=True, exist_ok=True)
    lbma = directory / "lbma_daily.csv"
    monthly_path = directory / "monthly.csv"
    lbma.write_text(
        "date,usd_am,usd_pm\n" + "".join(f"{d},{a},{p}\n" for d, a, p in daily)
    )
    monthly_path.write_text(
        "month,usd\n" + "".join(f"{m},{v}\n" for m, v in monthly)
    )
    return lbma, monthly_path


@pytest.fixture(scope="session")
def gv():
    spec = importlib.util.spec_from_file_location("goldvalue", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["goldvalue"] = module
    spec.loader.exec_module(module)
    module._orig_download = module._download
    return module


@pytest.fixture(autouse=True)
def hermetic_env(monkeypatch, tmp_path, gv):
    cache = tmp_path / "cache"
    monkeypatch.setenv("GOLD_PRICE_CACHE_DIR", str(cache))
    monkeypatch.setenv("GOLDVALUE_TODAY", TODAY)
    monkeypatch.setenv("GOLDVALUE_OFFLINE", "1")

    def no_network(url):
        raise AssertionError(f"unexpected download of {url}")

    monkeypatch.setattr(gv, "_download", no_network)
    monkeypatch.setattr(gv, "_no_refresh", False)
    return cache


@pytest.fixture
def cache_dir(hermetic_env):
    write_cache(hermetic_env)
    return hermetic_env


@pytest.fixture
def table(gv, cache_dir):
    return gv.GoldTable(cache_dir / "lbma_daily.csv", cache_dir / "monthly.csv")
