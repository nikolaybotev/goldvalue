# intent.md — Smoothed gold gauge (v1.2)

| | |
|---|---|
| Author | Nikolay Botev |
| Captured | 2026-09-30 |
| Status | Draft — awaiting product-owner acceptance |
| Stage | 1 · Plan |
| Feeds | [spec.md](spec.md) → [plan.md](plan.md) |
| Builds on | [../companion-app/](../companion-app/) (v1.0 spot conversion, v1.1 FX) |

## Problem

The app answers a precise question: at each dated dollar amount, how much gold
did that money buy, using the gold price on that date. That is the right
answer to "if I had bought gold that day instead of this house, stock, or
other security, how much gold would I hold, and what is it worth now."

A broader question is also interesting. Taking a gold unit as an imperfect but
acceptable store-of-value gauge over a long horizon (10–20 years or more), how
does the security's price measure up at the snapshot dates. Gold does not
drift smoothly with the cost of living. It can hold a range while purchasing
power erodes, then reprice in a spike when that range breaks. A one-day or
one-month fix makes a security look suddenly cheap or expensive because of
where gold is in that path, not because the security changed. A 200-day moving
average, the usual trading window, is too short to look past one of those
spikes.

This is a premise for a tool, not a claim about inflation or monetary history.
The app must say so.

## Proposed outcome

A sheet-wide choice of gold price: the existing spot fix, or a long trailing
average of the gold price. Snapshot rows and the chart recompute in that
gauge. The window is long enough for a 10–20 year horizon and the user can
change it. Spot remains available, including as a comparison on the chart.

## Affected users and systems

- Users comparing a security's price at several dates over a decade or more.
- The CLI and `packages/core`, which stay the parity reference.
- The SPA sheet, chart, Method panel, and CSV export.
- No new price source. The average is computed from the gold series already used.

## Constraints and principles

- The average is a smoothing choice. It is not CPI, not a proof that gold
  tracks inflation, and not a forecast. The Method panel says this in one
  sentence.
- Spot conversion (v1) stays the default, so existing answers do not change
  until the user opts into the gauge.
- Trailing, not centered: the gauge at a date uses only prices up to that date.
- USD-normalized gold (P1) and no LBMA redistribution (D15) are unchanged.
- Python remains the reference; the TypeScript port matches it on vectors.

## Open questions (carried into spec.md)

1. Which window is the default, and which presets are offered?
2. Average trading days, or average months so a quiet year weighs the same as a volatile one?
3. Show the spot series on the chart next to the smoothed series, or only the selected gauge?

## Original prompt (verbatim)

> So now our app answers the question: if I had bought gold on this date instead of security X (property, house, stock whatever security), how much would that be worth today.
>
> That is useful...
>
> But a broader question is interesting also - assuming a gold-unit as an imperfect but acceptable / interesting store-of-value gauge over a long horizon (10-20 years or more), how does the security price measure up at the given snapshot points....
>
> To answer that broader question it seems to me like we could lean on the Moving Average approach... the question becomes - what MA interval do we pick? 200 is not enough - looking back 20 years, gold prices do not just move up or down, but also jump in price in these spikey fashions - they hold price while inflation gradually accrues and just eventually when resistance collapses they catch up to inflation in one fell swoop - yes, that is just one way to look at it, not proven, not saying this is accurate - just a premise on which we can build a functioning tool without getting buried in a heated discussion on a complex topic that could consume years of time of an Economics PhD student.
>
> Let's restart the cycle - treat this as my intent.md prompt for a v1.2 and kick off drafts of a spec.md and plan.md for us to build this.

## Source transcript (verbatim)

Chat `600b6d01-b9cc-4204-a8cc-630eb188224c`, agent request
`c3c74dfc-7e0b-491a-8365-71a62d8a622d`, 2026-09-30 17:41 PDT. The user asked
for a goldback conversion of one property timeline. The answer below is what
the v1.2 prompt was written after. No interpretation in this section.

### User

