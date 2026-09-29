"""Live-source smoke test. Excluded by default; run with `pytest -m network`."""

from __future__ import annotations

import datetime as dt
import json

import pytest

pytestmark = pytest.mark.network


def test_live_sources_round_trip(gv, capsys, monkeypatch, tmp_path):
    monkeypatch.delenv("GOLDVALUE_OFFLINE")
    monkeypatch.delenv("GOLDVALUE_TODAY")
    monkeypatch.undo()
    monkeypatch.setenv("GOLD_PRICE_CACHE_DIR", str(tmp_path / "live"))
    assert gv.main(["--json", "80000", "2018-12"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["price_source"] == "LBMA"
    assert out["GB"] == pytest.approx(63979.53, abs=0.01)


def test_live_bis_fx(gv, monkeypatch, tmp_path):
    """BIS shape and sanity: coverage boundaries, per-USD inversion, CHF 1999-01-04."""
    monkeypatch.delenv("GOLDVALUE_OFFLINE")
    monkeypatch.undo()
    for source, first in (("GBP", "1953-08-10"), ("CHF", "1953-09-01"), ("EUR", "1953-09-01")):
        path = tmp_path / f"fx_{source.lower()}.csv"
        gv.fetch_fx(path, source)
        table = gv.FxTable(path, source)
        assert str(table.first) == first
        assert (dt.date.today() - table.last).days < 21
    chf = gv.FxTable(tmp_path / "fx_chf.csv", "CHF")
    assert chf.value(dt.date(1999, 1, 4)) == pytest.approx(0.7292, abs=1e-4)
    eur = gv.FxTable(tmp_path / "fx_eur.csv", "EUR")
    assert 1 / eur.value(dt.date(1990, 6, 1)) * 1.95583 == pytest.approx(1.6935, abs=1e-3)
    assert 1 / eur.value(dt.date(1999, 1, 4)) == pytest.approx(0.848248, abs=1e-5)
    gbp = gv.FxTable(tmp_path / "fx_gbp.csv", "GBP")
    assert 1 / gbp.value(dt.date(1999, 1, 4)) == pytest.approx(0.603189, abs=1e-5)
