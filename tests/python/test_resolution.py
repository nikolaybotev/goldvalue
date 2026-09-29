"""Every branch of GoldTable resolution (spec section 6.4), against the hand-made tables."""

from __future__ import annotations

import datetime as dt

import pytest

D = dt.date
PINNED_TODAY = D(2026, 9, 29)


def day(table, y, m, d):
    return table.price_for_day(D(y, m, d))


def test_day_pm_fix_on_requested_date(table):
    r = day(table, 1980, 1, 21)
    assert r == dict(price=850.0, granularity="day", effective="1980-01-21", points=1,
                     source="LBMA", note="LBMA fix on the requested date")


def test_day_falls_back_to_am_when_pm_missing(table):
    r = day(table, 1980, 1, 22)
    assert r["price"] == 845.0 and r["effective"] == "1980-01-22"
    assert r["note"] == "LBMA fix on the requested date"


def test_day_am_only_1968(table):
    r = day(table, 1968, 1, 2)
    assert (r["price"], r["effective"], r["source"]) == (35.18, "1968-01-02", "LBMA")


def test_day_weekend_rolls_back(table):
    for d, back in ((19, 1), (20, 2)):
        r = day(table, 1980, 1, d)
        assert r["price"] == 835.0
        assert r["effective"] == "1980-01-18"
        assert r["granularity"] == "day"
        assert r["note"] == (f"no LBMA fix on 1980-01-{d} (non-trading day); "
                             "used previous fix from 1980-01-18")


def test_day_rolls_back_exactly_nine_days(table):
    r = day(table, 1968, 3, 23)  # 9 days after the last pre-closure fix (1968-03-14)
    assert r["effective"] == "1968-03-14" and r["price"] == 38.0
    assert r["note"] == ("no LBMA fix on 1968-03-23 (non-trading day); "
                         "used previous fix from 1968-03-14")


def test_day_ten_days_without_a_fix_uses_monthly_with_accurate_note(table):
    r = day(table, 1968, 3, 24)
    assert r["granularity"] == "month" and r["effective"] == "1968-03"
    assert r["price"] == 38.0
    assert r["source"] == "World Bank Pink Sheet (monthly)"
    assert r["note"] == ("no LBMA fix within 9 days before 1968-03-24; "
                         "used the monthly price")


def test_day_first_fix_after_closure(table):
    r = day(table, 1968, 4, 1)
    assert (r["price"], r["effective"]) == (38.6, "1968-04-01")


def test_day_before_1968_uses_monthly(table):
    r = day(table, 1965, 6, 15)
    assert r == dict(price=35.10, granularity="month", effective="1965-06", points=1,
                     source="World Bank Pink Sheet (monthly)",
                     note="no daily data before 1968; used the monthly price")


def test_day_before_1960_uses_annual_table_source(table):
    r = day(table, 1955, 7, 4)
    assert r["price"] == 35.0 and r["effective"] == "1955-07"
    assert r["source"] == "Timothy Green / NMA table (annual average)"


def test_day_before_1968_last_day_of_1967(table):
    with pytest.raises(LookupError):
        day(table, 1967, 12, 31)  # no 1967 rows in the hand-made monthly table


def test_day_after_latest_fix_within_nine_days_rolls_back(table):
    r = table.price_for_day(D(2026, 9, 27))  # Sunday after the 2026-09-25 fix
    assert r["effective"] == "2026-09-25" and r["price"] == 3440.0
    assert r["note"] == ("no LBMA fix on 2026-09-27 (non-trading day); "
                         "used previous fix from 2026-09-25")
    r = table.price_for_day(D(2026, 10, 4))  # exactly 9 days later
    assert r["effective"] == "2026-09-25"
    assert r["note"].startswith("no LBMA fix on 2026-10-04")


def test_day_after_latest_fix_beyond_nine_days(table):
    r = table.price_for_day(D(2026, 10, 5))
    assert r == dict(price=3440.0, granularity="day", effective="2026-09-25", points=1,
                     source="LBMA",
                     note="requested date is after the latest available fix; "
                          "used 2026-09-25")


def test_day_far_gap_inside_lbma_era_uses_monthly(table):
    r = day(table, 1980, 1, 31)  # 9 days after 1980-01-22 -> found
    assert r["effective"] == "1980-01-22"
    r = table.price_for_day(D(2018, 12, 31))  # 26 days after 2018-12-05, monthly exists
    assert r["granularity"] == "month" and r["price"] == 1250.0
    assert "no LBMA fix within 9 days before 2018-12-31" in r["note"]


def test_day_without_any_data_raises(table):
    with pytest.raises(LookupError):
        table.price_for_day(D(1800, 1, 1))
    with pytest.raises(LookupError):
        table.price_for_day(D(1990, 5, 5))  # LBMA era, no fix in 9 days, no monthly row


def test_month_mean_of_daily_fixes(table):
    r = table.price_for_month(2018, 12, PINNED_TODAY)
    assert r["price"] == pytest.approx(1210.0)
    assert (r["granularity"], r["effective"], r["points"], r["source"]) == (
        "month", "2018-12", 3, "LBMA")
    assert r["note"] == "average of 3 LBMA daily fixes"


