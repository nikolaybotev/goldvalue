from __future__ import annotations

import argparse
import datetime as dt

import pytest

D = dt.date


@pytest.mark.parametrize(
    "text, kind, anchor",
    [
        # FR2: year
        ("2024", "year", D(2024, 1, 1)),
        ("1955", "year", D(1955, 1, 1)),
        # FR2: month forms
        ("2024-06", "month", D(2024, 6, 1)),
        ("06/2024", "month", D(2024, 6, 1)),
        ("2024/06", "month", D(2024, 6, 1)),
        ("Jun 2024", "month", D(2024, 6, 1)),
        ("June 2024", "month", D(2024, 6, 1)),
        # FR2: day forms
        ("2024-06-03", "day", D(2024, 6, 3)),
        ("06/03/2024", "day", D(2024, 6, 3)),
        ("3 June 2024", "day", D(2024, 6, 3)),
        ("3 Jun 2024", "day", D(2024, 6, 3)),
        ("June 3, 2024", "day", D(2024, 6, 3)),
        ("Jun 3, 2024", "day", D(2024, 6, 3)),
        # May is both a full and an abbreviated month name
        ("May 2024", "month", D(2024, 5, 1)),
        ("3 May 2024", "day", D(2024, 5, 3)),
        ("May 3, 2024", "day", D(2024, 5, 3)),
        # lenient strptime behaviour that the TypeScript port must reproduce
        ("2024-6-3", "day", D(2024, 6, 3)),
        ("6/3/2024", "day", D(2024, 6, 3)),
        ("2024-6", "month", D(2024, 6, 1)),
        ("6/2024", "month", D(2024, 6, 1)),
        ("2024/6", "month", D(2024, 6, 1)),
        ("3 june 2024", "day", D(2024, 6, 3)),
        ("JUNE 3, 2024", "day", D(2024, 6, 3)),
        ("jun 2024", "month", D(2024, 6, 1)),
        ("03 Jun 2024", "day", D(2024, 6, 3)),
        ("3  June  2024", "day", D(2024, 6, 3)),
        ("June  3,  2024", "day", D(2024, 6, 3)),
        ("  2024-06-03  ", "day", D(2024, 6, 3)),
        ("2024-02-29", "day", D(2024, 2, 29)),
        # boundaries
        ("1968-01-02", "day", D(1968, 1, 2)),
        ("1833-01", "month", D(1833, 1, 1)),
        ("0001", "year", D(1, 1, 1)),
    ],
)
def test_parse_period_accepts(gv, text, kind, anchor):
    assert gv.parse_period(text) == (kind, anchor)


@pytest.mark.parametrize("keyword", ["today", "now", "latest", "TODAY", " Now ", "Latest"])
def test_today_keywords_use_hook(gv, keyword):
    assert gv.parse_period(keyword) == ("day", D(2026, 9, 29))


def test_today_hook_changes_result(gv, monkeypatch):
    monkeypatch.setenv("GOLDVALUE_TODAY", "2001-02-03")
    assert gv.parse_period("today") == ("day", D(2001, 2, 3))


def test_today_without_hook_is_local_date(gv, monkeypatch):
    monkeypatch.delenv("GOLDVALUE_TODAY")
    assert gv.parse_period("today") == ("day", dt.date.today())


@pytest.mark.parametrize(
    "text",
    [
        "",
        "   ",
        "abc",
        "24",
        "12345",
        "0000",
        "2024-13",
        "2024-00",
        "2024-02-30",
        "2023-02-29",
        "2024-06-31",
        "13/2024",
        "13/01/2024",
        "2024.06",
        "2024.06.03",
        "20240603",
        "Sept 2024",
        "Foo 2024",
        "31 Feb 2024",
        "2024-06-03T00:00:00",
        "2024-06-03 12:00",
        "yesterday",
        "tomorrow",
        "1e3",
        "２０２４",  # full-width digits
        "٢٠٢٤",  # Arabic-indic digits
        "²⁰²⁴",  # superscripts (str.isdigit() is true for these)
    ],
)
def test_parse_period_rejects(gv, text):
    with pytest.raises(argparse.ArgumentTypeError):
        gv.parse_period(text)


def test_today_hook_must_be_valid(gv, monkeypatch):
    for bad in ("20260929", "2026-9-29", "2026-02-30", "tomorrow"):
        monkeypatch.setenv("GOLDVALUE_TODAY", bad)
        with pytest.raises(SystemExit) as exc:
            gv.today_date()
        assert "GOLDVALUE_TODAY" in str(exc.value)


@pytest.mark.parametrize(
    "text, value",
    [
        ("1500", 1500.0),
        ("$1,500", 1500.0),
        ("1,500.50", 1500.5),
        ("-1,500", -1500.0),
        ("-$1,500", -1500.0),
        ("$-1,500", -1500.0),
        ("+7", 7.0),
        (".5", 0.5),
        ("5.", 5.0),
        ("0", 0.0),
        ("1_000", 1000.0),
        ("  42  ", 42.0),
        ("$1,234,567.89", 1234567.89),
    ],
)
def test_parse_amount_accepts(gv, text, value):
    assert gv.parse_amount(text) == value


@pytest.mark.parametrize(
    "text",
    [
        "",
        None,
        "abc",
        "nan",
        "NaN",
        "inf",
        "-inf",
        "Infinity",
        "-Infinity",
        "1e3",
        "1E3",
        "2.5e-3",
        "1e400",
        "1" * 400,
        "1.2.3",
        "--5",
        "+-5",
        "$",
        "-",
        ".",
        "1 500",
        "0x10",
        "１２３",
    ],
)
def test_parse_amount_rejects(gv, text):
    with pytest.raises(argparse.ArgumentTypeError):
        gv.parse_amount(text)


@pytest.mark.parametrize(
    "text, unit",
    [("usd", "USD"), ("$", "USD"), ("GB", "GB"), ("goldbacks", "GB"), ("gbd", "GBD"),
     ("Gold-Backed-Dollar", "GBD"), ("oz", "OZ"), ("troy oz", "OZ"), ("ounces", "OZ")],
)
def test_parse_unit(gv, text, unit):
    assert gv.parse_unit(text) == unit


def test_parse_unit_rejects(gv):
    with pytest.raises(argparse.ArgumentTypeError):
        gv.parse_unit("eur")


def test_check_not_future(gv):
    today = D(2026, 9, 29)
    gv.check_not_future(D(2026, 9, 29), "today", today)
    gv.check_not_future(D(2026, 9, 1), "2026-09", today)
    gv.check_not_future(D(2026, 1, 1), "2026", today)
    with pytest.raises(argparse.ArgumentTypeError, match="in the future"):
        gv.check_not_future(D(2026, 9, 30), "2026-09-30", today)
    with pytest.raises(argparse.ArgumentTypeError, match="in the future"):
        gv.check_not_future(D(2026, 10, 1), "2026-10", today)
    with pytest.raises(argparse.ArgumentTypeError, match="in the future"):
        gv.check_not_future(D(2027, 1, 1), "2027", today)
