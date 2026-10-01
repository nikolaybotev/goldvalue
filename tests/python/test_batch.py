"""`--batch`: FR15 output schema, FR14 input rules, future-date rejection, round trip."""

from __future__ import annotations

import csv
import io

import pytest

FR15 = ["date", "amount", "currency", "label"]
COMPUTED = ["effective", "gold_usd_per_oz", "troy_oz", "GB", "GBD", "USD", "price_source",
            "granularity", "note", "fx_rate", "fx_effective", "fx_mode", "fx_note",
            "gold_mode", "ma_years", "ma_months", "spot_usd_per_oz"]


def run(gv, capsys, tmp_path, text, *extra, name="in.csv", newline="\n", encoding="utf-8"):
    path = tmp_path / name
    path.write_bytes(text.replace("\n", newline).encode(encoding))
    assert gv.main(["--batch", str(path), *extra]) == 0
    captured = capsys.readouterr()
    return captured.out, captured.err


def parse(out):
    rows = list(csv.reader(io.StringIO(out)))
    return rows[0], [dict(zip(rows[0], r)) for r in rows[1:]]


def test_schema_and_order_with_label_and_passthrough(gv, capsys, tmp_path, cache_dir):
    out, _ = run(gv, capsys, tmp_path,
                 "Date,Amount,Label,Region,Notes\n1980-01-21,1000,house,west,x\n")
    header, rows = parse(out)
    assert header == [*FR15, "Region", "Notes", *COMPUTED]
    r = rows[0]
    assert (r["date"], r["amount"], r["currency"], r["label"], r["Region"], r["Notes"]) == (
        "1980-01-21", "1000", "USD", "house", "west", "x")
    assert r["effective"] == "1980-01-21"
    assert r["gold_usd_per_oz"] == "850.0000"
    assert r["troy_oz"] == "1.176471"
    assert r["GB"] == "1176.471"
    assert r["GBD"] == "58.8235"
    assert r["USD"] == "1000.00"
    assert r["price_source"] == "LBMA"
    assert r["granularity"] == "day"
    assert r["note"] == "LBMA fix on the requested date"
    assert [r[k] for k in ("fx_rate", "fx_effective", "fx_mode", "fx_note")] == ["", "", "", ""]
    assert r["gold_mode"] == "spot" and r["ma_years"] == "" and r["ma_months"] == ""
    assert r["spot_usd_per_oz"] == r["gold_usd_per_oz"] == "850.0000"


def test_label_column_is_always_present_and_empty_when_absent(gv, capsys, tmp_path, cache_dir):
    out, _ = run(gv, capsys, tmp_path, "date,amount\n1980-01-21,1000\n")
    header, rows = parse(out)
    assert header == [*FR15, *COMPUTED]
    assert rows[0]["label"] == ""


def test_amount_echoes_input_token(gv, capsys, tmp_path, cache_dir):
    out, _ = run(gv, capsys, tmp_path, 'date,amount\n1980-01-21,"$1,000.50"\n1980-01-21,-5\n')
    _, rows = parse(out)
    assert [r["amount"] for r in rows] == ["$1,000.50", "-5"]
    assert rows[0]["USD"] == "1000.50" and rows[1]["USD"] == "-5.00"
    assert rows[1]["GB"].startswith("-5.88")


def test_date_column_echoes_original_token(gv, capsys, tmp_path, cache_dir):
    out, _ = run(gv, capsys, tmp_path, 'date,amount\n"Jan 21, 1980",1\n2018-12,1\n1955,1\n')
    _, rows = parse(out)
    assert [r["date"] for r in rows] == ["Jan 21, 1980", "2018-12", "1955"]
    assert [r["granularity"] for r in rows] == ["day", "month", "year"]
    assert [r["effective"] for r in rows] == ["1980-01-21", "2018-12", "1955"]


