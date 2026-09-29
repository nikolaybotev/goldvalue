"""FX: BIS parsing and fetch, parity table, resolution rules, fx_mode precedence, CLI."""

from __future__ import annotations

import csv
import datetime as dt
import io
import json

import pytest

from conftest import FX_DAILY, write_fx

D = dt.date.fromisoformat

SYNTHETIC_EUR = (
    "Synthetic euro: the euro did not exist before 1999. Value derived from the Deutsche "
    "Mark at the fixed conversion rate 1 \u20ac = 1.95583 DM. Amounts originally in other "
    "legacy currencies (francs, lire, \u2026) would differ.")

BIS_CSV = (
    "FREQ,REF_AREA,CURRENCY,COLLECTION,UNIT_MULT,DECIMALS,AVAILABILITY,TITLE,TIME_PERIOD,"
    "OBS_VALUE,OBS_STATUS,OBS_PRE_BREAK,OBS_CONF\n"
    "D,GB,GBP,A,0,6,A, Exchange rates against USD,1953-08-08,NaN,,,F\n"
    "D,GB,GBP,A,0,6,A, Exchange rates against USD,1953-08-09,,,,F\n"
    "D,GB,GBP,A,0,6,A, Exchange rates against USD,1953-08-10,0.359066,A,,F\n"
    "D,GB,GBP,A,0,6,A, Exchange rates against USD,1999-01-04,0.603189,A,,F\n")


def resolve(gv, fx, ccy, date, today="2026-09-29"):
    kind, anchor = gv.parse_period(date, D(today))
    return gv.resolve_fx(fx, ccy, kind, anchor, D(today))


# ------------------------------------------------------------------ BIS fetch


def test_parse_bis_csv_inverts_and_skips_nan(gv):
    rows = gv.parse_bis_csv(BIS_CSV)
    assert [d for d, _ in rows] == ["1953-08-10", "1999-01-04"]
    assert rows[0][1] == pytest.approx(1 / 0.359066)
    assert rows[1][1] == pytest.approx(1 / 0.603189)


def test_fetch_fx_writes_usd_per_unit_csv(gv, monkeypatch, tmp_path):
    urls = []

    def fake(url):
        urls.append(url)
        return BIS_CSV.encode()

    monkeypatch.setattr(gv, "_download", fake)
    path = tmp_path / "fx_gbp.csv"
    gv.fetch_fx(path, "GBP")
    assert urls == ["https://stats.bis.org/api/v1/data/WS_XRU/D.GB.GBP.A?format=csv"]
    lines = path.read_text().splitlines()
    assert lines[0] == "date,usd_per_unit"
    assert lines[1] == "1953-08-10,2.785"
    assert lines[2] == "1999-01-04,1.65786"
    assert not path.with_suffix(".tmp").exists()


def test_fx_series_are_the_verified_ones(gv):
    assert gv.FX_SERIES == {"EUR": ("DE", "EUR"), "GBP": ("GB", "GBP"), "CHF": ("CH", "CHF")}
    assert "XM" not in gv.BIS_URL


def test_fetch_fx_rejects_empty_answers(gv, monkeypatch, tmp_path):
    monkeypatch.setattr(gv, "_download", lambda url: b"TIME_PERIOD,OBS_VALUE\n1953-08-08,NaN\n")
    with pytest.raises(ValueError):
        gv.fetch_fx(tmp_path / "fx_gbp.csv", "GBP")


def test_format_rate_uses_six_significant_digits(gv):
    assert gv.format_rate(1 / 0.748321) == "1.33632"
    assert gv.format_rate(2.8) == "2.8"
    with pytest.raises(ValueError):
        gv.format_rate(1e-9)


