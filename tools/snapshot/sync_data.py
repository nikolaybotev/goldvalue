#!/usr/bin/env python3
"""Copy the freely licensed price tables into the web app's public data folder.

Publishes only `monthly.csv` (World Bank / NMA, PDDL) plus, from v1.1, `fx_*.csv`,
and writes `manifest.json`. `lbma_daily.csv` is NEVER copied or published (spec D15:
LBMA data is licensed by ICE Benchmark Administration); the visitor's browser
fetches LBMA itself.

By default the monthly series is fetched with the reference CLI's own fetcher into a
temporary directory; `--source-dir` uses an existing cache directory instead (tests,
offline runs). Files are copied byte for byte. The manifest carries no timestamp, so
unchanged data produces no diff. The run fails without writing anything if any file's
row count dropped by more than 1% relative to the previous manifest.

Standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / ".agents/skills/gold-value-normalizer/scripts/goldvalue.py"
DEFAULT_OUT = ROOT / "apps/web/public/data"
MAX_ROW_DROP = 0.01

PUBLISHABLE = (re.compile(r"monthly\.csv"), re.compile(r"fx_[a-z]{3}\.csv"))


def is_publishable(name: str) -> bool:
    if "lbma" in name.lower():
        return False
    return any(p.fullmatch(name) for p in PUBLISHABLE)


def load_cli():
    spec = importlib.util.spec_from_file_location("goldvalue_cli", CLI)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def describe(data: bytes) -> dict:
    lines = [ln for ln in data.decode("utf-8").splitlines() if ln.strip()]
    rows = lines[1:]
    return {
        "rows": len(rows),
        "last_date": rows[-1].split(",", 1)[0] if rows else "",
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def check_row_drop(previous: dict, current: dict) -> None:
    for name, old in previous.get("files", {}).items():
        new = current.get(name)
        if new is None:
            continue
        if new["rows"] < old["rows"] * (1 - MAX_ROW_DROP):
            sys.exit(f"error: {name} shrank from {old['rows']} to {new['rows']} rows "
                     f"(more than {MAX_ROW_DROP:.0%}); refusing to publish")


def sync(source: Path, out: Path, previous_manifest: Path | None = None) -> dict:
    files = {}
    for path in sorted(source.iterdir()):
        if path.is_file() and is_publishable(path.name):
            files[path.name] = path.read_bytes()
    if "monthly.csv" not in files:
        sys.exit(f"error: monthly.csv not found in {source}")
    header = files["monthly.csv"].decode("utf-8").splitlines()[0]
    if header.strip() != "month,usd":
        sys.exit(f"error: unexpected monthly.csv header {header!r}")

    described = {name: describe(data) for name, data in files.items()}
    prev = previous_manifest if previous_manifest is not None else out / "manifest.json"
    if prev.exists():
        check_row_drop(json.loads(prev.read_text(encoding="utf-8")), described)

    out.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (out / name).write_bytes(data)
    manifest = {"files": described}
    (out / "manifest.json").write_text(
        json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return manifest


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output directory")
    ap.add_argument("--source-dir", type=Path,
                    help="use this cache directory instead of fetching")
    ap.add_argument("--previous", type=Path,
                    help="previous manifest.json for the row-count guard "
                         "(default: OUT/manifest.json if present)")
    args = ap.parse_args(argv)
    if args.source_dir:
        manifest = sync(args.source_dir, args.out, args.previous)
    else:
        cli = load_cli()
        with tempfile.TemporaryDirectory() as tmp:
            cli.fetch_monthly(Path(tmp) / "monthly.csv")
            manifest = sync(Path(tmp), args.out, args.previous)
    for name, info in sorted(manifest["files"].items()):
        print(f"{name}: {info['rows']} rows, last {info['last_date']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
