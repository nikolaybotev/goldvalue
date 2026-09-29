"""tools/snapshot/sync_data.py: verbatim copy, no LBMA, manifest, row-count guard."""

from __future__ import annotations

import hashlib
import importlib.util
import json

import pytest

from conftest import ROOT

MONTHLY_LF = b"month,usd\n2000-01,284.00\n2000-02,300.10\n"
MONTHLY_CRLF = b"month,usd\r\n2000-01,284.00\r\n2000-02,300.10\r\n"


@pytest.fixture(scope="module")
def sync():
    path = ROOT / "tools" / "snapshot" / "sync_data.py"
    spec = importlib.util.spec_from_file_location("sync_data", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_source(tmp_path, monthly=MONTHLY_LF, extra=()):
    src = tmp_path / "src"
    src.mkdir()
    (src / "monthly.csv").write_bytes(monthly)
    (src / "lbma_daily.csv").write_text("date,usd_am,usd_pm\n2000-01-04,282.00,\n")
    for name in extra:
        (src / name).write_bytes(b"date,usd_per_unit\n2000-01-04,1.0\n")
    return src


def test_copies_monthly_verbatim_and_never_lbma(sync, tmp_path):
    src = make_source(tmp_path, monthly=MONTHLY_CRLF)
    out = tmp_path / "out"
    assert sync.main(["--source-dir", str(src), "--out", str(out)]) == 0
    assert sorted(p.name for p in out.iterdir()) == ["manifest.json", "monthly.csv"]
    assert (out / "monthly.csv").read_bytes() == MONTHLY_CRLF


def test_lbma_names_are_never_publishable(sync):
    for name in ("lbma_daily.csv", "LBMA.csv", "fx_lbma.csv", "gold_pm.json", "notes.txt"):
        assert not sync.is_publishable(name)
    for name in ("monthly.csv", "fx_eur.csv", "fx_gbp.csv", "fx_chf.csv"):
        assert sync.is_publishable(name)


def test_fx_files_are_copied_when_present(sync, tmp_path):
    src = make_source(tmp_path, extra=("fx_eur.csv", "fx_gbp.csv"))
    out = tmp_path / "out"
    sync.sync(src, out)
    assert sorted(p.name for p in out.iterdir()) == [
        "fx_eur.csv", "fx_gbp.csv", "manifest.json", "monthly.csv"]


def test_manifest_content_has_no_timestamp(sync, tmp_path):
    src = make_source(tmp_path)
    out = tmp_path / "out"
    sync.sync(src, out)
    text = (out / "manifest.json").read_text()
    assert text == json.dumps(json.loads(text), sort_keys=True, indent=2) + "\n"
    assert json.loads(text) == {"files": {"monthly.csv": {
        "last_date": "2000-02", "rows": 2, "sha256": hashlib.sha256(MONTHLY_LF).hexdigest()}}}
    assert "time" not in text and "date\":" not in text.replace("last_date", "")


def test_idempotent(sync, tmp_path):
    src = make_source(tmp_path)
    out = tmp_path / "out"
    sync.sync(src, out)
    first = {p.name: p.read_bytes() for p in out.iterdir()}
    sync.sync(src, out)
    assert {p.name: p.read_bytes() for p in out.iterdir()} == first


def test_row_drop_guard_blocks_publishing(sync, tmp_path):
    big = b"month,usd\n" + b"".join(f"{2000 + i // 12}-{i % 12 + 1:02d},1.0\n".encode()
                                     for i in range(200))
    src = make_source(tmp_path, monthly=big)
    out = tmp_path / "out"
    sync.sync(src, out)
    before = {p.name: p.read_bytes() for p in out.iterdir()}
    shrunk = b"month,usd\n" + b"".join(f"{2000 + i // 12}-{i % 12 + 1:02d},1.0\n".encode()
                                       for i in range(197))
    (src / "monthly.csv").write_bytes(shrunk)
    with pytest.raises(SystemExit) as exc:
        sync.sync(src, out)
    assert "shrank" in str(exc.value)
    assert {p.name: p.read_bytes() for p in out.iterdir()} == before


def test_small_row_drop_and_growth_are_allowed(sync, tmp_path):
    def table(n):
        return b"month,usd\n" + b"".join(f"{2000 + i // 12}-{i % 12 + 1:02d},1.0\n".encode()
                                         for i in range(n))

    src = make_source(tmp_path, monthly=table(200))
    out = tmp_path / "out"
    sync.sync(src, out)
    (src / "monthly.csv").write_bytes(table(199))  # 0.5% drop
    sync.sync(src, out)
    (src / "monthly.csv").write_bytes(table(260))
    sync.sync(src, out)


def test_previous_manifest_option(sync, tmp_path):
    src = make_source(tmp_path)
    prev = tmp_path / "prev.json"
    prev.write_text(json.dumps({"files": {"monthly.csv": {"rows": 1000}}}))
    with pytest.raises(SystemExit):
        sync.sync(src, tmp_path / "out", prev)
    assert not (tmp_path / "out").exists()


def test_bad_inputs(sync, tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(SystemExit):
        sync.sync(empty, tmp_path / "o1")
    src = make_source(tmp_path, monthly=b"Date,Price\n2000-01,1\n")
    with pytest.raises(SystemExit):
        sync.sync(src, tmp_path / "o2")
