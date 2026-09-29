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
    [("1950-06", "34.70")]
    + [(f"1955-{m:02d}", "35.00") for m in range(1, 13)]
    + [(f"1965-{m:02d}", "35.10" if m == 6 else "35.00") for m in range(1, 13)]
    + [(f"1968-{m:02d}", "38.00") for m in range(1, 13)]
    + [("1980-01", "675.00"), ("2018-12", "1250.00")]
    + [(f"2026-{m:02d}", "3200.00") for m in range(1, 9)]
)


# Hand-made USD-per-unit tables in the shape of the BIS cache files (date, usd_per_unit).
# The first dates match the real BIS coverage: GBP 1953-08-10, CHF and EUR 1953-09-01.
FX_DAILY = {
    "gbp": [("1953-08-10", "2.78"), ("1953-08-11", "2.79"), ("1980-01-18", "2.25"),
            ("1980-01-21", "2.26"), ("2026-09-21", "1.34"), ("2026-09-22", "1.35")],
    "chf": [("1953-09-01", "0.2333"), ("1980-01-21", "0.60"), ("1999-01-04", "0.7292"),
            ("2026-09-22", "1.25")],
    "eur": [("1953-09-01", "0.4656"), ("1980-01-21", "0.5"), ("1998-12-30", "1.10"),
            ("1998-12-31", "1.12"), ("1999-01-04", "1.17"), ("1999-01-05", "1.18"),
            ("2018-12-03", "1.13"), ("2018-12-04", "1.14"), ("2018-12-05", "1.15"),
            ("2026-09-21", "1.17"), ("2026-09-22", "1.18")],
}


def write_fx(directory: Path, tables=FX_DAILY) -> dict:
    directory.mkdir(parents=True, exist_ok=True)
    paths = {}
    for name, rows in tables.items():
        path = directory / f"fx_{name}.csv"
        path.write_text("date,usd_per_unit\n" + "".join(f"{d},{v}\n" for d, v in rows))
        paths[name.upper()] = path
    return paths


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
def fx(gv, cache_dir):
    return gv.FxRates(write_fx(cache_dir))


@pytest.fixture
def table(gv, cache_dir):
    return gv.GoldTable(cache_dir / "lbma_daily.csv", cache_dir / "monthly.csv")
