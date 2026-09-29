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

Test hooks (environment)
  GOLDVALUE_TODAY=YYYY-MM-DD  override "today" (the `today` keyword, the future-date
                              check, and the month/year-to-date notes)
  GOLDVALUE_OFFLINE=1         never touch the network and never refresh a stale cache
                              (same as --no-refresh); missing cache files are an error
"""

from __future__ import annotations

import argparse
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
        if offline():
            if force:
                sys.exit("error: --refresh cannot be combined with offline mode")
            if not path.exists():
                sys.exit(f"error: offline mode and the {label} cache is missing: {path}")
            continue
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
            today: dt.date | None = None) -> dict:
    """Resolve the price and convert; the result is the `--json` payload."""
    info = resolve(table, kind, anchor, today)
    price = info["price"]
    oz = to_oz(amount, src_unit, price)
    out = from_oz(oz, price)
    return {
        "input": {"amount": amount, "unit": src_unit,
                  "period": info["effective"], "granularity": info["granularity"]},
        "effective": info["effective"], "granularity": info["granularity"],
        "points": info["points"], "gold_usd_per_oz": price,
        "price_source": info["source"], "note": info["note"],
        "troy_oz": oz, "GB": out["GB"], "GBD": out["GBD"], "USD": out["USD"],
        **{k: None for k in FX_KEYS},
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


def batch_layout(fieldnames: list[str]) -> tuple[str, str, str | None, list[str]]:
    """Return (date column, amount column, label column or None, passthrough columns).

    Computed export columns and `currency` are ignored on input (spec FR14). `USD`
    is also a legacy alias for the amount column, so it is treated as computed only
    when the header carries other export columns (`troy_oz` or `gold_usd_per_oz`).
    """
    lowered: dict[str, str] = {}
    for c in fieldnames:
        lowered.setdefault(c.strip().lower(), c)
    exported = "troy_oz" in lowered or "gold_usd_per_oz" in lowered
    ignored = {c.lower() for c in COMPUTED_COLUMNS}
    if not exported:
        ignored.discard("usd")
    ignored.add("currency")

    def first(names: tuple[str, ...]) -> str | None:
        return next((lowered[k] for k in names if k in lowered and k not in ignored), None)

    date_col = first(("date", "period", "month", "year"))
    amt_col = first(("amount", "usd", "value", "price"))
    if not date_col or not amt_col:
        sys.exit("error: --batch CSV needs a 'date' column and an 'amount' column")
    label_col = lowered.get("label")
    passthrough = [c for c in fieldnames
                   if c not in (date_col, amt_col, label_col)
                   and c.strip().lower() not in ignored]
    return date_col, amt_col, label_col, passthrough


def run_batch(path: str, src_unit: str, lbma_path: Path, monthly_path: Path) -> int:
    """Read CSV rows of date,amount and emit one CSV row per input (spec FR15 schema)."""
    try:
        fh = (sys.stdin if path == "-"
              else open(path, newline="", encoding="utf-8-sig"))
    except OSError as exc:
        sys.exit(f"error: cannot read {path}: {exc}")
    with fh:
        reader = csv.DictReader(fh)
        fieldnames = [c.lstrip("\ufeff") for c in (reader.fieldnames or [])]
        if not fieldnames:
            sys.exit("error: --batch CSV is empty")
        reader.fieldnames = fieldnames
        date_col, amt_col, label_col, extra = batch_layout(fieldnames)
        rows = [(reader.line_num, r) for r in reader]

    today = today_date()
    table = GoldTable(lbma_path, monthly_path)
    parsed = []
    for line, r in rows:
        token = r.get(date_col) or ""
        try:
            kind, anchor = parse_period(token)
            check_not_future(anchor, token, today)
            parsed.append(((kind, anchor), parse_amount(r.get(amt_col)), r))
        except argparse.ArgumentTypeError as exc:
            sys.exit(f"error: line {line}: {exc}")
    if parsed:
        table.ensure_covers(max(anchor for (_, anchor), _, _ in parsed))

    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(newline="\n")
        except (ValueError, OSError):
            pass
    w = csv.writer(sys.stdout, lineterminator="\n")
    w.writerow([*BATCH_FIXED_COLUMNS, *extra, *COMPUTED_COLUMNS])
    for (kind, anchor), amount, r in parsed:
        try:
            res = convert(table, amount, src_unit, kind, anchor, today)
        except LookupError as exc:
            print(f"warning: {exc}; row skipped", file=sys.stderr)
            continue
        w.writerow([
            r.get(date_col) or "", r.get(amt_col) or "", src_unit,
            (r.get(label_col) or "") if label_col else "",
            *((r.get(c) or "") for c in extra),
            res["effective"], fixed(res["gold_usd_per_oz"], 4), fixed(res["troy_oz"], 6),
            fixed(res["GB"], 3), fixed(res["GBD"], 4), fixed(res["USD"], 2),
            res["price_source"], res["granularity"], res["note"],
            *[("" if res[k] is None else res[k]) for k in FX_KEYS],
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
        vectors = []
        for case in cases.get("vectors", []):
            name = case.get("name", case.get("date"))
            today = _case_today(case, defaults)
            unit = parse_unit(case.get("from", defaults["from"]))
            try:
                if case["date"].strip().lower() in ("today", "now", "latest"):
                    raise argparse.ArgumentTypeError("the 'today' keyword is excluded from vectors")
                amount = parse_amount(str(case["amount"]))
                kind, anchor = parse_period(case["date"], today)
                check_not_future(anchor, case["date"], today)
                res = convert(table, amount, unit, kind, anchor, today)
            except (argparse.ArgumentTypeError, LookupError, KeyError) as exc:
                sys.exit(f"error: vector {name!r}: {exc}")
            vectors.append({
                "name": name,
                "family": case.get("family", ""),
                "input": {"amount": amount, "date": case["date"], "from": unit,
                          "currency": defaults["currency"], "today": str(today)},
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
    ap.add_argument("--no-refresh", action="store_true",
                    help="never use the network or refresh a stale cache "
                         "(same as GOLDVALUE_OFFLINE=1)")
    ap.add_argument("--fetch-only", action="store_true",
                    help="(pre)fetch the price tables into the cache and exit")
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

    lbma_path, monthly_path = ensure_cache(force=args.refresh, quiet=args.json)
    if generating:
        return run_vectors(args.cases, args.vectors, args.dates_oracle, lbma_path, monthly_path)
    if args.fetch_only:
        print(f"cache ready in {cache_dir()}")
        return 0
    if args.batch:
        return run_batch(args.batch, args.src_unit, lbma_path, monthly_path)
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
    try:
        if args.price_only:
            info = resolve(table, kind, anchor, today)
        else:
            res = convert(table, args.amount, args.src_unit, kind, anchor, today)
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
    src_label = {"USD": f"${fmt_money(args.amount)}", "GB": f"{fmt_unit(args.amount)} GB",
                 "GBD": f"{fmt_unit(args.amount)} GBD", "OZ": f"{fmt_unit(args.amount)} oz"}
    print(f"{src_label[args.src_unit]} on {res['effective']} "
          f"@ ${fmt_money(price)}/troy oz [{res['price_source']}]")
    print(f"  granularity: {res['granularity']}; note: {res['note']}")
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