> Convert the following dollar amounts in timeline to goldbacks
>
> 1240 Duffy Way — ownership / deed / mortgage timeline (from CRS Property Report + First American prelim in the disclosure package; APN 017-201-017-5)
>
> 2000-04-18 — Intrafamily transfer: Jack P. Hernandez Jr. & Linda G. Hernandez (doc 2000-077659). Related mortgage ~$70k Provident (2000-077660).
>
> 2001-10-01 — Sale $235,000 → Francisco Chavez from the Hernandezes (2001-294323). Purchase loan ~$231k Wausau (2001-294324). Later Chavez-era loans: 2004–2005 Greenpoint / Countrywide / Wausau (sizes in CRS mortgage history).
>
> 2009-03-10 — Trustees deed $128,223 → Wells Fargo Bank, N.A. from Chavez (2009-049335) — foreclosure path.
>
> 2009-04-23 — Sale $145,000 → James M. Osbon & Sally Chapman Osbon from Wells Fargo (2009-089510).
>
> 2014-02-07 — Sale $170,000 → Krystofer C. Medeiros from the Osbons (2014-020079). Purchase loan ~$138k American Pacific (2014-020080). Later Medeiros loans: 2017 ~$240k Arkady Stern; 2018 ~$292k Vip Pacific.
>
> 2019-11-12 — Sale $444,000 → Camren Morain & Mackenzie Fountain (JT) from Medeiros (Grant Deed 2019-201462). Same day: CrossCountry / MERS DOT $435,958 (2019-201463) — still the active first lien on the prelim.
>
> 2021-05-04 — HUD mortgage $10,571.52 recorded (2021-133259; CRS also ties Flagstar). Junior / federal assistance–style lien; title needs a separate HUD payoff demand.
>
> CRS note: No foreclosure found on this parcel after the 2009 trustees deed. Current listing ask ~$599,900 (2026).
>
> If you want the same chain pulled fresh from the Contra Costa recorder index (not just CRS/prelim), say the word and I’ll run that search.

### Answer

> **1240 Duffy Way** — same ownership chain, with nominal dollars converted to **goldbacks (GB)** using the historical **LBMA** USD gold price on each event date (daily fix where available; **2017**, **2018**, and **2026** listing use the **calendar-year average** of daily fixes). One GB = 1/1000 troy oz of gold. This is a **gold-denominated** comparison, not CPI “inflation-adjusted dollars”; gold and CPI can diverge a lot. Approximate loan figures (~$70k, ~$231k, etc.) use the rounded nominal amounts you gave.
>
> | Date | Event (nominal USD) | Gold @ conversion | GB |
> |------|---------------------|-------------------|-----|
> | **2000-04-18** | Intrafamily transfer; mortgage **~$70,000** | $281.10/oz (day) | **249,022 GB** |
> | **2001-10-01** | Sale **$235,000** → Chavez | $290.60/oz | **808,672 GB** |
> | **2001-10-01** | Purchase loan **~$231,000** (Wausau) | $290.60/oz | **794,907 GB** |
> | **2009-03-10** | Trustees deed **$128,223** → Wells Fargo | $901.50/oz | **142,233 GB** |
> | **2009-04-23** | Sale **$145,000** → Osbons | $897.50/oz | **161,560 GB** |
> | **2014-02-07** | Sale **$170,000** → Medeiros | $1,259.25/oz | **135,001 GB** |
> | **2014-02-07** | Purchase loan **~$138,000** (American Pacific) | $1,259.25/oz | **109,589 GB** |
> | **2017** | Loan **~$240,000** (Arkady Stern) | $1,257.34/oz (yr avg) | **190,878 GB** |
> | **2018** | Loan **~$292,000** (Vip Pacific) | $1,268.51/oz (yr avg) | **230,191 GB** |
> | **2019-11-12** | Sale **$444,000** → Morain / Fountain | $1,452.05/oz | **305,775 GB** |
> | **2019-11-12** | CrossCountry / MERS DOT **$435,958** | $1,452.05/oz | **300,236 GB** |
> | **2021-05-04** | HUD mortgage **$10,571.52** recorded | $1,797.75/oz | **5,880 GB** |
> | **2026** | Listing ask **~$599,900** | $4,548.54/oz (YTD 2026 avg) | **131,888 GB** |
>
> ### Reading it in gold terms
>
> - **Peak nominal sale (2019, $444k)** ≈ **306k GB** — the highest gold-weight on this list.
> - **Foreclosure-era trustees deed (2009, $128k)** ≈ **142k GB** — not the bottom in gold; the **2001 Chavez purchase (~809k GB)** and **~$231k loan (~795k GB)** were far larger in gold because gold was ~$290/oz.
> - **2026 ask (~$600k)** ≈ **132k GB** — in goldbacks, the current ask is **well below** the 2019 sale (~306k GB) and even below the 2009 Osbon purchase (~162k GB), because nominal prices rose much faster than the gold price used here.
>
> 2004–2005 Chavez-era Greenpoint / Countrywide / Wausau balances weren’t given as dollar figures, so they aren’t converted. If you want those from CRS or a fresh Contra Costa index pull, share amounts and dates and I’ll add GB columns. Same if you want **GBD** (50 per troy oz) or a side-by-side **CPI** table.
