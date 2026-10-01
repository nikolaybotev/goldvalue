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
