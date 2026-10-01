"""Trailing monthly mean: in-memory holes, clipping, and the series-start bounds."""

from __future__ import annotations

import datetime as dt

import pytest

from conftest import ROOT, write_fx

SNAPSHOT = ROOT / "test-vectors" / "snapshot"
TODAY = dt.date(2026, 9, 29)
HOLE_NOTE = "5-year average; 59 months, 2010-01 to 2014-12; missing 2012-06"
FULL_NOTE = "10-year average; 120 months, 2016-10 to 2026-09"
PARTIAL_NOTE = "10-year average; 48 months, 1833-01 to 1836-12; series starts 1833-01"


def shift(gv, year, month, delta):
    return gv._shift_month(year, month, delta)


def month_span(gv, start, end, price=10.0, skip=()):
    out = {}
    year, month = start
    while (year, month) <= end:
        if (year, month) not in skip:
            out[(year, month)] = price
        year, month = shift(gv, year, month, 1)
    return out


def test_hole_note_and_empty_window_use_an_in_memory_table(gv):
    monthly = month_span(gv, (2010, 1), (2014, 12), skip=((2012, 6),))
    table = gv.GoldTable.from_entries({}, monthly)
    assert table.series_start == (2010, 1)
    res = gv.convert(table, 1000.0, "USD", "month", dt.date(2014, 12, 1), TODAY, smooth=5)
    assert res["gold_mode"] == "partial"
    assert res["ma_years"] == 5 and res["ma_months"] == 59
    assert res["note"] == HOLE_NOTE
    assert res["gold_usd_per_oz"] == pytest.approx(10.0)
    assert res["GB"] == pytest.approx(1000 / 10 * 1000)
    with pytest.raises(LookupError, match="no gold price data for the 5-year span ending 2000-06"):
        gv.trailing_average(table, "month", dt.date(2000, 6, 1), TODAY, 5)


def test_clipped_month_is_not_stored_and_does_not_mutate_monthly(gv):
    monthly = month_span(gv, (2005, 5), (2010, 3))
    monthly[(2010, 4)] = 999.0
    daily = {
        dt.date(2010, 4, 1): 100.0,
        dt.date(2010, 4, 2): 200.0,
        dt.date(2010, 4, 3): 600.0,
    }
    table = gv.GoldTable.from_entries(daily, monthly)
    before_monthly = dict(table.monthly)
    before_quote = table.month_price[(2010, 4)]
    assert before_quote[0] == pytest.approx(300.0)
    assert before_quote[1] == "LBMA"
    today = dt.date(2010, 4, 2)
    clipped = gv.convert(table, 1000.0, "USD", "day", dt.date(2010, 4, 2), today, smooth=5)
    assert " (month to date)" in clipped["note"]
    assert clipped["note"].startswith("5-year average; 60 months, 2005-05 to 2010-04")
    assert clipped["gold_mode"] == "smoothed"
    full = gv.convert(table, 1000.0, "USD", "month", dt.date(2010, 4, 1), today, smooth=5)
    assert "(month to date)" not in full["note"]
    assert full["gold_usd_per_oz"] != pytest.approx(clipped["gold_usd_per_oz"])
    assert table.monthly == before_monthly
    assert table.monthly[(2010, 4)] == 999.0
    assert table.month_price[(2010, 4)] == before_quote
    # A day that includes every fix in the month is not clipped.
    end = gv.convert(table, 1000.0, "USD", "day", dt.date(2010, 4, 3), dt.date(2010, 4, 3),
                     smooth=5)
    assert "(month to date)" not in end["note"]
    assert end["gold_usd_per_oz"] == pytest.approx(full["gold_usd_per_oz"])


def test_year_in_progress_ends_at_the_current_month(gv):
    monthly = month_span(gv, (2005, 1), (2010, 12))
    table = gv.GoldTable.from_entries({}, monthly)
    mid = gv.convert(table, 1.0, "USD", "year", dt.date(2010, 1, 1), dt.date(2010, 6, 15),
                     smooth=5)
    assert mid["note"] == "5-year average; 60 months, 2005-07 to 2010-06"
    assert "(month to date)" not in mid["note"]
    done = gv.convert(table, 1.0, "USD", "year", dt.date(2010, 1, 1), dt.date(2011, 2, 1),
                      smooth=5)
    assert done["note"] == "5-year average; 60 months, 2006-01 to 2010-12"


def test_negative_amount_keeps_its_sign(gv):
    monthly = month_span(gv, (2010, 1), (2014, 12))
    table = gv.GoldTable.from_entries({}, monthly)
    res = gv.convert(table, -1000.0, "USD", "month", dt.date(2014, 12, 1), TODAY, smooth=5)
    assert res["gold_mode"] == "smoothed"
    assert res["troy_oz"] < 0 and res["GB"] < 0 and res["USD"] < 0


def test_python_does_not_say_daily_prices_not_loaded(gv):
    monthly = month_span(gv, (1964, 1), (1968, 12), price=35.0)
    table = gv.GoldTable.from_entries({}, monthly)
    res = gv.convert(table, 1000.0, "USD", "month", dt.date(1968, 12, 1), TODAY, smooth=5)
    assert res["note"] == "5-year average; 60 months, 1964-01 to 1968-12"
    assert "daily LBMA prices not loaded" not in res["note"]
    assert res["price_source"] == "World Bank Pink Sheet (monthly)"


