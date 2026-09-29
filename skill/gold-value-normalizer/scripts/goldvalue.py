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

Only the Python standard library is required.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
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

UNIT_ALIASES = {
    "usd": "USD", "$": "USD", "dollar": "USD", "dollars": "USD",
    "gb": "GB", "goldback": "GB", "goldbacks": "GB",
    "gbd": "GBD", "gold-backed-dollar": "GBD", "goldbackeddollar": "GBD",
    "oz": "OZ", "ozt": "OZ", "troyoz": "OZ", "ounce": "OZ", "ounces": "OZ",
}


# --------------------------------------------------------------------------- cache


def cache_dir() -> Path:
    override = os.environ.get("GOLD_PRICE_CACHE_DIR")
    base = Path(override) if override else Path.home() / ".cache" / "gold-value"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _download(url: str) -> bytes:
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


def ensure_cache(force: bool = False, quiet: bool = False) -> tuple[Path, Path]:
    d = cache_dir()
    lbma, monthly = d / "lbma_daily.csv", d / "monthly.csv"
    for path, fetch, label in (
        (lbma, fetch_lbma, "LBMA daily fixes"),
        (monthly, fetch_monthly, "monthly series"),
    ):
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
    return lbma, monthly


def refresh_if_stale(path: Path, fetch, label: str) -> None:
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
        with self.lbma_path.open() as fh:
            for r in csv.DictReader(fh):
                v = r["usd_pm"] or r["usd_am"]
                if v:
                    self.daily[dt.date.fromisoformat(r["date"])] = float(v)
        self.monthly.clear()
        with self.monthly_path.open() as fh:
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
            for back in range(0, 10):
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
            return dict(price=self.monthly[key], granularity="month",
                        effective=f"{day.year}-{day.month:02d}", points=1,
                        source=self._monthly_source(day.year),
                        note="no daily data before 1968; used the monthly price")
        raise LookupError(f"no gold price data for {day}")

    def price_for_month(self, year: int, month: int) -> dict:
        fixes = [p for d, p in self.daily.items() if (d.year, d.month) == (year, month)]
        if fixes:
            return dict(price=statistics.fmean(fixes), granularity="month",
                        effective=f"{year}-{month:02d}", points=len(fixes),
                        source="LBMA",
                        note=f"average of {len(fixes)} LBMA daily fixes")
        if (year, month) in self.monthly:
            return dict(price=self.monthly[(year, month)], granularity="month",
                        effective=f"{year}-{month:02d}", points=1,
                        source=self._monthly_source(year),
                        note="monthly series value")
        raise LookupError(f"no gold price data for {year}-{month:02d}")

    def price_for_year(self, year: int) -> dict:
        fixes = [p for d, p in self.daily.items() if d.year == year]
        if fixes:
            partial = "" if year < self.last_daily.year else " (year to date)"
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


# --------------------------------------------------------------------------- parsing


def parse_period(text: str) -> tuple[str, dt.date]:
    """Return ("day"|"month"|"year", anchor date)."""
    s = text.strip()
    low = s.lower()
    if low in ("today", "now", "latest"):
        return "day", dt.date.today()
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
    if s.isdigit() and len(s) == 4:
        return "year", dt.date(int(s), 1, 1)
    raise argparse.ArgumentTypeError(
        f"unrecognised date {text!r}; use YYYY, YYYY-MM, YYYY-MM-DD, 'Mar 1975', 'today'")