@pytest.mark.parametrize("date_name", ["period", "Month", "YEAR"])
@pytest.mark.parametrize("amt_name", ["usd", "Value", "PRICE"])
def test_header_aliases_are_case_insensitive(gv, capsys, tmp_path, cache_dir, date_name, amt_name):
    out, _ = run(gv, capsys, tmp_path, f"{date_name},{amt_name}\n1980-01-21,850\n")
    header, rows = parse(out)
    assert header[:2] == ["date", "amount"]
    assert rows[0]["troy_oz"] == "1.000000"


def test_first_alias_wins_and_others_pass_through(gv, capsys, tmp_path, cache_dir):
    out, _ = run(gv, capsys, tmp_path, "year,date,price,amount\n1999,1980-01-21,1,850\n")
    header, rows = parse(out)
    assert header == [*FR15, "year", "price", *COMPUTED]
    assert rows[0]["date"] == "1980-01-21" and rows[0]["amount"] == "850"
    assert rows[0]["year"] == "1999" and rows[0]["price"] == "1"


def test_currency_column_is_dropped_and_regenerated(gv, capsys, tmp_path, cache_dir):
    out, _ = run(gv, capsys, tmp_path, "date,amount,currency\n1980-01-21,850,EUR\n")
    header, rows = parse(out)
    assert header.count("currency") == 1
    assert rows[0]["currency"] == "USD"


def test_non_usd_unit_is_reported_in_currency_column(gv, capsys, tmp_path, cache_dir):
    out, _ = run(gv, capsys, tmp_path, "date,amount\n1980-01-21,100\n", "--from", "GB")
    _, rows = parse(out)
    assert rows[0]["currency"] == "GB"
    assert rows[0]["USD"] == "85.00" and rows[0]["troy_oz"] == "0.100000"


def test_computed_columns_in_input_are_ignored(gv, capsys, tmp_path, cache_dir):
    text = ("date,amount,currency,label,effective,gold_usd_per_oz,troy_oz,GB,GBD,USD,"
            "price_source,granularity,note,fx_rate,fx_effective,fx_mode,fx_note,"
            "gold_mode,ma_years,ma_months,spot_usd_per_oz\n"
            "1980-01-21,850,USD,l,BOGUS,1,2,3,4,999999,S,G,N,1,2,3,4,partial,99,1,1\n")
    out, _ = run(gv, capsys, tmp_path, text)
    header, rows = parse(out)
    assert header == [*FR15, *COMPUTED]
    r = rows[0]
    assert r["amount"] == "850" and r["label"] == "l"
    assert r["effective"] == "1980-01-21" and r["USD"] == "850.00"
    assert r["price_source"] == "LBMA" and r["fx_rate"] == ""
    assert r["gold_mode"] == "spot" and r["ma_years"] == "" and r["ma_months"] == ""
    assert r["spot_usd_per_oz"] == "850.0000"


def test_usd_is_amount_alias_unless_header_is_an_export(gv, capsys, tmp_path, cache_dir):
    out, _ = run(gv, capsys, tmp_path, "date,USD,memo\n1980-01-21,850,m\n")
    header, rows = parse(out)
    assert header == [*FR15, "memo", *COMPUTED]
    assert rows[0]["amount"] == "850" and rows[0]["troy_oz"] == "1.000000"


def test_amount_is_never_taken_from_computed_usd_column(gv, capsys, tmp_path, cache_dir):
    text = "date,USD,troy_oz\n1980-01-21,850,1\n"
    path = tmp_path / "x.csv"
    path.write_text(text)
    with pytest.raises(SystemExit) as exc:
        gv.main(["--batch", str(path)])
    assert "'amount' column" in str(exc.value)


def test_output_is_idempotent_when_fed_back(gv, capsys, tmp_path, cache_dir):
    src = ("Date,Amount,Label,Region\n"
           '1980-01-21,"$1,000",a,w\nMar 1968,50,b,e\n1955,10,c,n\n2026-09,3,d,s\n')
    first, _ = run(gv, capsys, tmp_path, src)
    second, _ = run(gv, capsys, tmp_path, first, name="second.csv")
    assert second == first


