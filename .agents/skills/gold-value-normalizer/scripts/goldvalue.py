#!/usr/bin/env python3
"""Convert dated US dollar amounts into gold-denominated units (and back).

Units
  GB   goldback            = 1/1000 troy oz of gold
  GBD  gold-backed dollar  = 1/50 troy oz of gold (50 GBD per troy oz)
  OZ   troy ounce of gold

Price sources (fetched once, cached locally as CSV)
  LBMA daily gold price (USD, PM fix; AM fix where PM is unavailable), 1968-present
      https://prices.lbma.org.uk/json/gold_pm.json
      https://prices.lbma.org.uk/json/gold_am.json
  Monthly USD gold price, 1833-present (World Bank Pink Sheet from 1960;
  Timothy Green / National Mining Association annual table before 1960)
      https://raw.githubusercontent.com/datasets/gold-prices/main/data/monthly.csv
  Daily FX from the BIS (only for --currency EUR|GBP|CHF|DEM), 1953-present, stored as
  USD per unit in fx_eur.csv / fx_gbp.csv / fx_chf.csv (DEM is derived from EUR)
      https://stats.bis.org/api/v1/data/WS_XRU/D.{DE.EUR,GB.GBP,CH.CHF}.A?format=csv

Non-USD amounts convert to USD first (USD-routing tenet), then to gold. Before a
currency's first BIS observation a Bretton Woods parity table applies; every FX value
that is not a daily observation carries an fx_mode flag and an explanatory fx_note.

Only the Python standard library is required.

Test hooks (environment)
  GOLDVALUE_TODAY=YYYY-MM-DD  override "today" (the `today` keyword, the future-date
                              check, and the month/year-to-date notes)
  GOLDVALUE_OFFLINE=1         never touch the network and never refresh a stale cache
                              (same as --no-refresh); missing cache files are an error
"""

from __future__ import annotations

import argparse
import bisect
import csv
import datetime as dt
import json
import math
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

GB_PER_OZ = 1000.0
GBD_PER_OZ = 50.0

LBMA_PM_URL = "https://prices.lbma.org.uk/json/gold_pm.json"
LBMA_AM_URL = "https://prices.lbma.org.uk/json/gold_am.json"
MONTHLY_URL = (
    "https://raw.githubusercontent.com/datasets/gold-prices/main/data/monthly.csv"
)

LBMA_START = dt.date(1968, 1, 2)
STALE_AFTER_SECONDS = 12 * 3600
ROLLBACK_DAYS = 9

BIS_URL = "https://stats.bis.org/api/v1/data/WS_XRU/D.{area}.{ccy}.A?format=csv"
# BIS series behind each cached FX file. D.DE.EUR is Germany's history restated in
# euros at the fixed conversion rate, so it supplies both EUR and DEM (never XM).
FX_SERIES = {"EUR": ("DE", "EUR"), "GBP": ("GB", "GBP"), "CHF": ("CH", "CHF")}
CURRENCIES = ("USD", "EUR", "GBP", "CHF", "DEM")
DEM_PER_EUR = 1.95583
EURO_START = dt.date(1999, 1, 4)
DEM_LAST_DAY = dt.date(1998, 12, 31)
FX_STALE_DAYS = 3
FX_MAX_GZ_BYTES = 110_000

FX_KEYS = ("fx_rate", "fx_effective", "fx_mode", "fx_note")
# Computed export columns (spec FR15). Ignored when found in a batch input file.
COMPUTED_COLUMNS = ("effective", "gold_usd_per_oz", "troy_oz", "GB", "GBD", "USD",
                    "price_source", "granularity", "note", *FX_KEYS)
BATCH_FIXED_COLUMNS = ("date", "amount", "currency", "label")

UNIT_ALIASES = {
    "usd": "USD", "$": "USD", "dollar": "USD", "dollars": "USD",
    "gb": "GB", "goldback": "GB", "goldbacks": "GB",
    "gbd": "GBD", "gold-backed-dollar": "GBD", "goldbackeddollar": "GBD",
    "oz": "OZ", "ozt": "OZ", "troyoz": "OZ", "ounce": "OZ", "ounces": "OZ",
}


# --------------------------------------------------------------------------- environment

_no_refresh = False


def today_date() -> dt.date:
    override = os.environ.get("GOLDVALUE_TODAY", "").strip()
    if not override:
        return dt.date.today()
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", override):
        sys.exit(f"error: GOLDVALUE_TODAY must be YYYY-MM-DD, got {override!r}")
    try:
        return dt.date.fromisoformat(override)
    except ValueError:
        sys.exit(f"error: GOLDVALUE_TODAY is not a valid date: {override!r}")


def offline() -> bool:
    flag = os.environ.get("GOLDVALUE_OFFLINE", "").strip().lower()
    return _no_refresh or flag not in ("", "0", "false", "no")


# --------------------------------------------------------------------------- cache