def test_ensure_fx_cache_fetches_missing_files_only(gv, monkeypatch, hermetic_env):
    monkeypatch.delenv("GOLDVALUE_OFFLINE")
    calls = []
    monkeypatch.setattr(gv, "_download", lambda url: calls.append(url) or BIS_CSV.encode())
    paths = gv.ensure_fx_cache(["EUR", "GBP"], quiet=True)
    assert sorted(paths) == ["EUR", "GBP"] and len(calls) == 2
    gv.ensure_fx_cache(["EUR", "GBP"], quiet=True)
    assert len(calls) == 2
    gv.ensure_fx_cache(["GBP"], force=True, quiet=True)
    assert len(calls) == 3


def test_fx_sources_for_maps_dem_to_eur(gv):
    assert gv.fx_sources_for(["USD"]) == []
    assert gv.fx_sources_for(["DEM"]) == ["EUR"]
    assert gv.fx_sources_for(["DEM", "EUR", "GBP"]) == ["EUR", "GBP"]


def test_offline_missing_fx_cache_is_an_error(gv, cache_dir):
    with pytest.raises(SystemExit) as exc:
        gv.main(["100", "1980-01-21", "--currency", "EUR"])
    assert "FX" in str(exc.value) and "offline" in str(exc.value)


# ------------------------------------------------------------------ parity table


@pytest.mark.parametrize("ccy, day, rate, effective, mode", [
    ("GBP", "1940-01-01", 4.03, "1940-01-01", "parity"),
    ("GBP", "1949-09-17", 4.03, "1940-01-01", "parity"),
    ("GBP", "1949-09-18", 2.80, "1949-09-18", "parity"),
    ("GBP", "1953-08-09", 2.80, "1949-09-18", "parity"),
    ("CHF", "1949-01-01", 1 / 4.37282, "1949-01-01", "parity"),
    ("CHF", "1953-08-31", 1 / 4.37282, "1949-01-01", "parity"),
    ("DEM", "1948-06-21", 1 / 3.33, "1948-06-21", "parity"),
    ("DEM", "1949-09-27", 1 / 3.33, "1948-06-21", "parity"),
    ("DEM", "1949-09-28", 1 / 4.20, "1949-09-28", "parity"),
    ("EUR", "1948-06-21", 1.95583 / 3.33, "1948-06-21", "parity"),
    ("EUR", "1949-09-28", 1.95583 / 4.20, "1949-09-28", "parity"),
    ("EUR", "1953-08-31", 1.95583 / 4.20, "1949-09-28", "parity"),
])
def test_parity_steps(gv, fx, ccy, day, rate, effective, mode):
    got = resolve(gv, fx, ccy, day)
    assert got["rate"] == pytest.approx(rate, rel=1e-12)
    assert got["effective"] == effective
    assert got["mode"] == mode


@pytest.mark.parametrize("ccy, day, effective", [
    ("GBP", "1939-12-31", "1940-01-01"), ("GBP", "1900-01", "1940-01-01"),
    ("CHF", "1948-12-31", "1949-01-01"), ("DEM", "1948-06-20", "1948-06-21"),
    ("EUR", "1948-06-20", "1948-06-21"), ("DEM", "1900", "1948-06-21"),
])
def test_before_the_table_is_extrapolated(gv, fx, ccy, day, effective):
    got = resolve(gv, fx, ccy, day)
    assert got["mode"] == "extrapolated" and got["effective"] == effective
    assert got["note"].startswith("Extrapolated: no parity table entry before")


def test_parity_values_match_the_spec_table(gv):
    table = gv.PARITY_TABLE
    assert [(str(d), r) for d, r, _ in table["GBP"]] == [("1940-01-01", 4.03),
                                                         ("1949-09-18", 2.80)]
    assert [(str(d), r) for d, r, _ in table["CHF"]] == [("1949-01-01", 1 / 4.37282)]
    assert [(str(d), r) for d, r, _ in table["DEM"]] == [("1948-06-21", 1 / 3.33),
                                                         ("1949-09-28", 1 / 4.20)]


