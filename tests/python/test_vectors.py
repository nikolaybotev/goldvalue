"""Golden vectors, the date oracle, and the synthetic fixture (spec 5.7, D15)."""

from __future__ import annotations

import csv
import datetime as dt
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

from conftest import ROOT, SCRIPT

TV = ROOT / "test-vectors"
SNAPSHOT = TV / "snapshot"

REQUIRED_FAMILIES = {
    "annual-pre1960", "monthly-pre1968", "am-only-1968", "london-closure-boundary",
    "weekend-holiday-rollback", "month-and-year-means", "to-date-pinned-year",
    "after-latest-fix", "units-from", "negative-and-edge-amounts", "date-forms",
    "missing-single-fix",
}
EXPECTED_KEYS = {"effective", "granularity", "points", "gold_usd_per_oz", "price_source",
                 "note", "troy_oz", "GB", "GBD", "USD", "fx_rate", "fx_effective", "fx_mode",
                 "fx_note"}


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def make_fixture():
    return load_module(TV / "make_fixture.py", "make_fixture")


def test_fixture_regenerates_byte_identical(make_fixture, tmp_path):
    make_fixture.generate(tmp_path)
    for name in ("lbma_daily.csv", "monthly.csv", "gold_am.json", "gold_pm.json"):
        assert (tmp_path / name).read_bytes() == (SNAPSHOT / name).read_bytes(), name


def test_snapshot_csv_files_are_lf_only(make_fixture):
    for name in ("lbma_daily.csv", "monthly.csv"):
        assert b"\r" not in (SNAPSHOT / name).read_bytes()


def test_fixture_has_realistic_gaps():
    with (SNAPSHOT / "lbma_daily.csv").open(newline="") as fh:
        rows = {r["date"]: r for r in csv.DictReader(fh)}
    dates = sorted(rows)
    assert dates[0] == "1968-01-02" and dates[-1] == "2026-09-25"
    assert all(dt.date.fromisoformat(d).weekday() < 5 for d in dates)
    assert all(rows[d]["usd_am"] and not rows[d]["usd_pm"] for d in dates if d <= "1968-03-31")
    assert [d for d in dates if "1968-03-15" <= d <= "1968-03-31"] == []
    assert "1968-03-14" in rows and "1968-04-01" in rows
    assert rows["1968-04-01"]["usd_pm"]
    assert rows["1990-06-13"]["usd_pm"] == "" and rows["1990-06-13"]["usd_am"]
    assert rows["2002-09-11"]["usd_am"] == "" and rows["2002-09-11"]["usd_pm"]


def test_fixture_monthly_covers_1833_to_end():
    lines = (SNAPSHOT / "monthly.csv").read_text().splitlines()
    assert lines[0] == "month,usd"
    assert lines[1].startswith("1833-01,") and lines[-1].startswith("2026-09,")
    assert len(lines) - 1 == (2026 - 1833) * 12 + 9


def test_fixture_json_has_lbma_shape():
    for name, first in (("gold_pm.json", "1968-04-01"), ("gold_am.json", "1968-01-02")):
        rows = json.loads((SNAPSHOT / name).read_text())
        assert rows[0]["d"] == first
        assert set(rows[0]) == {"d", "v", "is_cms_locked"}
        assert len(rows[0]["v"]) == 3 and rows[0]["v"][2] is None
        modern = next(r for r in rows if r["d"] == "2000-01-04")
        assert all(isinstance(x, float) for x in modern["v"])


def test_fixture_is_not_real_lbma_data():
    """Anchor facts a real series would satisfy (e.g. the 1980 spike) must not hold."""
    with (SNAPSHOT / "lbma_daily.csv").open(newline="") as fh:
        pm = {r["date"]: float(r["usd_pm"] or r["usd_am"]) for r in csv.DictReader(fh)}
    assert max(pm.values()) < 4000
    assert pm["1980-01-21"] < 700  # the real 1980 peak fix was 850


def run_generator(tmp_path, *extra):
    env = {"GOLD_PRICE_CACHE_DIR": str(SNAPSHOT), "GOLDVALUE_TODAY": "2026-09-29",
           "GOLDVALUE_OFFLINE": "1", "PATH": ""}
    return subprocess.run(
        [sys.executable, str(SCRIPT), *extra], env=env, capture_output=True, text=True)


def test_vectors_regenerate_byte_identical(tmp_path):
    vectors, dates = tmp_path / "v.json", tmp_path / "d.json"
    result = run_generator(tmp_path, "--vectors", str(vectors), "--dates-oracle", str(dates),
                           "--cases", str(TV / "cases.json"))
    assert result.returncode == 0, result.stderr
    assert vectors.read_bytes() == (TV / "gold-usd.json").read_bytes()
    assert dates.read_bytes() == (TV / "dates.json").read_bytes()


def test_vectors_do_not_touch_the_network(tmp_path):
    result = run_generator(tmp_path, "--vectors", str(tmp_path / "v.json"),
                           "--refresh", "--cases", str(TV / "cases.json"))
    assert result.returncode != 0 and "offline" in result.stderr