def parse_amount(text: str) -> float:
    cleaned = text.replace(",", "").replace("$", "").replace("_", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        raise argparse.ArgumentTypeError(f"invalid amount {text!r}")


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


def resolve(table: GoldTable, kind: str, anchor: dt.date) -> dict:
    if kind == "day":
        return table.price_for_day(anchor)
    if kind == "month":
        return table.price_for_month(anchor.year, anchor.month)
    return table.price_for_year(anchor.year)


def fmt_money(x: float) -> str:
    return f"{x:,.2f}"


def fmt_unit(x: float) -> str:
    if abs(x) >= 100:
        return f"{x:,.2f}"
    if abs(x) >= 1:
        return f"{x:,.4f}"
    return f"{x:,.6f}"


# --------------------------------------------------------------------------- batch


def run_batch(path: str, src_unit: str, lbma_path: Path, monthly_path: Path) -> int:
    """Read CSV rows of date,amount and emit one CSV row per input with gold values."""
    fh = sys.stdin if path == "-" else open(path, newline="")
    with fh:
        reader = csv.DictReader(fh)
        cols = {c.lower().strip(): c for c in reader.fieldnames or []}
        date_col = next((cols[k] for k in ("date", "period", "month", "year") if k in cols), None)
        amt_col = next((cols[k] for k in ("amount", "usd", "value", "price") if k in cols), None)
        if not date_col or not amt_col:
            sys.exit("error: --batch CSV needs a 'date' column and an 'amount' column")
        rows = list(reader)

    table = GoldTable(lbma_path, monthly_path)
    parsed = []
    for i, r in enumerate(rows, start=2):
        try:
            parsed.append((parse_period(r[date_col]), parse_amount(r[amt_col]), r))
        except argparse.ArgumentTypeError as exc:
            sys.exit(f"error: line {i}: {exc}")
    if parsed:
        table.ensure_covers(max(anchor for (_, anchor), _, _ in parsed))

    extra = [c for c in (reader.fieldnames or []) if c not in (date_col, amt_col)]
    w = csv.writer(sys.stdout)
    w.writerow(["date", "effective", f"amount_{src_unit.lower()}", "gold_usd_per_oz",
                "troy_oz", "GB", "GBD", "USD", "price_source", *extra])
    for (kind, anchor), amount, r in parsed:
        try:
            info = resolve(table, kind, anchor)
        except LookupError as exc:
            print(f"warning: {exc}; row skipped", file=sys.stderr)
            continue
        oz = to_oz(amount, src_unit, info["price"])
        out = from_oz(oz, info["price"])
        w.writerow([r[date_col], info["effective"], amount, round(info["price"], 4),
                    round(oz, 6), round(out["GB"], 3), round(out["GBD"], 4),
                    round(out["USD"], 2), info["source"], *(r[c] for c in extra)])
    return 0


# --------------------------------------------------------------------------- main


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Convert dated USD amounts to goldbacks (GB) / gold-backed dollars (GBD).")
    ap.add_argument("values", nargs="*", metavar="AMOUNT DATE",
                    help="AMOUNT (e.g. 1500 or $1,500) and DATE "
                         "(YYYY | YYYY-MM | YYYY-MM-DD | 'Mar 1975' | today); "
                         "with --price-only give DATE alone")
    ap.add_argument("--from", dest="src_unit", type=parse_unit, default="USD",
                    help="unit of AMOUNT: USD (default), GB, GBD, OZ")
    ap.add_argument("--to", dest="dst_unit", type=parse_unit, default=None,
                    help="restrict output to one unit (GB, GBD, USD, OZ)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--refresh", action="store_true", help="force re-download of price tables")
    ap.add_argument("--fetch-only", action="store_true",
                    help="(pre)fetch the price tables into the cache and exit")
    ap.add_argument("--price-only", action="store_true",
                    help="print only the resolved gold price for DATE")
    ap.add_argument("--batch", metavar="FILE",
                    help="re-denominate a time series: CSV with 'date' and 'amount' "
                         "columns ('-' for stdin); writes CSV to stdout")
    args = ap.parse_args(argv)

    lbma_path, monthly_path = ensure_cache(force=args.refresh, quiet=args.json)
    if args.fetch_only:
        print(f"cache ready in {cache_dir()}")
        return 0
    if args.batch:
        return run_batch(args.batch, args.src_unit, lbma_path, monthly_path)
    try:
        if args.price_only:
            if len(args.values) != 1:
                ap.error("--price-only takes exactly one DATE argument")
            args.amount, args.date = None, parse_period(args.values[0])
        else:
            if len(args.values) != 2:
                ap.error("expected AMOUNT and DATE (or use --fetch-only / --price-only)")
            args.amount = parse_amount(args.values[0])
            args.date = parse_period(args.values[1])
    except argparse.ArgumentTypeError as exc:
        ap.error(str(exc))

    kind, anchor = args.date
    if anchor > dt.date.today():
        ap.error(f"{anchor} is in the future")

    table = GoldTable(lbma_path, monthly_path)
    table.ensure_covers(anchor)
    try:
        info = resolve(table, kind, anchor)
    except LookupError as exc:
        sys.exit(f"error: {exc}")
    price = info["price"]

    if args.price_only:
        if args.json:
            print(json.dumps({"gold_usd_per_oz": price, **info}, indent=2))
        else:
            print(f"Gold price for {info['effective']}: ${fmt_money(price)}/troy oz "
                  f"[{info['source']}; {info['note']}]")
        return 0

    oz = to_oz(args.amount, args.src_unit, price)
    out = from_oz(oz, price)

    if args.json:
        print(json.dumps({
            "input": {"amount": args.amount, "unit": args.src_unit,
                      "period": info["effective"], "granularity": info["granularity"]},
            "gold_usd_per_oz": round(price, 4),
            "price_source": info["source"], "price_note": info["note"],
            "price_points": info["points"],
            "troy_oz": oz, "GB": out["GB"], "GBD": out["GBD"], "USD": out["USD"],
        }, indent=2))
        return 0

    src_label = {"USD": f"${fmt_money(args.amount)}", "GB": f"{fmt_unit(args.amount)} GB",
                 "GBD": f"{fmt_unit(args.amount)} GBD", "OZ": f"{fmt_unit(args.amount)} oz"}
    print(f"{src_label[args.src_unit]} on {info['effective']} "
          f"@ ${fmt_money(price)}/troy oz [{info['source']}]")
    print(f"  {info['note']}")
    if args.dst_unit in (None, "GB"):
        print(f"  = {fmt_unit(out['GB'])} GB   (goldbacks, 1/1000 oz)")
    if args.dst_unit in (None, "GBD"):
        print(f"  = {fmt_unit(out['GBD'])} GBD  (gold-backed dollars, 50/oz)")
    if args.dst_unit in (None, "OZ"):
        print(f"  = {fmt_unit(out['OZ'])} troy oz")
    if args.dst_unit == "USD" or (args.dst_unit is None and args.src_unit != "USD"):
        print(f"  = ${fmt_money(out['USD'])} USD")
    return 0


if __name__ == "__main__":
    sys.exit(main())
