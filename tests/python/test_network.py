"""Live-source smoke test. Excluded by default; run with `pytest -m network`."""

from __future__ import annotations

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