def test_parity_labels_match_their_rates(gv):
    for ccy, rows in gv.PARITY_TABLE.items():
        for start, rate, label in rows:
            assert f"${rate:.2f}" in label if ccy == "GBP" else f"${rate:.4f}" in label
    for start, label in gv.EUR_PARITY_LABELS.items():
        dem = next(r for d, r, _ in gv.PARITY_TABLE["DEM"] if d == start)
        assert f"\u20ac1 = ${dem * gv.DEM_PER_EUR:.4f}" in label
        assert f"DM 1 = ${dem:.4f}" in label


def test_parity_note_text(gv, fx):
    assert resolve(gv, fx, "GBP", "1950-06")["note"] == (
        "Bretton Woods parity \u00a31 = $2.80 (1949-09-18 to 1953-08-09).")
    assert resolve(gv, fx, "GBP", "1945-01-01")["note"] == (
        "Bretton Woods parity \u00a31 = $4.03 (1940-01-01 to 1949-09-17).")
    assert resolve(gv, fx, "CHF", "1950")["note"].startswith(
        "Bretton Woods parity CHF 1 = $0.2287 (4.37282 CHF per USD) (1949-01-01 to 1953-08-31)")
    assert "$4.87" in resolve(gv, fx, "GBP", "1900")["note"]


def test_month_and_year_use_the_midpoint(gv, fx):
    assert resolve(gv, fx, "GBP", "1949-09")["effective"] == "1940-01-01"  # the 16th precedes the 18th
    assert resolve(gv, fx, "GBP", "1949-09")["rate"] == 4.03
    assert resolve(gv, fx, "GBP", "1949-10")["rate"] == 2.80
    assert resolve(gv, fx, "GBP", "1949")["rate"] == 4.03  # 2 July precedes 18 September
    assert resolve(gv, fx, "GBP", "1950")["rate"] == 2.80
    assert resolve(gv, fx, "GBP", "1940")["rate"] == 4.03


# ------------------------------------------------------------------ daily resolution


def test_daily_observation_has_no_note(gv, fx):
    got = resolve(gv, fx, "GBP", "1980-01-21")
    assert (got["rate"], got["effective"], got["mode"], got["note"]) == (
        2.26, "1980-01-21", "daily", "")


def test_weekend_rolls_back_to_previous_observation(gv, fx):
    got = resolve(gv, fx, "GBP", "1980-01-20")
    assert got["rate"] == 2.25 and got["effective"] == "1980-01-18"
    assert got["mode"] == "daily"
    assert got["note"] == ("no FX rate on 1980-01-20 (non-trading day); "
                           "used previous rate from 1980-01-18")


def test_nine_day_roll_back_boundary(gv, fx):
    ok = resolve(gv, fx, "CHF", "1980-01-30")
    assert ok["effective"] == "1980-01-21"
    far = resolve(gv, fx, "CHF", "1980-01-31")
    assert far["effective"] == "1980-01-21"
    assert "no FX rate within 9 days" in far["note"]


def test_after_the_latest_rate_says_bis_lags(gv, fx):
    near = resolve(gv, fx, "GBP", "2026-09-23")
    assert near["effective"] == "2026-09-22"
    assert near["note"] == "no FX rate on 2026-09-23; used previous rate from 2026-09-22"
    lag = resolve(gv, fx, "GBP", "2026-09-29")
    assert lag["note"].endswith("(BIS data lags about a week)")
    far = resolve(gv, fx, "GBP", "2026-10-15", today="2026-10-15")
    assert far["note"] == ("requested date is after the latest available FX rate; "
                           "used 2026-09-22 (BIS data lags about a week)")


def test_month_is_a_ratio_of_means(gv, fx):
    got = resolve(gv, fx, "EUR", "2018-12")
    assert got["rate"] == pytest.approx((1.13 + 1.14 + 1.15) / 3)
    assert got["effective"] == "2018-12" and got["mode"] == "daily"
    assert got["note"] == ""


