"""Single-query CLI output, future-date rejection, and the offline/today hooks."""

from __future__ import annotations

import json
import os
import time

import pytest

from conftest import write_fx

JSON_KEYS = {
    "input", "effective", "granularity", "points", "gold_usd_per_oz", "price_source", "note",
    "troy_oz", "GB", "GBD", "USD", "fx_rate", "fx_effective", "fx_mode", "fx_note",
    "gold_mode", "ma_years", "ma_months", "spot_usd_per_oz",
    "price_note", "price_points",
}


def run_json(gv, capsys, *argv):
    assert gv.main(["--json", *argv]) == 0
    return json.loads(capsys.readouterr().out)


def test_json_top_level_keys_and_values(gv, capsys, cache_dir):
    out = run_json(gv, capsys, "1000", "1980-01-21")
    assert set(out) == JSON_KEYS
    assert out["effective"] == "1980-01-21"
    assert out["granularity"] == "day"
    assert out["points"] == 1
    assert out["note"] == "LBMA fix on the requested date"
    assert out["price_source"] == "LBMA"
    assert out["gold_usd_per_oz"] == 850.0
    assert out["troy_oz"] == pytest.approx(1000 / 850)
    assert out["GB"] == pytest.approx(1000 / 850 * 1000)
    assert out["GBD"] == pytest.approx(1000 / 850 * 50)
    assert out["USD"] == pytest.approx(1000.0)
    assert (out["fx_rate"], out["fx_effective"], out["fx_mode"], out["fx_note"]) == (
        None, None, None, None)
    assert out["gold_mode"] == "spot"
    assert out["ma_years"] is None and out["ma_months"] is None
    assert out["spot_usd_per_oz"] == out["gold_usd_per_oz"]


def test_json_legacy_aliases_match_new_keys(gv, capsys, cache_dir):
    out = run_json(gv, capsys, "5", "2018-12")
    assert out["price_note"] == out["note"] == "average of 3 LBMA daily fixes"
    assert out["price_points"] == out["points"] == 3
    assert out["input"] == {"amount": 5.0, "unit": "USD", "currency": "USD",
                            "period": "2018-12", "granularity": "month"}


def test_json_price_is_not_rounded(gv, capsys, cache_dir):
    out = run_json(gv, capsys, "1", "2026")
    assert out["gold_usd_per_oz"] == pytest.approx(23220 / 7, rel=1e-15)


def test_json_from_gb(gv, capsys, cache_dir):
    out = run_json(gv, capsys, "100", "1980-01-21", "--from", "GB")
    assert out["troy_oz"] == pytest.approx(0.1)
    assert out["USD"] == pytest.approx(85.0)
    assert out["input"]["unit"] == "GB"


@pytest.mark.parametrize("unit, amount, oz", [("GBD", 50.0, 1.0), ("OZ", 2.0, 2.0),
                                              ("GB", 1000.0, 1.0)])
def test_from_units(gv, capsys, cache_dir, unit, amount, oz):
    out = run_json(gv, capsys, str(amount), "1980-01-21", "--from", unit)
    assert out["troy_oz"] == pytest.approx(oz)
    assert out["USD"] == pytest.approx(oz * 850.0)


def test_negative_amount(gv, capsys, cache_dir):
    out = run_json(gv, capsys, "--", "-1,700", "1980-01-21")
    assert out["troy_oz"] == pytest.approx(-2.0)
    assert out["GB"] == pytest.approx(-2000.0)


def test_month_to_date_note_in_output(gv, capsys, cache_dir):
    out = run_json(gv, capsys, "1000", "2026-09")
    assert out["note"] == "average of 5 LBMA daily fixes (month to date)"


def test_today_keyword_uses_hook(gv, capsys, cache_dir, monkeypatch):
    monkeypatch.setenv("GOLDVALUE_TODAY", "2026-09-26")
    out = run_json(gv, capsys, "1000", "today")
    assert out["effective"] == "2026-09-25"
    assert out["note"].startswith("no LBMA fix on 2026-09-26")


def test_text_output_shows_granularity_and_note(gv, capsys, cache_dir):
    assert gv.main(["$1,000", "1980-01-21"]) == 0
    text = capsys.readouterr().out.splitlines()
    assert text[0] == "$1,000.00 on 1980-01-21 @ $850.00/troy oz [LBMA]"
    assert text[1] == "  granularity: day; note: LBMA fix on the requested date"
    assert text[2] == ("  gold_mode: spot; ma_years: ; ma_months: ; "
                       "spot_usd_per_oz: $850.00")
    assert text[3].startswith("  = 1,176.47 GB")
    assert any(line.startswith("  = 58.8235 GBD") for line in text)
    assert any(line.startswith("  = 1.1765 troy oz") for line in text)


