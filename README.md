# GoldValue

Re-denominate dated US dollar amounts into gold units so values from different
eras are comparable:

- **GB** — goldback, 1/1000 troy oz of gold
- **GBD** — gold-backed dollar, 1/50 troy oz (50 GBD per troy oz)
- **OZ** — troy ounce

Prices come from the LBMA Gold Price (daily, 1968–present) and the World Bank /
Timothy Green monthly series (1833–present), fetched once and cached locally.

## Contents

| Path | What |
|---|---|
| `skill/gold-value-normalizer/` | Agent skill (Cursor / Claude) with the reference Python CLI `scripts/goldvalue.py` |
| `intent.md` → `spec.md` → `plan.md` | AI-native SDLC artifacts for the companion web app |

## Quick start (CLI)

```bash
python3 skill/gold-value-normalizer/scripts/goldvalue.py 80000 2018-12
python3 skill/gold-value-normalizer/scripts/goldvalue.py 200000 today
python3 skill/gold-value-normalizer/scripts/goldvalue.py --batch series.csv > series_gold.csv
```

Standard library only (Python 3.9+). Cache lives in `~/.cache/gold-value/`
(override with `GOLD_PRICE_CACHE_DIR`).

## Using as an agent skill

Symlink or copy `skill/gold-value-normalizer` into your skills directory, e.g.

```bash
ln -s "$(pwd)/skill/gold-value-normalizer" ~/.cursor/skills/gold-value-normalizer
```

## Method

Conversions are gold-denominated, not CPI-based. See
`skill/gold-value-normalizer/reference.md` for sources and resolution rules and
`skill/gold-value-normalizer/historical-notes.md` for the simplifying assumptions
in the pre-1974 era.

## Data terms

LBMA price data is provided for personal, non-commercial use under LBMA's terms.
The monthly series is Open Data Commons PDDL.