def test_convert_uses_ratio_of_means(gv, table, fx):
    res = gv.convert(table, 1000.0, "USD", "month", D("2018-12-01"), D("2026-09-29"),
                     "EUR", fx)
    gold = (1200 + 1210 + 1220) / 3
    usd = 1000 * (1.13 + 1.14 + 1.15) / 3
    assert res["USD"] == pytest.approx(usd)
    assert res["troy_oz"] == pytest.approx(usd / gold)
    assert res["fx_rate"] == pytest.approx((1.13 + 1.14 + 1.15) / 3)
    assert res["input"]["currency"] == "EUR"


def test_incomplete_period_notes_the_lag(gv, fx):
    got = resolve(gv, fx, "EUR", "2026-09")
    assert got["mode"] == "daily"
    assert got["note"] == ("period extends past the latest BIS observation (2026-09-22); "
                           "average of the 2 available daily rates (BIS data lags about a week)")
    quiet = resolve(gv, fx, "EUR", "2026-09", today="2026-09-24")
    assert quiet["note"] == ""


def test_period_after_the_last_observation_uses_the_last(gv, fx):
    got = resolve(gv, fx, "GBP", "2026-11", today="2026-11-20")
    assert got["effective"] == "2026-09-22" and got["rate"] == 1.35
    assert "after the latest available FX rate" in got["note"]


def test_straddling_month_averages_the_observations(gv, fx):
    got = resolve(gv, fx, "GBP", "1953-08")
    assert got["rate"] == pytest.approx((2.78 + 2.79) / 2)
    assert got["mode"] == "daily" and got["effective"] == "1953-08"
    assert "starts before the first BIS observation (1953-08-10)" in got["note"]


def test_period_wholly_before_first_observation_uses_parity(gv, fx):
    got = resolve(gv, fx, "CHF", "1953-08")
    assert got["mode"] == "parity" and got["rate"] == pytest.approx(1 / 4.37282)


def test_straddling_year_averages_even_when_mostly_before(gv, fx):
    got = resolve(gv, fx, "CHF", "1953")
    assert got["rate"] == pytest.approx(0.2333) and got["mode"] == "daily"


# ------------------------------------------------------------------ synthetic and precedence


def test_dem_is_eur_divided_by_the_conversion_rate(gv, fx):
    eur = resolve(gv, fx, "EUR", "1980-01-21")
    dem = resolve(gv, fx, "DEM", "1980-01-21")
    assert dem["rate"] == 0.5 / 1.95583 and eur["rate"] == 0.5
    assert dem["mode"] == "daily" and eur["mode"] == "synthetic"
    assert eur["note"] == SYNTHETIC_EUR


def test_euro_boundary_by_observation_date(gv, fx):
    assert resolve(gv, fx, "EUR", "1998-12-31")["mode"] == "synthetic"
    assert resolve(gv, fx, "EUR", "1999-01-04")["mode"] == "daily"
    assert resolve(gv, fx, "EUR", "1999-01-02")["mode"] == "synthetic"  # rolls back to 1998
    assert resolve(gv, fx, "DEM", "1998-12-31")["mode"] == "daily"
    dem = resolve(gv, fx, "DEM", "1999-01-04")
    assert dem["mode"] == "synthetic" and dem["note"].startswith("Synthetic Deutsche Mark")
    assert resolve(gv, fx, "EUR", "1999-01")["mode"] == "daily"
    assert resolve(gv, fx, "EUR", "1998-12")["mode"] == "synthetic"
    assert resolve(gv, fx, "DEM", "1998")["mode"] == "daily"
    assert resolve(gv, fx, "DEM", "1999")["mode"] == "synthetic"


def test_synthetic_holds_for_gbp_and_chf_never(gv, fx):
    for ccy in ("GBP", "CHF"):
        assert resolve(gv, fx, ccy, "1980-01-21")["mode"] == "daily"