def cache_dir() -> Path:
    override = os.environ.get("GOLD_PRICE_CACHE_DIR")
    base = Path(override) if override else Path.home() / ".cache" / "gold-value"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _download(url: str) -> bytes:
    if offline():
        raise OSError("network access is disabled (offline mode)")
    req = urllib.request.Request(url, headers={"User-Agent": "goldvalue-skill/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def _age_seconds(path: Path) -> float:
    return time.time() - path.stat().st_mtime if path.exists() else float("inf")


def fetch_lbma(path: Path) -> None:
    pm = {row["d"]: row["v"][0] for row in json.loads(_download(LBMA_PM_URL))}
    am = {row["d"]: row["v"][0] for row in json.loads(_download(LBMA_AM_URL))}
    dates = sorted(set(pm) | set(am))
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["date", "usd_am", "usd_pm"])
        for d in dates:
            a, p = am.get(d), pm.get(d)
            if a is None and p is None:
                continue
            w.writerow([d, "" if a is None else a, "" if p is None else p])
    tmp.replace(path)


def fx_path(directory: Path, source: str) -> Path:
    return directory / f"fx_{source.lower()}.csv"


def parse_bis_csv(text: str) -> list[tuple[str, float]]:
    """Return (date, USD per unit) rows from a BIS WS_XRU CSV.

    BIS quotes units of currency per USD in OBS_VALUE, so the value is inverted.
    Rows before a series' first valid date carry `NaN` (or nothing) and are skipped.
    """
    rows: dict[str, float] = {}
    for r in csv.DictReader(text.splitlines()):
        raw = (r.get("OBS_VALUE") or "").strip()
        day = (r.get("TIME_PERIOD") or "").strip()
        if not raw or not day:
            continue
        try:
            quote = float(raw)
            dt.date.fromisoformat(day)
        except ValueError:
            continue
        if math.isfinite(quote) and quote > 0:
            rows[day] = 1.0 / quote
    return sorted(rows.items())


def format_rate(value: float) -> str:
    """Six significant digits: keeps each fx_*.csv under the 110 KB gzip budget."""
    text = format(value, ".6g")
    if "e" in text or "E" in text:
        raise ValueError(f"FX rate {value!r} is outside the supported range")
    return text


def fetch_fx(path: Path, source: str) -> None:
    area, ccy = FX_SERIES[source]
    rows = parse_bis_csv(_download(BIS_URL.format(area=area, ccy=ccy)).decode("utf-8"))
    if not rows:
        raise ValueError(f"BIS returned no {source} observations")
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", newline="", encoding="utf-8") as fh:
        fh.write("date,usd_per_unit\n")
        for day, usd in rows:
            fh.write(f"{day},{format_rate(usd)}\n")
    tmp.replace(path)


def fetch_monthly(path: Path) -> None:
    text = _download(MONTHLY_URL).decode("utf-8")
    rows = list(csv.DictReader(text.splitlines()))
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["month", "usd"])
        for r in rows:
            if r.get("Price"):
                w.writerow([r["Date"], r["Price"]])
    tmp.replace(path)


def _ensure_file(path: Path, fetch, label: str, force: bool, quiet: bool) -> None:
    if offline():
        if force:
            sys.exit("error: --refresh cannot be combined with offline mode")
        if not path.exists():
            sys.exit(f"error: offline mode and the {label} cache is missing: {path}")
        return
    if force or not path.exists():
        if not quiet:
            print(f"Fetching {label} -> {path}", file=sys.stderr)
        try:
            fetch(path)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            if path.exists():
                print(f"warning: refresh of {label} failed ({exc}); using cached copy",
                      file=sys.stderr)
            else:
                sys.exit(f"error: could not fetch {label}: {exc}")


def ensure_cache(force: bool = False, quiet: bool = False) -> tuple[Path, Path]:
    d = cache_dir()
    lbma, monthly = d / "lbma_daily.csv", d / "monthly.csv"
    for path, fetch, label in (
        (lbma, fetch_lbma, "LBMA daily fixes"),
        (monthly, fetch_monthly, "monthly series"),
    ):
        _ensure_file(path, fetch, label, force, quiet)
    return lbma, monthly


def fx_sources_for(currencies) -> list[str]:
    """Cached FX files needed for these currencies (DEM comes from the EUR file)."""
    return sorted({"EUR" if c == "DEM" else c for c in currencies if c != "USD"})


def ensure_fx_cache(sources, force: bool = False, quiet: bool = False) -> dict[str, Path]:
    d = cache_dir()
    paths = {}
    for source in sources:
        path = paths[source] = fx_path(d, source)
        _ensure_file(path, lambda p, s=source: fetch_fx(p, s), f"{source} FX rates (BIS)",
                     force, quiet)
    return paths


def refresh_if_stale(path: Path, fetch, label: str) -> None:
    if offline():
        return
    if _age_seconds(path) > STALE_AFTER_SECONDS:
        try:
            print(f"Refreshing {label} (cache older than 12h)", file=sys.stderr)
            fetch(path)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            print(f"warning: refresh failed ({exc}); using cached copy", file=sys.stderr)


# --------------------------------------------------------------------------- data


