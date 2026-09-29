#!/usr/bin/env python3
"""Generate the SYNTHETIC gold price fixture used by tests and golden vectors.

Spec D15: no LBMA price data is committed to this repository. Everything written
here is made up by a fixed-seed generator: plausible price *levels* (coarse yearly
anchors, interpolated) plus deterministic noise, never real fixes. Regenerating
must be byte-identical on every platform, so the generator uses only integer
arithmetic, + - * / and correctly rounded formatting (no libm functions, no
`random` module, and math.fsum rather than sum(), whose float summation changed in
Python 3.12).

Outputs (into --out, default test-vectors/snapshot):
  lbma_daily.csv   date,usd_am,usd_pm     the CLI cache shape, 1968-01-02 .. END_DATE
  monthly.csv      month,usd              the CLI cache shape, 1833-01 .. END_MONTH
  gold_pm.json     LBMA-shaped JSON [{"is_cms_locked": 0, "d": "YYYY-MM-DD",
                   "v": [usd, gbp, eur]}]; eur is null before 1999 as in the real feed
  gold_am.json     same, AM fixes (browser route stubs)

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


def main() -> None:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=here / "snapshot")
    generate(ap.parse_args().out)


if __name__ == "__main__":
    main()