def test_highest_mode_wins_and_note_lists_everything(gv, fx):
    got = resolve(gv, fx, "EUR", "1950-06")
    assert got["mode"] == "parity"
    assert got["note"].startswith("Bretton Woods parity \u20ac1 = $0.4657")
    assert got["note"].endswith(SYNTHETIC_EUR)
    ext = resolve(gv, fx, "EUR", "1900-01")
    assert ext["mode"] == "extrapolated"
    assert ext["note"].startswith("Extrapolated:") and ext["note"].endswith(SYNTHETIC_EUR)
    assert resolve(gv, fx, "DEM", "1950-06")["mode"] == "parity"


def test_mode_rank_order(gv):
    assert gv.FX_MODES == ("daily", "synthetic", "parity", "extrapolated")


def test_rolled_back_synthetic_row_lists_both_notes(gv, fx):
    got = resolve(gv, fx, "EUR", "1999-01-02")
    assert got["mode"] == "synthetic" and got["effective"] == "1998-12-31"
    assert got["note"].startswith(SYNTHETIC_EUR)
    assert got["note"].endswith("no FX rate on 1999-01-02 (non-trading day); "
                                "used previous rate from 1998-12-31")


def test_synthetic_text_is_verbatim_from_the_spec(gv):
    assert gv.SYNTHETIC_EUR_NOTE == SYNTHETIC_EUR


# ------------------------------------------------------------------ CLI


def run_json(gv, capsys, *argv):
    assert gv.main(["--json", *argv]) == 0
    return json.loads(capsys.readouterr().out)


def test_json_eur_month_matches_hand_calculation(gv, capsys, cache_dir):
    write_fx(cache_dir)
    out = run_json(gv, capsys, "250000", "2018-12", "--currency", "EUR")
    rate = (1.13 + 1.14 + 1.15) / 3
    assert out["fx_rate"] == pytest.approx(rate)
    assert (out["fx_effective"], out["fx_mode"], out["fx_note"]) == ("2018-12", "daily", "")
    assert out["USD"] == pytest.approx(250000 * rate)
    assert out["troy_oz"] == pytest.approx(250000 * rate / 1210)
    assert out["input"]["currency"] == "EUR"


def test_json_usd_keeps_fx_null(gv, capsys, cache_dir):
    out = run_json(gv, capsys, "1000", "1980-01-21")
    assert [out[k] for k in ("fx_rate", "fx_effective", "fx_mode", "fx_note")] == [None] * 4
    assert out["input"]["currency"] == "USD"


def test_currency_is_case_insensitive_and_usd_is_explicit(gv, capsys, cache_dir):
    write_fx(cache_dir)
    out = run_json(gv, capsys, "1000", "1980-01-21", "--currency", "gbp")
    assert out["fx_rate"] == 2.26 and out["USD"] == pytest.approx(2260)
    same = run_json(gv, capsys, "1000", "1980-01-21", "--currency", "USD")
    assert same["fx_rate"] is None


def test_currency_needs_from_usd(gv, cache_dir, capsys):
    write_fx(cache_dir)
    with pytest.raises(SystemExit) as exc:
        gv.main(["100", "1980-01-21", "--currency", "EUR", "--from", "GB"])
    assert exc.value.code == 2
    assert "only valid with --from USD" in capsys.readouterr().err


def test_unknown_currency_and_price_only_are_rejected(gv, cache_dir, capsys):
    with pytest.raises(SystemExit):
        gv.main(["1", "1980", "--currency", "JPY"])
    assert "unknown currency" in capsys.readouterr().err
    write_fx(cache_dir)
    with pytest.raises(SystemExit):
        gv.main(["--price-only", "1980", "--currency", "EUR"])


def test_text_output_shows_fx_lines(gv, capsys, cache_dir):
    write_fx(cache_dir)
    assert gv.main(["1000", "1950-06", "--currency", "GBP"]) == 0
    out = capsys.readouterr().out
    assert out.startswith("1,000.00 GBP on 1950-06 @ $")
    assert "fx: 1 GBP = $2.800000 USD (effective 1949-09-18; fx_mode: parity)" in out
    assert "fx note: Bretton Woods parity \u00a31 = $2.80" in out
    assert "= $2,800.00 USD" in out