def test_series_start_bounds_on_the_fixture(gv):
    table = gv.GoldTable(SNAPSHOT / "lbma_daily.csv", SNAPSHOT / "monthly.csv")

    def run(date, years):
        kind, anchor = gv.parse_period(date, TODAY)
        return gv.convert(table, 1000.0, "USD", kind, anchor, TODAY, smooth=years)

    partial = run("1836", 10)
    assert partial["gold_mode"] == "partial"
    assert partial["note"] == PARTIAL_NOTE
    assert partial["ma_months"] == 48
    full = run("2026-09", 10)
    assert full["gold_mode"] == "smoothed"
    assert full["note"] == FULL_NOTE
    assert full["ma_months"] == 120
    assert full["price_source"] == "LBMA"
    assert run("2018-12", 10)["note"] == "10-year average; 120 months, 2009-01 to 2018-12"
    assert run("2018", 10)["note"] == "10-year average; 120 months, 2009-01 to 2018-12"
    assert run("1837-11", 5)["gold_mode"] == "partial"
    assert run("1837-12", 5)["gold_mode"] == "smoothed"
    assert run("1837-12", 5)["ma_months"] == 60
    assert run("1842-11", 10)["gold_mode"] == "partial"
    assert run("1842-12", 10)["gold_mode"] == "smoothed"
    assert run("1842-12", 10)["ma_months"] == 120
    assert run("1852-11", 20)["gold_mode"] == "partial"
    assert run("1852-12", 20)["gold_mode"] == "smoothed"
    assert run("1852-12", 20)["ma_months"] == 240
    mixed = run("1968-12", 10)
    assert mixed["price_source"] == "mixed"
    assert mixed["gold_mode"] == "smoothed"
    assert mixed["effective"] == "1968-12"
    assert mixed["granularity"] == "month"


def test_smooth_requires_from_usd_and_currency_is_still_allowed(gv, capsys, cache_dir, monkeypatch):
    with pytest.raises(SystemExit) as exc:
        gv.main(["1", "2018-12", "--smooth", "10y", "--from", "GB"])
    assert exc.value.code == 2
    assert "--smooth is only valid with --from USD" in capsys.readouterr().err
    with pytest.raises(SystemExit) as exc:
        gv.main(["1", "2018-12", "--smooth", "7y"])
    assert exc.value.code == 2
    write_fx(cache_dir)
    spot = json_run(gv, capsys, "1000", "2026-09", "--currency", "EUR")
    smoothed = json_run(gv, capsys, "1000", "2026-09", "--smooth", "10Y", "--currency", "EUR")
    assert smoothed["spot_usd_per_oz"] == spot["gold_usd_per_oz"]
    assert smoothed["fx_rate"] == spot["fx_rate"]
    assert smoothed["fx_mode"] == spot["fx_mode"]
    assert smoothed["gold_mode"] in ("smoothed", "partial")
    assert smoothed["gold_usd_per_oz"] != spot["gold_usd_per_oz"]


def test_price_only_smooth_prints_the_mean_and_the_note(gv, capsys, monkeypatch):
    monkeypatch.setenv("GOLD_PRICE_CACHE_DIR", str(SNAPSHOT))
    monkeypatch.setenv("GOLDVALUE_OFFLINE", "1")
    assert gv.main(["--price-only", "--smooth", "10y", "2026-09"]) == 0
    text = capsys.readouterr().out
    assert FULL_NOTE in text
    out = json_run(gv, capsys, "--price-only", "--smooth", "10y", "2026-09")
    assert out["note"] == FULL_NOTE
    assert out["gold_mode"] == "smoothed"
    assert out["ma_years"] == 10 and out["ma_months"] == 120
    assert out["spot_usd_per_oz"] != out["gold_usd_per_oz"]


def test_empty_window_skips_the_batch_row(gv, tmp_path, capsys, monkeypatch):
    cache = tmp_path / "cache"
    cache.mkdir()
    # One fix on the latest month so ensure_covers has a last daily date. The
    # hole itself stays in the monthly series; this fix matches that month's price.
    (cache / "lbma_daily.csv").write_text("date,usd_am,usd_pm\n2014-12-15,10,10\n")
    months = month_span(gv, (2010, 1), (2014, 12), skip=((2012, 6),))
    lines = ["month,usd"] + [f"{y}-{m:02d},{price}" for (y, m), price in sorted(months.items())]
    (cache / "monthly.csv").write_text("\n".join(lines) + "\n")
    batch = tmp_path / "in.csv"
    batch.write_text("date,amount\n2000-06,1\n2014-12,10\n")
    monkeypatch.setenv("GOLD_PRICE_CACHE_DIR", str(cache))
    assert gv.main(["--batch", str(batch), "--smooth", "5y"]) == 0
    captured = capsys.readouterr()
    assert "no gold price data for the 5-year span ending 2000-06; row skipped" in captured.err
    assert captured.out.count("\n") == 2
    assert HOLE_NOTE in captured.out
    assert ",partial,5,59," in captured.out


def json_run(gv, capsys, *argv):
    import json
    assert gv.main(["--json", *argv]) == 0
    return json.loads(capsys.readouterr().out)