def test_output_uses_lf_line_endings_and_no_stray_cr(gv, capsys, tmp_path, cache_dir):
    out, _ = run(gv, capsys, tmp_path, "date,amount\n1980-01-21,1\n", newline="\r\n")
    assert "\r" not in out and out.endswith("\n")


def test_crlf_input_and_bom_are_accepted(gv, capsys, tmp_path, cache_dir):
    out, _ = run(gv, capsys, tmp_path, "date,amount,label\n1980-01-21,850,x\n",
                 newline="\r\n", encoding="utf-8-sig")
    header, rows = parse(out)
    assert header[:4] == FR15 and rows[0]["label"] == "x"


def test_stdin_input(gv, capsys, tmp_path, cache_dir, monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO("\ufeffdate,amount\n1980-01-21,850\n"))
    assert gv.main(["--batch", "-"]) == 0
    _, rows = parse(capsys.readouterr().out)
    assert rows[0]["troy_oz"] == "1.000000"


def test_blank_lines_are_skipped(gv, capsys, tmp_path, cache_dir):
    out, _ = run(gv, capsys, tmp_path, "date,amount\n\n1980-01-21,850\n\n")
    assert len(parse(out)[1]) == 1


def test_batch_rejects_future_dates_with_line_number(gv, capsys, tmp_path, cache_dir):
    path = tmp_path / "f.csv"
    path.write_text("date,amount\n1980-01-21,1\n2026-09-30,1\n")
    with pytest.raises(SystemExit) as exc:
        gv.main(["--batch", str(path)])
    assert "line 3" in str(exc.value) and "date is in the future" in str(exc.value)
    assert capsys.readouterr().out == ""


@pytest.mark.parametrize("token", ["2027", "2026-10", "Oct 1, 2026"])
def test_batch_rejects_future_periods(gv, tmp_path, cache_dir, token):
    path = tmp_path / "f.csv"
    path.write_text(f"date,amount\n{token},1\n")
    with pytest.raises(SystemExit):
        gv.main(["--batch", str(path)])


def test_batch_accepts_today_and_current_period(gv, capsys, tmp_path, cache_dir):
    out, _ = run(gv, capsys, tmp_path, "date,amount\ntoday,1\n2026-09,1\n2026,1\n")
    _, rows = parse(out)
    assert rows[1]["note"] == "average of 5 LBMA daily fixes (month to date)"
    assert rows[2]["note"] == "average of 7 LBMA daily fixes (year to date)"


@pytest.mark.parametrize("bad", ["nan", "inf", "1e3", "abc", ""])
def test_batch_rejects_bad_amounts_with_line_number(gv, tmp_path, cache_dir, bad):
    path = tmp_path / "b.csv"
    path.write_text(f"date,amount\n1980-01-21,1\n1980-01-21,{bad}\n")
    with pytest.raises(SystemExit) as exc:
        gv.main(["--batch", str(path)])
    assert "line 3" in str(exc.value) and "invalid amount" in str(exc.value)


def test_batch_rejects_bad_date_with_line_number(gv, tmp_path, cache_dir):
    path = tmp_path / "b.csv"
    path.write_text("date,amount\nnope,1\n")
    with pytest.raises(SystemExit) as exc:
        gv.main(["--batch", str(path)])
    assert "line 2" in str(exc.value)


def test_batch_short_row_is_a_line_error(gv, tmp_path, cache_dir):
    path = tmp_path / "b.csv"
    path.write_text("date,amount\n1980-01-21\n")
    with pytest.raises(SystemExit) as exc:
        gv.main(["--batch", str(path)])
    assert "line 2" in str(exc.value)


def test_batch_missing_columns(gv, tmp_path, cache_dir):
    path = tmp_path / "b.csv"
    path.write_text("when,how much\n1980-01-21,1\n")
    with pytest.raises(SystemExit) as exc:
        gv.main(["--batch", str(path)])
    assert "'date' column and an 'amount' column" in str(exc.value)