def test_text_output_for_usd_is_unchanged(gv, capsys, cache_dir):
    assert gv.main(["1000", "1980-01-21"]) == 0
    out = capsys.readouterr().out
    assert "fx:" not in out and "USD\n" not in out.replace("  = $", "")


def test_fetch_only_fetches_all_fx_files(gv, monkeypatch, tmp_path, capsys):
    monkeypatch.delenv("GOLDVALUE_OFFLINE")
    urls = []

    def fake(url):
        urls.append(url)
        if "lbma" in url:
            return b"[]"
        if "monthly" in url:
            return b"Date,Price\n2000-01,282\n"
        return BIS_CSV.encode()

    monkeypatch.setattr(gv, "_download", fake)
    monkeypatch.setattr(gv, "fetch_lbma", lambda path: path.write_text(
        "date,usd_am,usd_pm\n2000-01-04,282,\n"))
    assert gv.main(["--fetch-only"]) == 0
    cache = tmp_path / "cache"
    assert sorted(p.name for p in cache.iterdir()) == [
        "fx_chf.csv", "fx_eur.csv", "fx_gbp.csv", "lbma_daily.csv", "monthly.csv"]
    assert sum("stats.bis.org" in u for u in urls) == 3
    for area in ("D.DE.EUR", "D.GB.GBP", "D.CH.CHF"):
        assert any(area in u for u in urls)


def test_usd_query_never_touches_fx(gv, capsys, cache_dir):
    assert gv.main(["1000", "1980-01-21"]) == 0


# ------------------------------------------------------------------ batch


def batch(gv, capsys, tmp_path, text, *extra):
    path = tmp_path / "in.csv"
    path.write_text(text, encoding="utf-8")
    assert gv.main(["--batch", str(path), *extra]) == 0
    rows = list(csv.reader(io.StringIO(capsys.readouterr().out)))
    return rows[0], [dict(zip(rows[0], r)) for r in rows[1:]]


def test_batch_currency_column_and_fx_fields(gv, capsys, tmp_path, cache_dir):
    write_fx(cache_dir)
    header, rows = batch(gv, capsys, tmp_path,
                         "date,amount\n1980-01-21,1000\n1950-06,1000\n", "--currency", "GBP")
    assert header[:4] == ["date", "amount", "currency", "label"]
    daily, parity = rows
    assert daily["currency"] == "GBP" and daily["fx_rate"] == "2.260000"
    assert (daily["fx_effective"], daily["fx_mode"], daily["fx_note"]) == (
        "1980-01-21", "daily", "")
    assert daily["USD"] == "2260.00"
    assert parity["fx_mode"] == "parity" and parity["fx_effective"] == "1949-09-18"
    assert parity["fx_note"].startswith("Bretton Woods parity \u00a31 = $2.80")


def test_batch_output_reimports_with_the_same_currency(gv, capsys, tmp_path, cache_dir):
    write_fx(cache_dir)
    text = "date,amount,currency\n1980-01-21,1000,EUR\n"
    _, first = batch(gv, capsys, tmp_path, text, "--currency", "EUR")
    assert first[0]["currency"] == "EUR"
    _, usd = batch(gv, capsys, tmp_path, text)
    assert usd[0]["currency"] == "USD" and usd[0]["fx_rate"] == ""


def test_batch_rejects_currency_with_non_usd_unit(gv, cache_dir, tmp_path, capsys):
    write_fx(cache_dir)
    (tmp_path / "in.csv").write_text("date,amount\n1980-01-21,1\n")
    with pytest.raises(SystemExit):
        gv.main(["--batch", str(tmp_path / "in.csv"), "--currency", "EUR", "--from", "OZ"])


def test_fx_tables_have_documented_first_dates():
    assert FX_DAILY["gbp"][0][0] == "1953-08-10"
    assert FX_DAILY["chf"][0][0] == FX_DAILY["eur"][0][0] == "1953-09-01"
