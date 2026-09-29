# Historical notes: the $35 era and what the price series does and does not capture

Background only. Not needed to run the skill; it documents the simplifying
assumptions behind conversions dated before 1974.

## The official $35/oz price

- Set by the US Gold Reserve Act, 31 January 1934 (up from $20.67, where it had
  stood since 1834/1837 with a brief Civil War interruption).
- Bretton Woods (agreed July 1944; IMF operational 1946-47) pegged other
  currencies to a dollar that was itself convertible into gold at $35 (+/- 0.25%).
- The $35 window applied **only** to foreign governments and central banks.
  US citizens were barred from owning monetary gold from 1933 to 31 Dec 1974.
  Private markets abroad were free to trade at other prices.

## Timeline of the end

| Date | Event | Official USD price |
|------|-------|--------------------|
| 15 Aug 1971 | Nixon suspends dollar-gold convertibility (the "Nixon shock"); effective end of Bretton Woods | $35 |
| 18 Dec 1971 | Smithsonian Agreement devalues the dollar | $38 |
| 12 Feb 1973 | Second devaluation | $42.22 |
| Mar 1973 | Major currencies float; system formally dead | $42.22 (still the US Treasury's book value for its gold reserves) |
| 31 Dec 1974 | Private gold ownership legal again in the US | - |

## Where the market price diverged from $35

1. **1946-1953, premium markets.** The London market was closed (Sept 1939 to
   March 1954). Gold traded legally outside the official system in Paris,
   Zurich, Tangier, Beirut, Macau, Hong Kong and elsewhere at roughly $40-55,
   i.e. 15-55% over official. The IMF campaigned against "premium gold" sales by
   producer countries (South Africa in particular). This is the largest sustained
   divergence of the era.
2. **1954-1960.** London reopens; price held within ~$34.70-35.20 as the US and
   Bank of England supplied the market.
3. **October 1960 spike.** London briefly reached ~$40 (about 14% over) on
   devaluation fears ahead of the Kennedy election. Response: the London Gold
   Pool (Nov 1961), eight central banks selling to cap the price near $35.20.
4. **1968-1971, two-tier system.** The sterling devaluation (Nov 1967) set off a
   run that drained the Gold Pool. London closed 15-31 March 1968 and reopened
   1 April 1968 with a free-floating private price alongside the $35 official
   tier. Free market: ~$43 in 1968-69 (about 20% over), back to ~$35 in early
   1970, ~$44 by August 1971, $65-70 in 1972, $100-195 in 1973-74.
5. **Genuine black markets.** In countries banning private ownership - India
   above all (Gold Control Act 1962/1968), also much of the Middle East and
   Southeast Asia - smuggled gold carried premiums of 50-100% over the world
   price for most of the period. In the US the ownership ban produced coin and
   jewelry premiums rather than a large organized black market.

## What the cached series reflects

| Period | Series value | What it represents | Not captured |
|--------|--------------|--------------------|--------------|
| 1950-1953 | $34.72 | Official parity / dollar-equivalent (London closed) | Premium markets at $40-55 |
| 1954-1967 | $35.00-35.20 | London market, held near parity by official supply | Oct 1960 spike is smoothed by monthly averaging (Timothy Green annual figures before 1960) |
| 1968-1971 | LBMA daily fixes | Free-market (second-tier) price | Nothing material; the official $35 tier is intentionally ignored |
| 1971-present | LBMA daily fixes | Free market | - |

Consequence: conversions dated 1950-1967 are near-constant (~28.5 troy oz per
$1,000). If a free-market or premium-market price is wanted for 1946-1953, it
must be curated by hand; the usual sources are Timothy Green, *The World of
Gold*, and the IMF's contemporaneous reports on premium gold markets. No
machine-readable series is known.

## Currencies routed through the dollar

Non-USD amounts are converted to USD at the historical exchange rate for the
same period, then to gold at the USD benchmark. This is deliberate: it
normalizes everything to one bullion price rather than trying to reproduce
local gold markets. Under Bretton Woods (to 1971) exchange rates were fixed par
values against the dollar, movable only within a ±1% band and changed by
discrete devaluations. The BIS daily series starts in August/September 1953
and already contains the 1961, 1967 and 1969 revaluations and devaluations, so
only dates before each currency's first BIS observation use the small parity
table (GBP 1940-1953-08-09, CHF 1949-1953-08-31, DEM/EUR 1948-06-21 to
1953-08-31). Those values are flagged `fx_mode = parity`; dates before the table
starts are flagged `extrapolated` and use the earliest entry. In this era the
official par is a stepwise approximation: the market rate could differ from it
by a few percent (Swiss franc: legal parity 4.37 per dollar, BIS's first
observation 4.29; sterling traded far below $4.03 in free markets before
September 1949). Sources for each par value are in [reference.md](reference.md).

Dates from 1953 use the BIS daily observations; the newest one is about a week
old, and recent conversions say so.

### Deutsche Mark and the euro

- The **Deutsche Mark (DEM)** was introduced in the Western occupation zones on
  21 June 1948 (currency reform), initially at 3.33 DM per USD (30 US cents),
  devalued with the sterling bloc to 4.20 (23.8095 US cents; the Bank deutscher
  Länder's records give 19 Sept 1949 as the effective date, the decision being
  announced on 28-29 Sept, and the parity table uses 28 Sept), revalued to 4.00
  on 6 March 1961 and to 3.66 on 27 Oct 1969, and floated from 1971.
- The **euro** began on 1 Jan 1999 (cash from 1 Jan 2002). It did **not** start
  1:1 with the mark: the irrevocable conversion rate is **1 EUR = 1.95583 DEM**.
  The euro's official 1:1 predecessor was the ECU, a basket unit of account
  (1979–1998) in which almost no real-world amounts were denominated.
- **Synthetic euro.** For dates before 1999 this project derives EUR from DEM at
  the conversion rate (`usd_per_eur = usd_per_dem × 1.95583`). This is the
  Bundesbank convention for long-run euro series and matches how Germans still
  mentally convert pre-euro prices (divide by 1.95583, or "roughly halve").
  It is a German-centric fiction: an amount that was actually in French francs
  or Italian lire would convert differently, because those currencies lost
  more value against the mark before 1999. Such rows are flagged
  `fx_mode = synthetic`. Symmetrically, DEM amounts dated after 1998 are
  derived from EUR at the same rate and flagged.
- **Where the data comes from.** The BIS publishes one series, `D.DE.EUR`,
  which is Germany's exchange rate history restated in euros at the fixed
  conversion rate (daily from 1 Sept 1953; from 1999 identical to the ECB
  reference rate). The project uses it for both EUR and DEM: pre-1999 the
  deutsche-mark rate is the series times 1.95583, so a DEM query from 1953 to
  1998 is a genuine daily rate (`daily`), while an EUR query in the same years
  is `synthetic`. Before September 1953 the DEM parity rows (3.33, then 4.20)
  supply the rate, times 1.95583 for EUR.

### Mark der DDR (East German mark)

Out of scope. The East German mark (M, 1948–1990) was not convertible; the
official 1:1 rate with the DEM was a political fiction and the street rate ran
roughly 5–10 M per DM through the 1980s. At monetary union on 1 July 1990,
wages, prices and savings up to age-dependent limits (2,000 / 4,000 / 6,000 M)
were converted at 1:1, larger balances at 2:1, some liabilities at 3:1. With
no market USD rate to route through, any gold value for M amounts would be a
guess; the project does not attempt one.

## Why 50 GBD per ounce

The 1 oz American Gold Eagle (Gold Bullion Coin Act, 1985) and 1 oz American
Buffalo (2006) carry a statutory face value of **$50**. That face value is the
only official "$50 per ounce" figure in US law. It is legal tender at $50, but
it is not a customs valuation rate and is unrelated to the $42.22 Treasury book
value or any Bretton Woods parity. GBD borrows the number as a convenient
gold-denominated unit; it is a definition used by this skill, not a real
currency.