class GoldTable:
    def __init__(self, lbma_path: Path, monthly_path: Path):
        self.lbma_path, self.monthly_path = lbma_path, monthly_path
        self.daily: dict[dt.date, float] = {}
        self.monthly: dict[tuple[int, int], float] = {}
        self._load()

    def _load(self) -> None:
        self.daily.clear()
        with self.lbma_path.open(newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                v = r["usd_pm"] or r["usd_am"]
                if v:
                    self.daily[dt.date.fromisoformat(r["date"])] = float(v)
        self.monthly.clear()
        with self.monthly_path.open(newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                y, m = r["month"].split("-")
                self.monthly[(int(y), int(m))] = float(r["usd"])

    @property
    def last_daily(self) -> dt.date:
        return max(self.daily)

    @property
    def last_month(self) -> tuple[int, int]:
        return max(self.monthly)

    def ensure_covers(self, target: dt.date) -> None:
        """Refresh caches when a query reaches past the cached range."""
        if target > self.last_daily:
            refresh_if_stale(self.lbma_path, fetch_lbma, "LBMA daily fixes")
            self._load()
        if (target.year, target.month) > self.last_month:
            refresh_if_stale(self.monthly_path, fetch_monthly, "monthly series")
            self._load()

    # ---- resolution -------------------------------------------------------

    def price_for_day(self, day: dt.date) -> dict:
        if day >= LBMA_START:
            for back in range(0, ROLLBACK_DAYS + 1):
                probe = day - dt.timedelta(days=back)
                if probe in self.daily:
                    note = ("LBMA fix on the requested date" if back == 0
                            else f"no LBMA fix on {day} (non-trading day); "
                                 f"used previous fix from {probe}")
                    return dict(price=self.daily[probe], granularity="day",
                                effective=str(probe), points=1,
                                source="LBMA", note=note)
            if day > self.last_daily:
                return dict(price=self.daily[self.last_daily], granularity="day",
                            effective=str(self.last_daily), points=1, source="LBMA",
                            note=f"requested date is after the latest available fix; "
                                 f"used {self.last_daily}")
        key = (day.year, day.month)
        if key in self.monthly:
            reason = ("no daily data before 1968" if day < LBMA_START
                      else f"no LBMA fix within {ROLLBACK_DAYS} days before {day}")
            return dict(price=self.monthly[key], granularity="month",
                        effective=f"{day.year}-{day.month:02d}", points=1,
                        source=self._monthly_source(day.year),
                        note=f"{reason}; used the monthly price")
        raise LookupError(f"no gold price data for {day}")

    def price_for_month(self, year: int, month: int, today: dt.date | None = None) -> dict:
        today = today or today_date()
        fixes = [p for d, p in self.daily.items() if (d.year, d.month) == (year, month)]
        if fixes:
            partial = " (month to date)" if (year, month) == (today.year, today.month) else ""
            return dict(price=statistics.fmean(fixes), granularity="month",
                        effective=f"{year}-{month:02d}", points=len(fixes),
                        source="LBMA",
                        note=f"average of {len(fixes)} LBMA daily fixes{partial}")
        if (year, month) in self.monthly:
            return dict(price=self.monthly[(year, month)], granularity="month",
                        effective=f"{year}-{month:02d}", points=1,
                        source=self._monthly_source(year),
                        note="monthly series value")
        raise LookupError(f"no gold price data for {year}-{month:02d}")

    def price_for_year(self, year: int, today: dt.date | None = None) -> dict:
        today = today or today_date()
        fixes = [p for d, p in self.daily.items() if d.year == year]
        if fixes:
            partial = " (year to date)" if year == today.year else ""
            return dict(price=statistics.fmean(fixes), granularity="year",
                        effective=str(year), points=len(fixes), source="LBMA",
                        note=f"average of {len(fixes)} LBMA daily fixes{partial}")
        months = [p for (y, m), p in self.monthly.items() if y == year]
        if months:
            return dict(price=statistics.fmean(months), granularity="year",
                        effective=str(year), points=len(months),
                        source=self._monthly_source(year),
                        note=f"average of {len(months)} monthly values")
        raise LookupError(f"no gold price data for {year}")

    @staticmethod
    def _monthly_source(year: int) -> str:
        return ("World Bank Pink Sheet (monthly)" if year >= 1960
                else "Timothy Green / NMA table (annual average)")


# --------------------------------------------------------------------------- FX

FX_MODES = ("daily", "synthetic", "parity", "extrapolated")

# Bretton Woods par values (spec 6.2a): (effective from, USD per unit, description).
# Used only before a currency's first BIS observation; DEM also drives EUR.
PARITY_TABLE = {
    "GBP": [(dt.date(1940, 1, 1), 4.03, "\u00a31 = $4.03"),
            (dt.date(1949, 9, 18), 2.80, "\u00a31 = $2.80")],
    "CHF": [(dt.date(1949, 1, 1), 1 / 4.37282, "CHF 1 = $0.2287 (4.37282 CHF per USD)")],
    "DEM": [(dt.date(1948, 6, 21), 1 / 3.33, "DM 1 = $0.3003 (3.33 DM per USD)"),
            (dt.date(1949, 9, 28), 1 / 4.20, "DM 1 = $0.2381 (4.20 DM per USD)")],
}
EUR_PARITY_LABELS = {
    dt.date(1948, 6, 21): "\u20ac1 = $0.5873 (via DM 1 = $0.3003 at 1 \u20ac = 1.95583 DM)",
    dt.date(1949, 9, 28): "\u20ac1 = $0.4657 (via DM 1 = $0.2381 at 1 \u20ac = 1.95583 DM)",
}
GBP_EXTRAPOLATION_NOTE = (" Indicative only: sterling was about $4.87 on the gold standard "
                          "before 1931 and floated in the 1930s.")

SYNTHETIC_EUR_NOTE = (
    "Synthetic euro: the euro did not exist before 1999. Value derived from the Deutsche "
    "Mark at the fixed conversion rate 1 \u20ac = 1.95583 DM. Amounts originally in other "
    "legacy currencies (francs, lire, \u2026) would differ.")
SYNTHETIC_DEM_NOTE = (
    "Synthetic Deutsche Mark: the Deutsche Mark was replaced by the euro in 1999. Value "
    "derived from the euro at the fixed conversion rate 1 \u20ac = 1.95583 DM.")
BIS_LAG_NOTE = "BIS data lags about a week"


class FxTable:
    """Daily USD-per-unit observations from one cached BIS file."""

    def __init__(self, path: Path, source: str):
        self.path, self.source = path, source
        self._load()

    def _load(self) -> None:
        rows = []
        with self.path.open(newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                rows.append((dt.date.fromisoformat(r["date"]), float(r["usd_per_unit"])))
        rows.sort()
        self.dates = [d for d, _ in rows]
        self.values = [v for _, v in rows]
        self._by_date = dict(rows)
        if not rows:
            raise LookupError(f"{self.path} has no FX observations")

    @property
    def first(self) -> dt.date:
        return self.dates[0]

    @property
    def last(self) -> dt.date:
        return self.dates[-1]

    def value(self, day: dt.date) -> float | None:
        return self._by_date.get(day)

    def between(self, first: dt.date, last: dt.date) -> tuple[list[dt.date], list[float]]:
        lo = bisect.bisect_left(self.dates, first)
        hi = bisect.bisect_right(self.dates, last)
        return self.dates[lo:hi], self.values[lo:hi]

    def before(self, day: dt.date) -> dt.date:
        return self.dates[bisect.bisect_left(self.dates, day) - 1]

    def ensure_covers(self, target: dt.date) -> None:
        if target > self.last:
            refresh_if_stale(self.path, lambda p: fetch_fx(p, self.source),
                             f"{self.source} FX rates (BIS)")
            self._load()


class FxRates:
    """The FX tables a run needs, keyed by BIS source (EUR, GBP, CHF)."""

    def __init__(self, paths: dict[str, Path]):
        self.tables = {source: FxTable(path, source) for source, path in paths.items()}

    def table_for(self, currency: str) -> FxTable:
        source = "EUR" if currency == "DEM" else currency
        try:
            return self.tables[source]
        except KeyError:
            raise LookupError(f"no FX data loaded for {currency}") from None

    def ensure_covers(self, target: dt.date) -> None:
        for table in self.tables.values():
            table.ensure_covers(target)


def period_bounds(kind: str, anchor: dt.date) -> tuple[dt.date, dt.date]:
    if kind == "day":
        return anchor, anchor
    if kind == "month":
        first = anchor.replace(day=1)
        nxt = (first + dt.timedelta(days=31)).replace(day=1)
        return first, nxt - dt.timedelta(days=1)
    return dt.date(anchor.year, 1, 1), dt.date(anchor.year, 12, 31)


def period_midpoint(kind: str, anchor: dt.date) -> dt.date:
    """Same point the chart uses (spec FR12): the day, the 16th, or 2 July."""
    if kind == "day":
        return anchor
    if kind == "month":
        return dt.date(anchor.year, anchor.month, 16)
    return dt.date(anchor.year, 7, 2)


def parity_rate(currency: str, when: dt.date, first_obs: dt.date | None) -> dict:
    """Bretton Woods parity in force on `when`; `extrapolated` before the table starts."""
    rows = PARITY_TABLE["DEM" if currency in ("EUR", "DEM") else currency]
    idx = 0
    for i, row in enumerate(rows):
        if row[0] <= when:
            idx = i
    start, base, label = rows[idx]
    extrapolated = when < rows[0][0]
    rate, shown = base, label
    if currency == "EUR":
        rate, shown = base * DEM_PER_EUR, EUR_PARITY_LABELS[start]
    if extrapolated:
        text = (f"Extrapolated: no parity table entry before {start}; the earliest entry "
                f"{shown} is used.")
        if currency == "GBP":
            text += GBP_EXTRAPOLATION_NOTE
    else:
        if idx + 1 < len(rows):
            end = rows[idx + 1][0] - dt.timedelta(days=1)
        else:
            end = first_obs - dt.timedelta(days=1) if first_obs else None
        span = f"{start} to {end}" if end else f"from {start}"
        text = f"Bretton Woods parity {shown} ({span})."
    return {"rate": rate, "effective": str(start), "note": text,
            "kind": "extrapolated" if extrapolated else "parity"}


def is_synthetic(currency: str, used_first: dt.date, used_last: dt.date) -> bool:
    if currency == "EUR":
        return used_first < EURO_START
    if currency == "DEM":
        return used_last > DEM_LAST_DAY
    return False


def resolve_fx(fx: FxRates, currency: str, kind: str, anchor: dt.date,
               today: dt.date | None = None) -> dict:
    """Resolve the USD-per-unit rate for a query (spec 6.2b, D10).

    Returns rate, effective, mode, note. Daily observations win; before the first
    observation the parity table applies (`parity`, or `extrapolated` before the table
    starts); `synthetic` marks EUR before 1999-01-04 and DEM after 1998-12-31 by the
    observation dates actually used. The reported mode is the highest of
    daily < synthetic < parity < extrapolated and the note lists every explanation.
    """
    today = today or today_date()
    table = fx.table_for(currency)
    scale = (lambda v: v / DEM_PER_EUR) if currency == "DEM" else (lambda v: v)
    start, end = period_bounds(kind, anchor)
    notes: list[str] = []
    parity = None

    if kind == "day":
        found = None
        for back in range(0, ROLLBACK_DAYS + 1):
            probe = anchor - dt.timedelta(days=back)
            value = table.value(probe)
            if value is not None:
                found = (probe, value, back)
                break
        if found:
            probe, value, back = found
            if back:
                text = f"no FX rate on {anchor}"
                if anchor <= table.last and back <= FX_STALE_DAYS:
                    text += " (non-trading day)"
                text += f"; used previous rate from {probe}"
                if anchor > table.last and back > FX_STALE_DAYS:
                    text += f" ({BIS_LAG_NOTE})"
                notes.append(text)
        elif anchor > table.last:
            probe, value = table.last, table.value(table.last)
            notes.append(f"requested date is after the latest available FX rate; "
                         f"used {probe} ({BIS_LAG_NOTE})")
        elif anchor < table.first:
            parity = parity_rate(currency, anchor, table.first)
        else:
            probe = table.before(anchor)
            value = table.value(probe)
            notes.append(f"no FX rate within {ROLLBACK_DAYS} days before {anchor}; "
                         f"used previous rate from {probe}")
        if parity is None:
            rate, effective = scale(value), str(probe)
            used = (probe, probe)
    else:
        label = f"{anchor.year}-{anchor.month:02d}" if kind == "month" else str(anchor.year)
        dates, values = table.between(start, end)
        if dates:
            rate = statistics.fmean([scale(v) for v in values])
            effective, used = label, (dates[0], dates[-1])
            if start < table.first:
                notes.append(f"period starts before the first BIS observation "
                             f"({table.first}); average of the observations from that date")
            if end > table.last and (min(end, today) - table.last).days > FX_STALE_DAYS:
                notes.append(f"period extends past the latest BIS observation ({table.last}); "
                             f"average of the {len(dates)} available daily rates "
                             f"({BIS_LAG_NOTE})")
        elif end < table.first:
            parity = parity_rate(currency, period_midpoint(kind, anchor), table.first)
        elif start > table.last:
            probe = table.last
            rate, effective, used = scale(table.value(probe)), str(probe), (probe, probe)
            notes.append(f"requested period is after the latest available FX rate; "
                         f"used {probe} ({BIS_LAG_NOTE})")
        else:
            probe = table.before(start)
            rate, effective, used = scale(table.value(probe)), str(probe), (probe, probe)
            notes.append(f"no FX rate in the period; used previous rate from {probe}")

    modes = ["daily"]
    lead: list[str] = []
    if parity is not None:
        rate, effective = parity["rate"], parity["effective"]
        used = (period_midpoint(kind, anchor),) * 2
        modes.append(parity["kind"])
        lead.append(parity["note"])
    if is_synthetic(currency, *used):
        modes.append("synthetic")
        lead.append(SYNTHETIC_EUR_NOTE if currency == "EUR" else SYNTHETIC_DEM_NOTE)
    mode = max(modes, key=FX_MODES.index)
    return {"rate": rate, "effective": effective, "mode": mode,
            "note": " ".join([*lead, *notes])}


# --------------------------------------------------------------------------- parsing


def parse_period(text: str, today: dt.date | None = None) -> tuple[str, dt.date]:
    """Return ("day"|"month"|"year", anchor date).

    The accepted forms are the contract for the TypeScript port (spec FR2); the
    strptime formats are deliberately lenient (unpadded numbers, case-insensitive
    month names, repeated whitespace).
    """
    s = text.strip()
    if not s.isascii():
        raise argparse.ArgumentTypeError(f"unrecognised date {text!r}; ASCII only")
    low = s.lower()
    if low in ("today", "now", "latest"):
        return "day", today or today_date()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d %B %Y", "%B %d, %Y", "%b %d, %Y", "%d %b %Y"):
        try:
            return "day", dt.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    for fmt in ("%Y-%m", "%m/%Y", "%B %Y", "%b %Y", "%Y/%m"):
        try:
            return "month", dt.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    if re.fullmatch(r"[0-9]{4}", s) and int(s) >= 1:
        return "year", dt.date(int(s), 1, 1)
    raise argparse.ArgumentTypeError(
        f"unrecognised date {text!r}; use YYYY, YYYY-MM, YYYY-MM-DD, 'Mar 1975', 'today'")


_AMOUNT_RE = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)")


def parse_amount(text: str | None) -> float:
    """Plain decimals only: `1500`, `$1,500`, `-1,500.50`, `.5`.

    `,`, `$` and `_` are stripped wherever they occur. Exponent forms (`1e3`),
    `nan`, `inf`, and values that overflow a double are rejected.
    """
    cleaned = (text or "").replace(",", "").replace("$", "").replace("_", "").strip()
    if not _AMOUNT_RE.fullmatch(cleaned):
        raise argparse.ArgumentTypeError(f"invalid amount {text!r}")
    value = float(cleaned)
    if not math.isfinite(value):
        raise argparse.ArgumentTypeError(f"invalid amount {text!r}")
    return value


def check_not_future(anchor: dt.date, token: str, today: dt.date) -> None:
    """A period whose start is after today is an error (spec FR2a)."""
    if anchor > today:
        raise argparse.ArgumentTypeError(f"{token!r}: date is in the future")


def parse_currency(text: str) -> str:
    key = text.strip().upper()
    if key not in CURRENCIES:
        raise argparse.ArgumentTypeError(
            f"unknown currency {text!r}; use {', '.join(CURRENCIES)}")
    return key


def parse_unit(text: str) -> str:
    key = text.strip().lower().replace(" ", "")
    if key not in UNIT_ALIASES:
        raise argparse.ArgumentTypeError(
            f"unknown unit {text!r}; use USD, GB (goldback), GBD, or OZ")
    return UNIT_ALIASES[key]


# --------------------------------------------------------------------------- conversion


def to_oz(amount: float, unit: str, price: float) -> float:
    return {"USD": amount / price, "GB": amount / GB_PER_OZ,
            "GBD": amount / GBD_PER_OZ, "OZ": amount}[unit]


def from_oz(oz: float, price: float) -> dict:
    return {"USD": oz * price, "GB": oz * GB_PER_OZ, "GBD": oz * GBD_PER_OZ, "OZ": oz}


def resolve(table: GoldTable, kind: str, anchor: dt.date,
            today: dt.date | None = None) -> dict:
    if kind == "day":
        return table.price_for_day(anchor)
    if kind == "month":
        return table.price_for_month(anchor.year, anchor.month, today)
    return table.price_for_year(anchor.year, today)


def convert(table: GoldTable, amount: float, src_unit: str, kind: str, anchor: dt.date,
            today: dt.date | None = None, currency: str = "USD",
            fx: FxRates | None = None) -> dict:
    """Resolve the price (and FX) and convert; the result is the `--json` payload.

    A non-USD `currency` (only with src_unit USD) is converted to USD at the FX rate
    for the same period first (USD-routing tenet), then to gold.
    """
    info = resolve(table, kind, anchor, today)
    price = info["price"]
    fx_out = {k: None for k in FX_KEYS}
    usd_amount = amount
    if currency != "USD":
        if src_unit != "USD":
            raise ValueError("a non-USD currency is only valid with --from USD")
        if fx is None:
            raise LookupError(f"no FX data loaded for {currency}")
        got = resolve_fx(fx, currency, kind, anchor, today)
        usd_amount = amount * got["rate"]
        fx_out = {"fx_rate": got["rate"], "fx_effective": got["effective"],
                  "fx_mode": got["mode"], "fx_note": got["note"]}
    oz = to_oz(usd_amount, src_unit, price)
    out = from_oz(oz, price)
    return {
        "input": {"amount": amount, "unit": src_unit, "currency": currency,
                  "period": info["effective"], "granularity": info["granularity"]},
        "effective": info["effective"], "granularity": info["granularity"],
        "points": info["points"], "gold_usd_per_oz": price,
        "price_source": info["source"], "note": info["note"],
        "troy_oz": oz, "GB": out["GB"], "GBD": out["GBD"], "USD": out["USD"],
        **fx_out,
        "price_note": info["note"], "price_points": info["points"],
    }


def fmt_money(x: float) -> str:
    return f"{x:,.2f}"


def fmt_unit(x: float) -> str:
    if abs(x) >= 100:
        return f"{x:,.2f}"
    if abs(x) >= 1:
        return f"{x:,.4f}"
    return f"{x:,.6f}"


def fixed(x: float, digits: int) -> str:
    """Fixed-point text without exponents, so CSV output is portable byte-for-byte."""
    return f"{x + 0.0:.{digits}f}"


# --------------------------------------------------------------------------- batch


def batch_layout(header: list[str]) -> tuple[int, int, int | None, list[tuple[str, int]]]:
    """Return (date index, amount index, label index or None, [(name, index)] passthrough).

    Rules (spec FR14, plus the "dedupe rule" of plan Phase 2):
    - Header names compare trimmed and case-insensitively; when a name repeats, the
      first column wins and later ones are dropped.
    - Computed export columns and `currency` are ignored when picking the date and
      amount columns and never pass through. `USD` is also a legacy alias for the
      amount column, so it counts as computed only when the header carries other
      export columns (`troy_oz` or `gold_usd_per_oz`).
    - Passthrough columns whose names collide with any output column (FR15 fixed or
      computed names) are dropped, so the output header never repeats a name.
    """
    first: dict[str, int] = {}
    for idx, name in enumerate(header):
        first.setdefault(name.strip().lower(), idx)
    exported = "troy_oz" in first or "gold_usd_per_oz" in first
    computed = {c.lower() for c in COMPUTED_COLUMNS}
    ignored = (computed - ({"usd"} if not exported else set())) | {"currency"}
    reserved = computed | {c.lower() for c in BATCH_FIXED_COLUMNS}

    def pick(names: tuple[str, ...]) -> int | None:
        return next((first[k] for k in names if k in first and k not in ignored), None)

    date_idx = pick(("date", "period", "month", "year"))
    amt_idx = pick(("amount", "usd", "value", "price"))
    if date_idx is None or amt_idx is None:
        sys.exit("error: --batch CSV needs a 'date' column and an 'amount' column")
    label_idx = first.get("label")
    used = {date_idx, amt_idx, label_idx}
    passthrough = [(header[idx], idx) for key, idx in first.items()
                   if idx not in used and key not in reserved]
    passthrough.sort(key=lambda item: item[1])
    return date_idx, amt_idx, label_idx, passthrough


def _field(row: list[str], idx: int | None) -> str:
    return row[idx] if idx is not None and idx < len(row) else ""


def run_batch(path: str, src_unit: str, lbma_path: Path, monthly_path: Path,
              currency: str = "USD", fx: FxRates | None = None) -> int:
    """Read CSV rows of date,amount and emit one CSV row per input (spec FR15 schema)."""
    try:
        fh = (sys.stdin if path == "-"
              else open(path, newline="", encoding="utf-8-sig"))
    except OSError as exc:
        sys.exit(f"error: cannot read {path}: {exc}")
    with fh:
        reader = csv.reader(fh)
        header = next(reader, None)
        if header is None:
            sys.exit("error: --batch CSV is empty")
        header = [header[0].lstrip("\ufeff"), *header[1:]] if header else header
        date_idx, amt_idx, label_idx, extra = batch_layout(header)
        rows = [(reader.line_num, r) for r in reader if r]

    today = today_date()
    table = GoldTable(lbma_path, monthly_path)
    parsed = []
    for line, r in rows:
        token = _field(r, date_idx)
        try:
            kind, anchor = parse_period(token)
            check_not_future(anchor, token, today)
            parsed.append(((kind, anchor), parse_amount(_field(r, amt_idx)), r))
        except argparse.ArgumentTypeError as exc:
            sys.exit(f"error: line {line}: {exc}")
    if parsed:
        latest = max(anchor for (_, anchor), _, _ in parsed)
        table.ensure_covers(latest)
        if fx is not None:
            fx.ensure_covers(latest)

    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", newline="\n")
        except (ValueError, OSError):
            pass
    w = csv.writer(sys.stdout, lineterminator="\n")
    w.writerow([*BATCH_FIXED_COLUMNS, *(name for name, _ in extra), *COMPUTED_COLUMNS])
    for (kind, anchor), amount, r in parsed:
        try:
            res = convert(table, amount, src_unit, kind, anchor, today, currency, fx)
        except LookupError as exc:
            print(f"warning: {exc}; row skipped", file=sys.stderr)
            continue
        w.writerow([
            _field(r, date_idx), _field(r, amt_idx),
            currency if currency != "USD" else src_unit,
            _field(r, label_idx),
            *(_field(r, idx) for _, idx in extra),
            res["effective"], fixed(res["gold_usd_per_oz"], 4), fixed(res["troy_oz"], 6),
            fixed(res["GB"], 3), fixed(res["GBD"], 4), fixed(res["USD"], 2),
            res["price_source"], res["granularity"], res["note"],
            "" if res["fx_rate"] is None else fixed(res["fx_rate"], 6),
            *[("" if res[k] is None else res[k])
              for k in ("fx_effective", "fx_mode", "fx_note")],
        ])
    return 0


# --------------------------------------------------------------------------- vectors

VECTOR_DEFAULTS = {"from": "USD", "currency": "USD"}
VECTOR_FIELDS = ("effective", "granularity", "points", "gold_usd_per_oz", "price_source",
                 "note", "troy_oz", "GB", "GBD", "USD", *FX_KEYS)


def _case_today(case: dict, defaults: dict) -> dt.date:
    try:
        return dt.date.fromisoformat(case.get("today", defaults["today"]))
    except (KeyError, ValueError) as exc:
        sys.exit(f"error: cases need an ISO 'today' (per case or in defaults): {exc}")


def write_json(path: str, payload) -> None:
    with open(path, "w", newline="", encoding="utf-8") as fh:
        fh.write(json.dumps(payload, sort_keys=True, indent=2) + "\n")


def run_vectors(cases_path: str, vectors_out: str | None, dates_out: str | None,
                lbma_path: Path, monthly_path: Path) -> int:
    """Emit golden vectors (spec 5.7) and/or the date accept/reject oracle.

    Reads a committed case list, resolves it against whatever tables the cache
    directory holds (point GOLD_PRICE_CACHE_DIR at the pinned snapshot), and never
    uses the network. The `today` keyword is excluded from vectors: every case has an
    explicit `today`, so output does not depend on the clock.
    """
    try:
        with open(cases_path, encoding="utf-8") as fh:
            cases = json.load(fh)
    except (OSError, ValueError) as exc:
        sys.exit(f"error: cannot read cases file {cases_path}: {exc}")
    defaults = {**VECTOR_DEFAULTS, **cases.get("defaults", {})}
    if vectors_out:
        table = GoldTable(lbma_path, monthly_path)
        currencies = {case.get("currency", defaults["currency"]).upper()
                      for case in cases.get("vectors", [])}
        fx = None
        if fx_sources_for(currencies):
            paths = ensure_fx_cache(fx_sources_for(currencies))
            fx = FxRates(paths)
        vectors = []
        for case in cases.get("vectors", []):
            name = case.get("name", case.get("date"))
            today = _case_today(case, defaults)
            unit = parse_unit(case.get("from", defaults["from"]))
            try:
                currency = parse_currency(case.get("currency", defaults["currency"]))
                if case["date"].strip().lower() in ("today", "now", "latest"):
                    raise argparse.ArgumentTypeError("the 'today' keyword is excluded from vectors")
                amount = parse_amount(str(case["amount"]))
                kind, anchor = parse_period(case["date"], today)
                check_not_future(anchor, case["date"], today)
                res = convert(table, amount, unit, kind, anchor, today, currency, fx)
            except (argparse.ArgumentTypeError, LookupError, KeyError, ValueError) as exc:
                sys.exit(f"error: vector {name!r}: {exc}")
            vectors.append({
                "name": name,
                "family": case.get("family", ""),
                "input": {"amount": amount, "date": case["date"], "from": unit,
                          "currency": currency, "today": str(today)},
                "expected": {k: res[k] for k in VECTOR_FIELDS},
            })
        write_json(vectors_out, vectors)
    if dates_out:
        today = _case_today({}, defaults)
        accept, reject = [], []
        for text in cases.get("dates", []):
            try:
                kind, anchor = parse_period(text, today)
            except argparse.ArgumentTypeError:
                reject.append(text)
            else:
                accept.append({"input": text, "kind": kind, "anchor": str(anchor)})
        write_json(dates_out, {"today": str(today), "accept": accept, "reject": reject})
    return 0


# --------------------------------------------------------------------------- main


def main(argv: list[str] | None = None) -> int:
    global _no_refresh
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(errors="backslashreplace")
        except (ValueError, OSError):
            pass
    ap = argparse.ArgumentParser(
        description="Convert dated USD amounts to goldbacks (GB) / gold-backed dollars (GBD).")
    ap.add_argument("values", nargs="*", metavar="AMOUNT DATE",
                    help="AMOUNT (e.g. 1500 or $1,500) and DATE "
                         "(YYYY | YYYY-MM | YYYY-MM-DD | 'Mar 1975' | today); "
                         "with --price-only give DATE alone")
    ap.add_argument("--from", dest="src_unit", type=parse_unit, default="USD",
                    help="unit of AMOUNT: USD (default), GB, GBD, OZ")
    ap.add_argument("--currency", type=parse_currency, default="USD", metavar="CCY",
                    help="currency of AMOUNT (and of --batch rows): USD (default), EUR, GBP, "
                         "CHF, DEM; converted to USD at the historical FX rate first "
                         "(needs --from USD)")
    ap.add_argument("--to", dest="dst_unit", type=parse_unit, default=None,
                    help="restrict output to one unit (GB, GBD, USD, OZ)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--refresh", action="store_true", help="force re-download of price tables")
    ap.add_argument("--no-refresh", action="store_true",
                    help="never use the network or refresh a stale cache "
                         "(same as GOLDVALUE_OFFLINE=1)")
    ap.add_argument("--fetch-only", action="store_true",
                    help="(pre)fetch the gold and FX tables into the cache and exit")
    ap.add_argument("--price-only", action="store_true",
                    help="print only the resolved gold price for DATE")
    ap.add_argument("--vectors", metavar="OUT.json",
                    help="write golden test vectors for the cases in --cases, resolved "
                         "offline against the cache directory (test tooling)")
    ap.add_argument("--dates-oracle", metavar="OUT.json",
                    help="write the date accept/reject oracle for the strings in --cases")
    ap.add_argument("--cases", metavar="FILE", help="case list for --vectors/--dates-oracle")
    ap.add_argument("--batch", metavar="FILE",
                    help="re-denominate a time series: CSV with 'date' and 'amount' "
                         "columns ('-' for stdin); writes CSV to stdout")
    args = ap.parse_args(argv)
    generating = bool(args.vectors or args.dates_oracle)
    _no_refresh = args.no_refresh or generating
    if generating and not args.cases:
        ap.error("--vectors and --dates-oracle need --cases FILE")
    if args.currency != "USD" and args.src_unit != "USD":
        ap.error("--currency EUR|GBP|CHF|DEM is only valid with --from USD")
    if args.currency != "USD" and args.price_only:
        ap.error("--currency does not apply to --price-only")

    lbma_path, monthly_path = ensure_cache(force=args.refresh, quiet=args.json)
    if generating:
        return run_vectors(args.cases, args.vectors, args.dates_oracle, lbma_path, monthly_path)
    sources = sorted(FX_SERIES) if args.fetch_only else fx_sources_for([args.currency])
    fx_paths = ensure_fx_cache(sources, force=args.refresh, quiet=args.json)
    if args.fetch_only:
        print(f"cache ready in {cache_dir()}")
        return 0
    fx = FxRates(fx_paths) if args.currency != "USD" else None
    if args.batch:
        return run_batch(args.batch, args.src_unit, lbma_path, monthly_path,
                         args.currency, fx)
    today = today_date()
    try:
        if args.price_only:
            if len(args.values) != 1:
                ap.error("--price-only takes exactly one DATE argument")
            args.amount, args.date = None, parse_period(args.values[0])
            token = args.values[0]
        else:
            if len(args.values) != 2:
                ap.error("expected AMOUNT and DATE (or use --fetch-only / --price-only)")
            args.amount = parse_amount(args.values[0])
            args.date = parse_period(args.values[1])
            token = args.values[1]
        check_not_future(args.date[1], token, today)
    except argparse.ArgumentTypeError as exc:
        ap.error(str(exc))

    kind, anchor = args.date
    table = GoldTable(lbma_path, monthly_path)
    table.ensure_covers(anchor)
    if fx is not None:
        fx.ensure_covers(anchor)
    try:
        if args.price_only:
            info = resolve(table, kind, anchor, today)
        else:
            res = convert(table, args.amount, args.src_unit, kind, anchor, today,
                          args.currency, fx)
    except LookupError as exc:
        sys.exit(f"error: {exc}")

    if args.price_only:
        price = info["price"]
        if args.json:
            print(json.dumps({"gold_usd_per_oz": price, "price_source": info["source"],
                              **info}, indent=2))
        else:
            print(f"Gold price for {info['effective']}: ${fmt_money(price)}/troy oz "
                  f"[{info['source']}; granularity: {info['granularity']}; {info['note']}]")
        return 0

    if args.json:
        print(json.dumps(res, indent=2))
        return 0

    price = res["gold_usd_per_oz"]
    out = {"GB": res["GB"], "GBD": res["GBD"], "OZ": res["troy_oz"], "USD": res["USD"]}
    usd_label = (f"${fmt_money(args.amount)}" if args.currency == "USD"
                 else f"{fmt_money(args.amount)} {args.currency}")
    src_label = {"USD": usd_label, "GB": f"{fmt_unit(args.amount)} GB",
                 "GBD": f"{fmt_unit(args.amount)} GBD", "OZ": f"{fmt_unit(args.amount)} oz"}
    print(f"{src_label[args.src_unit]} on {res['effective']} "
          f"@ ${fmt_money(price)}/troy oz [{res['price_source']}]")
    print(f"  granularity: {res['granularity']}; note: {res['note']}")
    if res["fx_mode"] is not None:
        print(f"  fx: 1 {args.currency} = ${res['fx_rate']:.6f} USD "
              f"(effective {res['fx_effective']}; fx_mode: {res['fx_mode']})")
        if res["fx_note"]:
            print(f"  fx note: {res['fx_note']}")
    if args.dst_unit in (None, "GB"):
        print(f"  = {fmt_unit(out['GB'])} GB   (goldbacks, 1/1000 oz)")
    if args.dst_unit in (None, "GBD"):
        print(f"  = {fmt_unit(out['GBD'])} GBD  (gold-backed dollars, 50/oz)")
    if args.dst_unit in (None, "OZ"):
        print(f"  = {fmt_unit(out['OZ'])} troy oz")
    if args.dst_unit == "USD" or (args.dst_unit is None
                                  and (args.src_unit != "USD" or args.currency != "USD")):
        print(f"  = ${fmt_money(out['USD'])} USD")
    return 0


if __name__ == "__main__":
    sys.exit(main())
