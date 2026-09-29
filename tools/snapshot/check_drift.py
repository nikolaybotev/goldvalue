#!/usr/bin/env python3
"""Compare the live price sources with the synthetic fixture's *shape*.

Used by the non-blocking weekly-drift workflow. The fixture holds made-up prices
(spec D15), so values are never compared; this checks that the live endpoints still
have the structure the fixture and the code assume: JSON keys and value arity, CORS
headers, CSV headers, AM-only start, the 1968 London closure gap, weekday-only rows,
and freshness. LBMA data is downloaded into memory or a temporary directory only and
is never stored in the repository.

Exit status 1 means drift; the workflow reports it without failing the build.
Standard library only.
"""

from __future__ import annotations

import csv
import datetime as dt
import importlib.util
import json
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "test-vectors" / "snapshot"
CLI = ROOT / ".agents/skills/gold-value-normalizer/scripts/goldvalue.py"

problems: list[str] = []


def check(ok: bool, message: str) -> None:
    print(("ok    " if ok else "DRIFT ") + message)
    if not ok:
        problems.append(message)


def get(url: str) -> tuple[bytes, dict]:
    req = urllib.request.Request(url, headers={"User-Agent": "goldvalue-drift/1.0",
                                               "Origin": "https://nikolaybotev.github.io"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read(), {k.lower(): v for k, v in resp.headers.items()}


def load_cli():
    spec = importlib.util.spec_from_file_location("goldvalue_cli", CLI)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def dates_in(rows, lo: str, hi: str) -> list[str]:
    return sorted(d for d in rows if lo <= d <= hi)


def check_lbma(cli) -> None:
    today = dt.date.today()
    for name, url, first in (("pm", cli.LBMA_PM_URL, "1968-04-01"),
                             ("am", cli.LBMA_AM_URL, "1968-01-02")):
        body, headers = get(url)
        live = json.loads(body)
        fixture = json.loads((FIXTURE / f"gold_{name}.json").read_text(encoding="utf-8"))
        check(headers.get("access-control-allow-origin") in ("*", "https://nikolaybotev.github.io"),
              f"gold_{name}.json sends a permissive Access-Control-Allow-Origin")
        check(isinstance(live, list) and live and set(live[0]) == set(fixture[0]),
              f"gold_{name}.json rows have keys {sorted(fixture[0])}")
        check(len(live[0]["v"]) == len(fixture[0]["v"]),
              f"gold_{name}.json 'v' has {len(fixture[0]['v'])} entries (usd, gbp, eur)")
        check(live[0]["d"] == first, f"gold_{name}.json starts at {first} (got {live[0]['d']})")
        last = dt.date.fromisoformat(live[-1]["d"])
        check((today - last).days <= 10, f"gold_{name}.json is fresh (last fix {last})")


def check_cache_shape(cli) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        live_path = Path(tmp) / "lbma_daily.csv"
        cli.fetch_lbma(live_path)
        with live_path.open(newline="") as fh:
            live = {r["date"]: r for r in csv.DictReader(fh)}
    with (FIXTURE / "lbma_daily.csv").open(newline="") as fh:
        fixture = {r["date"]: r for r in csv.DictReader(fh)}
    first = min(live)
    check(first == min(fixture), f"daily table starts {min(fixture)} (got {first})")
    check(not dates_in(live, "1968-03-15", "1968-03-31"),
          "no fixes 1968-03-15 to 1968-03-31 (London closure), as in the fixture")
    check(bool(dates_in(live, "1968-04-01", "1968-04-01")), "fixes resume on 1968-04-01")
    check(all(not live[d]["usd_pm"] for d in dates_in(live, "1968-01-01", "1968-03-31")),
          "Jan-Mar 1968 has no PM fixes")
    check(all(dt.date.fromisoformat(d).weekday() < 5 for d in live), "all fixes fall on weekdays")


def check_monthly(cli) -> None:
    body, headers = get(cli.MONTHLY_URL)
    lines = body.decode("utf-8").splitlines()
    check(lines[0].strip() == "Date,Price", f"monthly.csv header is Date,Price (got {lines[0]!r})")
    check(headers.get("access-control-allow-origin") in ("*", "https://nikolaybotev.github.io"),
          "monthly.csv sends a permissive Access-Control-Allow-Origin")
    last = lines[-1].split(",")[0]
    year, month = (int(x) for x in last.split("-"))
    today = dt.date.today()
    check((today.year - year) * 12 + today.month - month <= 3, f"monthly.csv is fresh (last {last})")


def main() -> int:
    cli = load_cli()
    for step in (check_lbma, check_cache_shape, check_monthly):
        try:
            step(cli)
        except Exception as exc:  # network or parse failure is drift too
            check(False, f"{step.__name__} raised {type(exc).__name__}: {exc}")
    print(f"\n{len(problems)} drift finding(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