def test_vectors_need_cases():
    result = run_generator(None, "--vectors", "/dev/null")
    assert result.returncode == 2 and "--cases" in result.stderr


def test_vector_file_format():
    text = (TV / "gold-usd.json").read_text()
    vectors = json.loads(text)
    assert text == json.dumps(vectors, sort_keys=True, indent=2) + "\n"
    assert {v["family"] for v in vectors} >= REQUIRED_FAMILIES
    for v in vectors:
        assert set(v["input"]) == {"amount", "date", "from", "currency", "today"}
        assert v["input"]["currency"] == "USD"
        assert v["input"]["from"] in ("USD", "GB", "GBD", "OZ")
        assert set(v["expected"]) == EXPECTED_KEYS
        assert v["input"]["date"].strip().lower() not in ("today", "now", "latest")
        assert v["expected"]["fx_rate"] is None and v["expected"]["fx_mode"] is None


def test_vectors_cover_spec_families_and_boundaries():
    by_name = {v["name"]: v["expected"] for v in json.loads((TV / "gold-usd.json").read_text())}
    assert by_name["1968-01-02 first fix"]["effective"] == "1968-01-02"
    assert by_name["1968-03-23 nine days after last fix"]["effective"] == "1968-03-14"
    assert by_name["1968-03-24 ten days after last fix"]["granularity"] == "month"
    assert by_name["1968-04-01 reopening"]["effective"] == "1968-04-01"
    assert by_name["2024-06-01 Saturday"]["effective"] == "2024-05-31"
    assert by_name["2024-06-02 Sunday"]["effective"] == "2024-05-31"
    assert by_name["2026 year to date"]["note"].endswith("(year to date)")
    assert by_name["2026-09 month to date"]["note"].endswith("(month to date)")
    assert not by_name["2026 after year end (no YTD note)"]["note"].endswith("(year to date)")
    assert by_name["2026-10-05 ten days after latest"]["note"].startswith(
        "requested date is after the latest available fix")
    assert by_name["1955 year"]["granularity"] == "year"
    assert by_name["1965-06 month"]["granularity"] == "month"
    assert by_name["-5000 USD"]["GB"] < 0


def test_vectors_units_are_consistent():
    for v in json.loads((TV / "gold-usd.json").read_text()):
        e, i = v["expected"], v["input"]
        assert e["GB"] == pytest.approx(e["troy_oz"] * 1000, rel=1e-12)
        assert e["GBD"] == pytest.approx(e["troy_oz"] * 50, rel=1e-12)
        assert e["USD"] == pytest.approx(e["troy_oz"] * e["gold_usd_per_oz"], rel=1e-12, abs=1e-12)
        if i["from"] == "USD":
            assert e["USD"] == pytest.approx(i["amount"], rel=1e-12, abs=1e-12)


def test_dates_oracle_matches_parser(gv):
    oracle = json.loads((TV / "dates.json").read_text())
    today = dt.date.fromisoformat(oracle["today"])
    assert len(oracle["accept"]) > 40 and len(oracle["reject"]) > 40
    for item in oracle["accept"]:
        kind, anchor = gv.parse_period(item["input"], today)
        assert (item["kind"], item["anchor"]) == (kind, str(anchor))
    for text in oracle["reject"]:
        with pytest.raises(Exception):
            gv.parse_period(text, today)
    accepted = {a["input"] for a in oracle["accept"]}
    assert {"today", "now", "latest", "2024-6-3", "3  June  2024"} <= accepted
    assert {"", "Sept 2024", "20240603", "٢٠٢٤"} <= set(oracle["reject"])


@pytest.mark.parametrize("stem", ["basic", "legacy", "crlf", "dedupe"])
def test_batch_outputs_regenerate(gv, stem, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GOLD_PRICE_CACHE_DIR", str(SNAPSHOT))
    monkeypatch.setenv("GOLDVALUE_TODAY", "2026-09-29")
    assert gv.main(["--batch", str(TV / f"batch-{stem}-in.csv")]) == 0
    assert capsys.readouterr().out.encode() == (TV / f"batch-{stem}-out.csv").read_bytes()


def test_batch_output_reimports_unchanged(gv, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GOLD_PRICE_CACHE_DIR", str(SNAPSHOT))
    monkeypatch.setenv("GOLDVALUE_TODAY", "2026-09-29")
    for stem in ("basic", "legacy", "crlf", "dedupe"):
        out = TV / f"batch-{stem}-out.csv"
        assert gv.main(["--batch", str(out)]) == 0
        assert capsys.readouterr().out.encode() == out.read_bytes(), stem


def test_batch_input_files_keep_their_bytes():
    assert (TV / "batch-crlf-in.csv").read_bytes().startswith(b"\xef\xbb\xbfdate,amount,label\r\n")
    assert b"\r" not in (TV / "batch-basic-out.csv").read_bytes()
