#!/usr/bin/env python3
"""Regenerate every generated file under test-vectors/ from committed inputs.

Run from anywhere: `python3 test-vectors/regenerate.py`. CI re-runs it and fails if
`git status` shows any difference, which is the determinism check for the fixture,
the golden vectors (AC7) and the batch outputs.

Inputs (committed, hand-written): cases.json, fx-cases.json, batch-*-in.csv.
Outputs (generated): snapshot/*, gold-usd.json, fx.json, dates.json, batch-*-out.csv.
A batch input named `batch-fx-<ccy>-in.csv` (for example `batch-fx-eur-in.csv`) is run
with `--currency <CCY>`; every other batch input runs in USD.
The pinned "today" comes from cases.json defaults, so nothing depends on the clock.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / ".agents/skills/gold-value-normalizer/scripts/goldvalue.py"

sys.path.insert(0, str(HERE))
import make_fixture  # noqa: E402


def run_cli(env: dict, *args: str) -> bytes:
    result = subprocess.run([sys.executable, str(SCRIPT), *args], env=env, cwd=HERE,
                            capture_output=True, check=False)
    if result.returncode != 0:
        sys.stderr.write(result.stderr.decode("utf-8", "replace"))
        sys.exit(f"goldvalue.py {' '.join(args)} failed ({result.returncode})")
    return result.stdout


def main() -> None:
    snapshot = HERE / "snapshot"
    make_fixture.generate(snapshot)
    today = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))["defaults"]["today"]
    env = {**os.environ, "GOLD_PRICE_CACHE_DIR": str(snapshot), "GOLDVALUE_TODAY": today,
           "GOLDVALUE_OFFLINE": "1"}
    run_cli(env, "--vectors", "gold-usd.json", "--dates-oracle", "dates.json",
            "--cases", "cases.json")
    run_cli(env, "--vectors", "fx.json", "--cases", "fx-cases.json")
    for source in sorted(HERE.glob("batch-*-in.csv")):
        out = source.with_name(source.name.replace("-in.csv", "-out.csv"))
        fx = re.fullmatch(r"batch-fx-([a-z]{3})-in\.csv", source.name)
        extra = ["--currency", fx.group(1).upper()] if fx else []
        out.write_bytes(run_cli(env, "--batch", str(source), *extra))
        print(f"wrote {out.relative_to(HERE.parent)}")


if __name__ == "__main__":
    main()