def test_text_output_single_unit(gv, capsys, cache_dir):
    assert gv.main(["1000", "1980-01-21", "--to", "GBD"]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert len(lines) == 4 and lines[3].startswith("  = 58.8235 GBD")


def test_price_only_text_and_json(gv, capsys, cache_dir):
    assert gv.main(["--price-only", "1980-01-19"]) == 0
    line = capsys.readouterr().out.strip()
    assert line.startswith("Gold price for 1980-01-18: $835.00/troy oz [LBMA; granularity: day;")
    out = run_json(gv, capsys, "--price-only", "1980-01-19")
    assert out["gold_usd_per_oz"] == 835.0
    assert out["price_source"] == "LBMA"
    assert out["effective"] == "1980-01-18"
    assert out["granularity"] == "day" and out["points"] == 1 and "note" in out


@pytest.mark.parametrize("token", ["2026-09-30", "2026-10", "2027", "10/01/2026", "Oct 1, 2026"])
def test_future_dates_rejected(gv, capsys, cache_dir, token):
    with pytest.raises(SystemExit) as exc:
        gv.main(["1000", token])
    assert exc.value.code == 2
    assert "date is in the future" in capsys.readouterr().err


def test_future_price_only_rejected(gv, capsys, cache_dir):
    with pytest.raises(SystemExit) as exc:
        gv.main(["--price-only", "2030"])
    assert exc.value.code == 2


def test_current_period_starts_are_not_future(gv, capsys, cache_dir):
    for token in ("2026-09-29", "2026-09", "2026", "today"):
        assert gv.main(["1", token, "--json"]) == 0
        capsys.readouterr()


def test_non_finite_and_exponent_amounts_rejected(gv, capsys, cache_dir):
    for bad in ("nan", "inf", "-inf", "1e3"):
        with pytest.raises(SystemExit) as exc:
            gv.main(["--", bad, "1980-01-21"])
        assert exc.value.code == 2
        assert "invalid amount" in capsys.readouterr().err


def test_bad_date_is_usage_error(gv, capsys, cache_dir):
    with pytest.raises(SystemExit) as exc:
        gv.main(["1", "yesterday"])
    assert exc.value.code == 2


def test_wrong_arity(gv, capsys, cache_dir):
    with pytest.raises(SystemExit) as exc:
        gv.main(["1"])
    assert exc.value.code == 2


def test_no_data_is_error(gv, cache_dir):
    with pytest.raises(SystemExit) as exc:
        gv.main(["1", "1800"])
    assert "no gold price data" in str(exc.value)


def test_fetch_only_offline_reports_cache(gv, capsys, cache_dir):
    write_fx(cache_dir)
    assert gv.main(["--fetch-only"]) == 0
    assert "cache ready" in capsys.readouterr().out


# ------------------------------------------------------------------ hooks


def test_offline_missing_cache_is_an_error_and_never_downloads(gv, monkeypatch, hermetic_env):
    with pytest.raises(SystemExit) as exc:
        gv.main(["1", "1980-01-21"])
    assert "offline mode" in str(exc.value)
    assert not hermetic_env.exists() or not any(hermetic_env.iterdir())


def test_offline_refresh_is_rejected(gv, cache_dir):
    with pytest.raises(SystemExit) as exc:
        gv.main(["--refresh", "--fetch-only"])
    assert "offline" in str(exc.value)


@pytest.mark.parametrize("value", ["0", "false", "no", ""])
def test_offline_env_falsey_values(gv, monkeypatch, value):
    monkeypatch.setenv("GOLDVALUE_OFFLINE", value)
    assert gv.offline() is False


@pytest.mark.parametrize("value", ["1", "true", "yes", "anything"])
def test_offline_env_truthy_values(gv, monkeypatch, value):
    monkeypatch.setenv("GOLDVALUE_OFFLINE", value)
    assert gv.offline() is True


def test_download_guard_when_offline(gv, monkeypatch):
    with pytest.raises(OSError, match="offline"):
        gv._orig_download("https://example.invalid/x")


def make_stale(path, hours=24):
    old = time.time() - hours * 3600
    os.utime(path, (old, old))


def lbma_json(rows):
    return json.dumps([{"d": d, "v": [float(v), 1.0, 1.0]} for d, v in rows]).encode()


def fake_sources(gv, monkeypatch, calls):
    pm = [("2026-09-28", 3500.0), ("2026-09-29", 3510.0)]
    am = [("2026-09-28", 3495.0), ("2026-09-29", 3505.0)]
    monthly = "Date,Price\n2026-08,3200.0\n2026-09,3450.0\n"

    def fake(url):
        calls.append(url)
        if url == gv.LBMA_PM_URL:
            return lbma_json(pm)
        if url == gv.LBMA_AM_URL:
            return lbma_json(am)
        if url == gv.MONTHLY_URL:
            return monthly.encode()
        raise AssertionError(url)

    monkeypatch.setattr(gv, "_download", fake)


def test_first_run_downloads_and_writes_csv_cache(gv, capsys, hermetic_env, monkeypatch):
    monkeypatch.delenv("GOLDVALUE_OFFLINE")
    calls = []
    fake_sources(gv, monkeypatch, calls)
    assert gv.main(["1000", "2026-09-29", "--json"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["gold_usd_per_oz"] == 3510.0
    assert sorted(calls) == sorted([gv.LBMA_PM_URL, gv.LBMA_AM_URL, gv.MONTHLY_URL])
    text = (hermetic_env / "lbma_daily.csv").read_text()
    assert text.splitlines() == ["date,usd_am,usd_pm",
                                 "2026-09-28,3495.0,3500.0", "2026-09-29,3505.0,3510.0"]
    assert (hermetic_env / "monthly.csv").read_text().splitlines() == [
        "month,usd", "2026-08,3200.0", "2026-09,3450.0"]


def test_stale_cache_refreshes_when_query_is_past_range(gv, capsys, cache_dir, monkeypatch):
    monkeypatch.delenv("GOLDVALUE_OFFLINE")
    make_stale(cache_dir / "lbma_daily.csv")
    make_stale(cache_dir / "monthly.csv")
    calls = []
    fake_sources(gv, monkeypatch, calls)
    assert gv.main(["1000", "2026-09-29", "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["effective"] == "2026-09-29"
    assert gv.LBMA_PM_URL in calls and gv.MONTHLY_URL in calls


def test_fresh_cache_is_not_refreshed(gv, capsys, cache_dir, monkeypatch):
    monkeypatch.delenv("GOLDVALUE_OFFLINE")
    assert gv.main(["1000", "2026-09-29", "--json"]) == 0  # stub raises if a download happens
    assert json.loads(capsys.readouterr().out)["effective"] == "2026-09-25"


def test_in_range_query_does_not_refresh_even_if_stale(gv, capsys, cache_dir, monkeypatch):
    monkeypatch.delenv("GOLDVALUE_OFFLINE")
    make_stale(cache_dir / "lbma_daily.csv")
    make_stale(cache_dir / "monthly.csv")
    assert gv.main(["1000", "1980-01-21", "--json"]) == 0


def test_no_refresh_flag_blocks_stale_refresh(gv, capsys, cache_dir, monkeypatch):
    monkeypatch.delenv("GOLDVALUE_OFFLINE")
    make_stale(cache_dir / "lbma_daily.csv")
    make_stale(cache_dir / "monthly.csv")
    assert gv.main(["1000", "2026-09-29", "--json", "--no-refresh"]) == 0
    assert json.loads(capsys.readouterr().out)["effective"] == "2026-09-25"
    assert gv.offline() is True
    gv.main(["1000", "1980-01-21", "--json"])  # a later call without the flag resets it
    capsys.readouterr()
    assert gv.offline() is False


def test_no_refresh_missing_cache_is_an_error(gv, hermetic_env, monkeypatch):
    monkeypatch.delenv("GOLDVALUE_OFFLINE")
    with pytest.raises(SystemExit) as exc:
        gv.main(["1", "1980-01-21", "--no-refresh"])
    assert "offline mode" in str(exc.value)


def test_refresh_failure_falls_back_to_cached_copy(gv, capsys, cache_dir, monkeypatch):
    monkeypatch.delenv("GOLDVALUE_OFFLINE")
    make_stale(cache_dir / "lbma_daily.csv")

    def boom(url):
        raise OSError("boom")

    monkeypatch.setattr(gv, "_download", boom)
    assert gv.main(["1000", "2026-09-29", "--json"]) == 0
    captured = capsys.readouterr()
    assert json.loads(captured.out)["effective"] == "2026-09-25"
    assert "refresh failed" in captured.err


def test_fetch_lbma_merges_am_and_pm_and_skips_empty_days(gv, tmp_path, monkeypatch):
    def fake(url):
        if url == gv.LBMA_PM_URL:
            return json.dumps([{"d": "2000-01-05", "v": [284.0, 1, 1]},
                               {"d": "2000-01-06", "v": [None, None, None]}]).encode()
        return json.dumps([{"d": "2000-01-04", "v": [282.0, 1, 1]},
                           {"d": "2000-01-05", "v": [283.5, 1, 1]},
                           {"d": "2000-01-06", "v": [None, None, None]}]).encode()

    monkeypatch.setattr(gv, "_download", fake)
    path = tmp_path / "lbma.csv"
    gv.fetch_lbma(path)
    assert path.read_text().splitlines() == [
        "date,usd_am,usd_pm", "2000-01-04,282.0,", "2000-01-05,283.5,284.0"]