def test_batch_empty_and_missing_file(gv, tmp_path, cache_dir):
    empty = tmp_path / "e.csv"
    empty.write_text("")
    with pytest.raises(SystemExit) as exc:
        gv.main(["--batch", str(empty)])
    assert "empty" in str(exc.value)
    with pytest.raises(SystemExit) as exc:
        gv.main(["--batch", str(tmp_path / "missing.csv")])
    assert "cannot read" in str(exc.value)


def test_batch_header_only_writes_header(gv, capsys, tmp_path, cache_dir):
    out, _ = run(gv, capsys, tmp_path, "date,amount\n")
    header, rows = parse(out)
    assert header == [*FR15, *COMPUTED] and rows == []


def test_batch_skips_rows_without_data(gv, capsys, tmp_path, cache_dir):
    out, err = run(gv, capsys, tmp_path, "date,amount\n1990-05-05,1\n1980-01-21,850\n")
    _, rows = parse(out)
    assert len(rows) == 1 and rows[0]["effective"] == "1980-01-21"
    assert "row skipped" in err


def test_batch_matches_single_query_json(gv, capsys, tmp_path, cache_dir):
    import json

    out, _ = run(gv, capsys, tmp_path, "date,amount\n2018-12,80000\n")
    _, rows = parse(out)
    gv.main(["--json", "80000", "2018-12"])
    single = json.loads(capsys.readouterr().out)
    r = rows[0]
    assert float(r["GB"]) == pytest.approx(single["GB"], abs=5e-4)
    assert float(r["GBD"]) == pytest.approx(single["GBD"], abs=5e-5)
    assert float(r["troy_oz"]) == pytest.approx(single["troy_oz"], abs=5e-7)
    assert float(r["gold_usd_per_oz"]) == pytest.approx(single["gold_usd_per_oz"], abs=5e-5)
    assert (r["effective"], r["granularity"], r["note"], r["price_source"]) == (
        single["effective"], single["granularity"], single["note"], single["price_source"])


def test_fixed_formatting_has_no_exponents_and_no_negative_zero(gv):
    assert gv.fixed(0.0000004, 6) == "0.000000"
    assert gv.fixed(-0.0, 2) == "0.00"
    assert gv.fixed(1e-06, 6) == "0.000001"
    assert gv.fixed(12345678.9, 2) == "12345678.90"


def test_duplicate_header_names_first_column_wins(gv, capsys, tmp_path, cache_dir):
    out, _ = run(gv, capsys, tmp_path,
                 "date,Amount,region,Region,DATE,amount\n1980-01-21,850,a,b,1999-01-01,1\n")
    header, rows = parse(out)
    assert header == [*FR15, "region", *COMPUTED]
    assert rows[0]["date"] == "1980-01-21" and rows[0]["amount"] == "850"
    assert rows[0]["region"] == "a"


def test_passthrough_columns_that_collide_with_output_names_are_dropped(
        gv, capsys, tmp_path, cache_dir):
    out, _ = run(gv, capsys, tmp_path,
                 "date,amount,USD,Note,GB,granularity,keep\n1980-01-21,850,7,n,8,g,k\n")
    header, rows = parse(out)
    assert header == [*FR15, "keep", *COMPUTED]
    assert rows[0]["keep"] == "k" and rows[0]["USD"] == "850.00" and rows[0]["note"] != "n"


def test_extra_fields_beyond_header_are_ignored(gv, capsys, tmp_path, cache_dir):
    out, _ = run(gv, capsys, tmp_path, "date,amount\n1980-01-21,850,extra,more\n")
    _, rows = parse(out)
    assert rows[0]["amount"] == "850"


def test_multiline_quoted_field_reports_end_line(gv, tmp_path, cache_dir):
    path = tmp_path / "m.csv"
    path.write_text('date,amount,label\n1980-01-21,850,"two\nlines"\nbad,1,x\n')
    with pytest.raises(SystemExit) as exc:
        gv.main(["--batch", str(path)])
    assert "line 4" in str(exc.value)
