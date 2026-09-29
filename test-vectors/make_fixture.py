#!/usr/bin/env python3
"""Generate the SYNTHETIC gold price fixture used by tests and golden vectors.

Spec D15: no LBMA price data is committed to this repository. Everything written
here is made up by a fixed-seed generator: plausible price *levels* (coarse yearly
anchors, interpolated) plus deterministic noise, never real fixes. Regenerating
must be byte-identical on every platform, so the generator uses only integer
arithmetic, + - * / and correctly rounded formatting (no libm functions, no
`random` module, and math.fsum rather than sum(), whose float summation changed in
Python 3.12).

FX (v1.1): fx_gbp.csv, fx_chf.csv and fx_eur.csv (`date,usd_per_unit`, the CLI cache
shape) are synthetic too: coarse yearly levels plus deterministic noise, weekdays only,
ending 2026-09-22 like BIS's roughly one-week lag. Their coverage boundaries match the
real BIS series: GBP from 1953-08-10, CHF and EUR from 1953-09-01. The EUR series is
continuous across 1999 (before 1999 it is the synthetic Deutsche Mark times 1.95583).

Outputs (into --out, default test-vectors/snapshot):
  lbma_daily.csv   date,usd_am,usd_pm     the CLI cache shape, 1968-01-02 .. END_DATE
  monthly.csv      month,usd              the CLI cache shape, 1833-01 .. END_MONTH
  gold_pm.json     LBMA-shaped JSON [{"is_cms_locked": 0, "d": "YYYY-MM-DD",
                   "v": [usd, gbp, eur]}]; eur is null before 1999 as in the real feed
  gold_am.json     same, AM fixes (browser route stubs)
  fx_gbp.csv  fx_chf.csv  fx_eur.csv   date,usd_per_unit (BIS shape, synthetic values)

Realistic gaps: Jan-Mar 1968 has AM fixes only; London was closed 1968-03-15 to
1968-03-31 (first fix back 1968-04-01); weekdays only; Christmas, Boxing Day and
New Year's Day are skipped; a few explicit single-fix days (PM_MISSING, AM_MISSING).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from pathlib import Path

START = dt.date(1968, 1, 2)
END_DATE = dt.date(2026, 9, 25)
END_MONTH = (2026, 9)
AM_ONLY_UNTIL = dt.date(1968, 3, 31)
CLOSURE = (dt.date(1968, 3, 15), dt.date(1968, 3, 31))
PM_MISSING = frozenset({"1990-06-13", "2009-07-22"})
AM_MISSING = frozenset({"2002-09-11", "2019-10-16"})

# Coarse January-1 price levels (USD per troy oz). Synthetic, for shape only.
ANCHORS = {
    1968: 39.0, 1969: 42.0, 1970: 36.0, 1971: 37.5, 1972: 44.0, 1973: 65.0, 1974: 112.0,
    1975: 175.0, 1976: 135.0, 1977: 132.0, 1978: 165.0, 1979: 225.0, 1980: 520.0,
    1981: 610.0, 1982: 400.0, 1983: 445.0, 1984: 390.0, 1985: 305.0, 1986: 340.0,
    1987: 400.0, 1988: 480.0, 1989: 410.0, 1990: 395.0, 1991: 380.0, 1992: 355.0,
    1993: 335.0, 1994: 390.0, 1995: 385.0, 1996: 395.0, 1997: 355.0, 1998: 290.0,
    1999: 290.0, 2000: 285.0, 2001: 270.0, 2002: 280.0, 2003: 345.0, 2004: 410.0,
    2005: 430.0, 2006: 520.0, 2007: 630.0, 2008: 840.0, 2009: 875.0, 2010: 1100.0,
    2011: 1400.0, 2012: 1650.0, 2013: 1650.0, 2014: 1250.0, 2015: 1200.0, 2016: 1070.0,
    2017: 1150.0, 2018: 1310.0, 2019: 1280.0, 2020: 1520.0, 2021: 1900.0, 2022: 1800.0,
    2023: 1830.0, 2024: 2050.0, 2025: 2650.0, 2026: 3500.0, 2027: 3600.0,
}
PEG_END = dt.date(1971, 8, 15)
EURO_START = dt.date(1999, 1, 4)

FX_END_DATE = dt.date(2026, 9, 22)
FX_STARTS = {"gbp": dt.date(1953, 8, 10), "chf": dt.date(1953, 9, 1), "eur": dt.date(1953, 9, 1)}
FX_SEEDS = {"gbp": 1953, "chf": 1954, "eur": 1955}
DEM_PER_EUR = 1.95583

# Coarse January-1 levels, USD per unit of currency (synthetic, for shape only).
GBP_ANCHORS = {
    1953: 2.785, 1967: 2.80, 1968: 2.40, 1971: 2.42, 1972: 2.45, 1973: 2.50, 1974: 2.33,
    1975: 2.35, 1976: 2.02, 1977: 1.72, 1978: 1.92, 1979: 2.03, 1980: 2.22, 1981: 2.38,
    1982: 1.91, 1983: 1.62, 1984: 1.45, 1985: 1.16, 1986: 1.45, 1987: 1.47, 1988: 1.78,
    1989: 1.88, 1990: 1.62, 1991: 1.93, 1992: 1.87, 1993: 1.50, 1994: 1.48, 1995: 1.55,
    1996: 1.55, 1997: 1.71, 1998: 1.65, 1999: 1.65, 2000: 1.62, 2001: 1.50, 2002: 1.44,
    2003: 1.60, 2004: 1.79, 2005: 1.92, 2006: 1.72, 2007: 1.96, 2008: 1.98, 2009: 1.46,
    2010: 1.61, 2011: 1.55, 2012: 1.55, 2013: 1.62, 2014: 1.65, 2015: 1.56, 2016: 1.47,
    2017: 1.23, 2018: 1.35, 2019: 1.27, 2020: 1.32, 2021: 1.37, 2022: 1.35, 2023: 1.20,
    2024: 1.27, 2025: 1.25, 2026: 1.35, 2027: 1.34,
}
CHF_ANCHORS = {
    1953: 0.2333, 1970: 0.2333, 1971: 0.2400, 1972: 0.2600, 1973: 0.3000, 1974: 0.3600,
    1975: 0.3800, 1976: 0.4100, 1977: 0.4000, 1978: 0.5000, 1979: 0.6000, 1980: 0.6000,
    1981: 0.5000, 1982: 0.5000, 1983: 0.4800, 1984: 0.4500, 1985: 0.4000, 1986: 0.5000,
    1987: 0.6500, 1988: 0.7000, 1989: 0.6100, 1990: 0.6500, 1991: 0.7200, 1992: 0.7000,
    1993: 0.6800, 1994: 0.6800, 1995: 0.8000, 1996: 0.8500, 1997: 0.6800, 1998: 0.7000,
    1999: 0.7300, 2000: 0.6200, 2001: 0.6000, 2002: 0.6000, 2003: 0.7200, 2004: 0.8000,
    2005: 0.8700, 2006: 0.7700, 2007: 0.8200, 2008: 0.9200, 2009: 0.9400, 2010: 0.9700,
    2011: 1.0600, 2012: 1.0600, 2013: 1.0900, 2014: 1.1200, 2015: 1.0100, 2016: 1.0000,
    2017: 1.0000, 2018: 1.0300, 2019: 1.0000, 2020: 1.0300, 2021: 1.1300, 2022: 1.0900,
    2023: 1.0800, 2024: 1.1300, 2025: 1.2000, 2026: 1.2500, 2027: 1.2500,
}
# USD per Deutsche Mark up to 1998 (times 1.95583 to get the synthetic euro), USD per
# euro from 1999; both feed one continuous EUR series.
DEM_ANCHORS = {
    1953: 0.2381, 1960: 0.2381, 1961: 0.2500, 1968: 0.2500, 1969: 0.2732, 1970: 0.2740,
    1971: 0.2900, 1972: 0.3130, 1973: 0.3900, 1974: 0.3800, 1975: 0.4100, 1976: 0.3800,
    1977: 0.4300, 1978: 0.4900, 1979: 0.5500, 1980: 0.5500, 1981: 0.4400, 1982: 0.4200,
    1983: 0.3800, 1984: 0.3500, 1985: 0.3100, 1986: 0.4600, 1987: 0.5500, 1988: 0.5700,
    1989: 0.5300, 1990: 0.6000, 1991: 0.6400, 1992: 0.6500, 1993: 0.6000, 1994: 0.5800,
    1995: 0.7000, 1996: 0.6500, 1997: 0.5800, 1998: 0.5800,
}
EUR_ANCHORS_FROM_1999 = {
    1999: 1.15, 2000: 0.94, 2001: 0.90, 2002: 0.88, 2003: 1.05, 2004: 1.26, 2005: 1.36,
    2006: 1.18, 2007: 1.32, 2008: 1.47, 2009: 1.39, 2010: 1.43, 2011: 1.34, 2012: 1.30,
    2013: 1.32, 2014: 1.38, 2015: 1.21, 2016: 1.09, 2017: 1.05, 2018: 1.20, 2019: 1.15,
    2020: 1.12, 2021: 1.22, 2022: 1.13, 2023: 1.07, 2024: 1.10, 2025: 1.04, 2026: 1.17,
    2027: 1.16,
}
FX_PEG_END = {"gbp": dt.date(1971, 8, 15), "chf": dt.date(1971, 8, 15),
              "eur": dt.date(1971, 8, 15)}

MASK = (1 << 64) - 1


class Rng:
    """splitmix64: a tiny deterministic generator with no platform dependence."""

    def __init__(self, seed: int):
        self.state = seed & MASK

    def next(self) -> int:
        self.state = (self.state + 0x9E3779B97F4A7C15) & MASK
        z = self.state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & MASK
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & MASK
        return z ^ (z >> 31)

    def unit(self) -> float:
        """Uniform in [0, 1), exact in binary floating point."""
        return (self.next() >> 11) / float(1 << 53)

    def signed(self) -> float:
        return self.unit() * 2.0 - 1.0


def level_on(day: dt.date) -> float:
    year_start = dt.date(day.year, 1, 1)
    frac = (day - year_start).days / 366.0
    lo, hi = ANCHORS[day.year], ANCHORS[day.year + 1]
    return lo + (hi - lo) * frac


def _interpolated(anchors: dict[int, float], day: dt.date) -> float:
    """Piecewise-linear level between the anchor years that bracket `day`."""
    years = sorted(anchors)
    frac_year = day.year + (day - dt.date(day.year, 1, 1)).days / 366.0
    lo_year = max(y for y in years if y <= day.year)
    hi_year = min((y for y in years if y > day.year), default=lo_year)
    lo, hi = anchors[lo_year], anchors[hi_year]
    if hi_year == lo_year:
        return lo
    return lo + (hi - lo) * (frac_year - lo_year) / (hi_year - lo_year)


def fx_level_on(name: str, day: dt.date) -> float:
    if name == "gbp":
        return _interpolated(GBP_ANCHORS, day)
    if name == "chf":
        return _interpolated(CHF_ANCHORS, day)
    if day.year >= 1999:
        return _interpolated(EUR_ANCHORS_FROM_1999, day)
    dem_hi = {**DEM_ANCHORS, 1999: EUR_ANCHORS_FROM_1999[1999] / DEM_PER_EUR}
    return _interpolated(dem_hi, day) * DEM_PER_EUR


def fx_rows(name: str) -> list[tuple[dt.date, str]]:
    rng = Rng(FX_SEEDS[name])
    walk = 0.0
    rows = []
    day = FX_STARTS[name]
    while day <= FX_END_DATE:
        if is_fx_day(day):
            pegged = day <= FX_PEG_END[name]
            vol, cap = (0.0004, 0.004) if pegged else (0.004, 0.06)
            walk = walk * 0.98 + vol * rng.signed()
            walk = max(-cap, min(cap, walk))
            rows.append((day, format(fx_level_on(name, day) * (1.0 + walk), ".6g")))
        day += dt.timedelta(days=1)
    return rows


def is_fx_day(day: dt.date) -> bool:
    return day.weekday() < 5 and (day.month, day.day) not in ((12, 25), (12, 26), (1, 1))


def is_market_day(day: dt.date) -> bool:
    if day.weekday() >= 5:
        return False
    if CLOSURE[0] <= day <= CLOSURE[1]:
        return False
    return (day.month, day.day) not in ((12, 25), (12, 26), (1, 1))


def daily_rows() -> list[tuple[dt.date, str, str]]:
    for iso in PM_MISSING | AM_MISSING:
        day = dt.date.fromisoformat(iso)
        assert is_market_day(day), iso
    rng = Rng(19680102)
    walk = 0.0
    rows = []
    day = START
    while day <= END_DATE:
        if is_market_day(day):
            pegged = day <= PEG_END
            vol, cap = (0.0015, 0.012) if pegged else (0.009, 0.10)
            walk = walk * 0.985 + vol * rng.signed()
            walk = max(-cap, min(cap, walk))
            base = level_on(day) * (1.0 + walk)
            am = base * (1.0 + 0.002 * rng.signed())
            pm = base * (1.0 + 0.002 * rng.signed())
            am_text = "" if day.isoformat() in AM_MISSING else f"{am:.2f}"
            pm_text = "" if (day <= AM_ONLY_UNTIL or day.isoformat() in PM_MISSING) else f"{pm:.2f}"
            rows.append((day, am_text, pm_text))
        day += dt.timedelta(days=1)
    return rows


def monthly_rows(daily: list[tuple[dt.date, str, str]]) -> list[tuple[str, str]]:
    by_month: dict[tuple[int, int], list[float]] = {}
    for day, am, pm in daily:
        by_month.setdefault((day.year, day.month), []).append(float(pm or am))
    rng = Rng(1833)
    annual = {}
    for year in range(1833, 1960):
        if year <= 1933:
            annual[year] = 20.67
        else:
            annual[year] = 35.0 + round(0.06 * rng.signed(), 2)
    rows = []
    for year in range(1833, END_MONTH[0] + 1):
        for month in range(1, 13):
            if (year, month) > END_MONTH:
                break
            key = f"{year}-{month:02d}"
            if year < 1960:
                rows.append((key, f"{annual[year]:.2f}"))
            elif (year, month) < (START.year, START.month):
                rows.append((key, f"{35.0 + 0.1 * rng.unit():.2f}"))
            else:
                values = by_month[(year, month)]
                rows.append((key, f"{math.fsum(values) / len(values):.2f}"))
    return rows


def lbma_json(daily, column: int) -> str:
    out = []
    for day, am, pm in daily:
        text = (am, pm)[column]
        if not text:
            continue
        usd = float(text)
        eur = round(usd * 0.9, 2) if day >= EURO_START else None
        out.append({"is_cms_locked": 0, "d": day.isoformat(), "v": [usd, round(usd * 0.6, 2), eur]})
    return json.dumps(out, separators=(",", ":")) + "\n"


def write_text(path: Path, text: str) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        fh.write(text)


def generate(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    daily = daily_rows()
    write_text(out / "lbma_daily.csv",
               "date,usd_am,usd_pm\n" + "".join(f"{d},{a},{p}\n" for d, a, p in daily))
    write_text(out / "monthly.csv",
               "month,usd\n" + "".join(f"{m},{v}\n" for m, v in monthly_rows(daily)))
    write_text(out / "gold_am.json", lbma_json(daily, 0))
    write_text(out / "gold_pm.json", lbma_json(daily, 1))
    for name in ("gbp", "chf", "eur"):
        write_text(out / f"fx_{name}.csv", "date,usd_per_unit\n"
                   + "".join(f"{d},{v}\n" for d, v in fx_rows(name)))


def main() -> None:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=here / "snapshot")
    generate(ap.parse_args().out)


if __name__ == "__main__":
    main()