def test_month_mixes_pm_and_am_fallback(table):
    r = table.price_for_month(1980, 1, PINNED_TODAY)
    assert r["points"] == 3
    assert r["price"] == pytest.approx((835 + 850 + 845) / 3)


def test_month_1968_am_only_months(table):
    r = table.price_for_month(1968, 1, PINNED_TODAY)
    assert r["price"] == pytest.approx((35.18 + 35.20) / 2)
    assert r["points"] == 2


def test_month_current_month_is_month_to_date(table):
    r = table.price_for_month(2026, 9, PINNED_TODAY)
    assert r["price"] == pytest.approx(3420.0)
    assert r["points"] == 5
    assert r["note"] == "average of 5 LBMA daily fixes (month to date)"


def test_month_to_date_follows_today_not_last_fix(table):
    r = table.price_for_month(2026, 9, D(2026, 10, 1))
    assert r["note"] == "average of 5 LBMA daily fixes"


def test_month_before_daily_data_uses_monthly(table):
    r = table.price_for_month(1965, 6, PINNED_TODAY)
    assert r == dict(price=35.10, granularity="month", effective="1965-06", points=1,
                     source="World Bank Pink Sheet (monthly)",
                     note="monthly series value")


def test_month_monthly_source_label_boundary_at_1960(gv, tmp_path):
    from conftest import write_cache

    lbma, monthly = write_cache(tmp_path / "c", monthly=[("1959-12", "35.00"), ("1960-01", "35.05")])
    t = gv.GoldTable(lbma, monthly)
    assert t.price_for_month(1959, 12, PINNED_TODAY)["source"].startswith("Timothy Green")
    assert t.price_for_month(1960, 1, PINNED_TODAY)["source"] == "World Bank Pink Sheet (monthly)"


def test_month_without_data_raises(table):
    with pytest.raises(LookupError):
        table.price_for_month(1900, 1, PINNED_TODAY)


def test_year_mean_of_daily_fixes(table):
    r = table.price_for_year(2018, PINNED_TODAY)
    assert r["price"] == pytest.approx(1210.0)
    assert (r["granularity"], r["effective"], r["points"]) == ("year", "2018", 3)
    assert r["note"] == "average of 3 LBMA daily fixes"


def test_year_current_year_is_year_to_date(table):
    r = table.price_for_year(2026, PINNED_TODAY)
    assert r["points"] == 7
    assert r["price"] == pytest.approx((3010 + 3110 + 3400 + 3410 + 3420 + 3430 + 3440) / 7)
    assert r["note"] == "average of 7 LBMA daily fixes (year to date)"


def test_year_to_date_follows_today(table):
    r = table.price_for_year(2026, D(2027, 1, 2))
    assert r["note"] == "average of 7 LBMA daily fixes"


def test_year_1968_mixes_am_only_and_pm(table):
    r = table.price_for_year(1968, PINNED_TODAY)
    assert r["points"] == 5
    assert r["price"] == pytest.approx((35.18 + 35.20 + 38.0 + 38.6 + 38.8) / 5)


def test_year_before_1968_averages_monthly_values(table):
    r = table.price_for_year(1965, PINNED_TODAY)
    assert r["price"] == pytest.approx((11 * 35.0 + 35.10) / 12)
    assert (r["granularity"], r["points"], r["note"]) == (
        "year", 12, "average of 12 monthly values")
    assert r["source"] == "World Bank Pink Sheet (monthly)"


def test_year_1955_annual_value_repeated_per_month(table):
    r = table.price_for_year(1955, PINNED_TODAY)
    assert r["price"] == pytest.approx(35.0)
    assert r["points"] == 12
    assert r["source"] == "Timothy Green / NMA table (annual average)"


def test_year_without_data_raises(table):
    with pytest.raises(LookupError):
        table.price_for_year(1800, PINNED_TODAY)


def test_resolve_dispatches_on_kind(gv, table):
    assert gv.resolve(table, "day", D(1980, 1, 21), PINNED_TODAY)["granularity"] == "day"
    assert gv.resolve(table, "month", D(1980, 1, 1), PINNED_TODAY)["granularity"] == "month"
    assert gv.resolve(table, "year", D(1980, 1, 1), PINNED_TODAY)["granularity"] == "year"


def test_ensure_covers_offline_never_refreshes(gv, cache_dir, table):
    table.ensure_covers(D(2030, 1, 1))  # would refresh if online; _download would raise
    assert table.last_daily == D(2026, 9, 25)


def test_loader_reads_crlf_and_am_pm_columns(gv, tmp_path):
    lbma = tmp_path / "l.csv"
    monthly = tmp_path / "m.csv"
    lbma.write_bytes(b"date,usd_am,usd_pm\r\n2000-01-04,282.00,\r\n2000-01-05,283.50,284.00\r\n")
    monthly.write_bytes(b"month,usd\r\n2000-01,284.00\r\n")
    t = gv.GoldTable(lbma, monthly)
    assert t.daily == {D(2000, 1, 4): 282.0, D(2000, 1, 5): 284.0}
    assert t.monthly == {(2000, 1): 284.0}
