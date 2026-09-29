# intent.md — GoldValue companion app

| | |
|---|---|
| Author | Nikolay Botev |
| Captured | 2026-09-28 22:54 PDT |
| Status | Draft — awaiting product-owner acceptance |
| Stage | 1 · Plan |
| Feeds | [spec.md](spec.md) → [plan.md](plan.md) |

## Problem

Dollar amounts from different dates are not comparable. The `gold-value-normalizer`
skill (`.agents/skills/gold-value-normalizer/scripts/goldvalue.py`) already re-denominates
a dated USD amount into gold units (goldbacks, GBD, troy oz) using historical
gold prices, but it is only reachable through an agent or a terminal. A person who
wants to enter a handful of dated amounts, see them in gold terms, and look at the
result as a chart has no direct tool.

## Proposed outcome

A simple spreadsheet-style web app: a two-column sheet (Dollar Amount, Date) that a
user fills in incrementally, computed goldback / GBD / troy-oz columns beside it,
and a chart that redraws live as rows are entered. CSV import/export and chart
download (SVG/PNG) as advanced features. Later, multi-currency input (EUR, GBP,
CHF at minimum) routed to gold **via USD** using cached historical FX rates.

## Affected users and systems

- **Users:** the repo owner and anyone comparing dollar (later: euro, pound, franc)
  amounts across time; agents using the skill.
- **Systems:** `goldvalue.py` (becomes the reference implementation of the
  backend logic), the local price cache, LBMA and World Bank/NMA price sources,
  a future FX-rate source, a static web host (shared hosting and/or GCP), GitHub.

## Constraints and principles

- **US-dollar-normalized gold pricing is a core tenet.** Non-USD amounts convert
  to USD at the historical FX rate, then to gold at the USD bullion benchmark
  (LBMA). The app deliberately does *not* try to reflect local-market gold
  prices in other currencies.
- The Python script is the source of truth for data fetching, caching, and
  price-resolution rules; any port must match it.
- Prices used should be close to those published by modern bullion dealers
  (spot benchmark, not dealer premium). LBMA was spot-checked against GC=F for
  Dec 2018 and Sep 2026 and judged close enough.
- Deployment must be possible on classic shared web hosting (static files
  and/or PHP) and, optionally, GCP Cloud Run.
- Public repository on GitHub under `nikolaybotev`.

## Open questions (carried into spec.md)

1. Does the SPA need a backend at all, or can it fetch the sources directly and
   cache in browser storage?
2. If a backend is needed: PHP only, Node only, or both?
3. TypeScript for front end and Node back end, or plain JavaScript?
4. JSON-RPC vs a more modern RPC/API style.
5. Real-time SVG chart rendering as data is entered — feasible/preferred?
6. Which FX-rate source (xe.com or another reputable source) for historical rates?

## Original prompt (verbatim)

> I envision a simple Excel/spreadsheet-type companion app that leverages the script (which de facto encodes and represents our backend logic or service), to re-denominate dated US dollar amounts.
>
> On the left side of the UI (or in responsive UI shrunk to narrow format, that could become the top), we have a "sheet" with two columns for Dollar Amount and Date, which can be filled in by a user incrementally, and next to them two columns can show the computed goldback and GBD columns, and even a third gold oz column. Then on the right (or bottom in responsive narrow-width format) a chart can be drawn automatically.
>
> An advanced feature could be added to export the raw data as csv, and also upload a csv to load multiple items at once.
>
> The chart can be downloaded as svg, or png.
>
> An advanced feature to add to our backend would be to add multi currency support (at least a curated set of major Western currencies like Euro, British Pound, Swiss Frank), and we should simply fetch and cache currency exchange rates historical ones, from xe.com or another reputable source to route to the gold denomination via the US dollar. It is a conscious choice to do that as opposed to trying to be reflective of local market gold exchange rates! This is a core tennet of our inflation-adjusted real value calculator - US-dollar normalized official bank or modern era bullion exchange rates (close to the ones published online on jmbullion.com etc - I imagine the LBMA rate you use reflects that closely enough - I manually checked against the macOS Stocks app GC=F chart the two rates you gave for the sample query comparing 2018 and 2026 dollar amounts of a hypothetical real estate dollar price).
>
> Wrapping the app / implementing it as a Single Page App for the web using javascript would be most flexible right? And rendering the charts in real-time using svg as data is being entered...?
>
> Then the app should talk to a web server backend JSON-RPC end-point that in turn should leverage our backend python script.
>
> The web server backend should have two implementations - one php one -for easy deployment on my classic shared web hosting provider, and one in node.js for easy deployment as a cloud run service or similar on GCP... I think... or would a single PHP implementation be enough?
>
> Or can the SPA now with modern web browser technologies directly talk to the online sources (via cross-site request config or response headers if the static html is hosted on a web server?) and cache locally in a browser cache via browser storage apis?
>
> Would it help to implement both front-end and (node.js) backend in typescript vs plain javascript?
>
> Is json-rpc the best choice if we need a backend or is there something more modern?
>
> Write this all out following the AI-native SLDC playbook by Claude, namely:
>
> 1) record my prompt in an intent.md
> 2) write a proper spec.md draft from my intent prompt
> 3) write a draft plan.md (implementation plan)
> 4) I am kind of optimistically asking you to jump ahead, as my prompt includes a mixture of the raw intent and the first set of design spec questions for discussion, so provide feedback on those and we can iterate on the spec and plan concurrently is my idea
>
> 5) to facilitate all the above, create a new repo in this workspace, initialize it, set it up on github.com as well using gh (as a public repo on my account that is authed in gh) and place the SDLC doc files in that repo, move the script and the skill to the repo as well. commit the first draft. make the .agents/skills/gold-value-normalizer folder a symlink to the new repo location of the skill. place the repo in its right place here under the github.com/nikolaybotev folder
>
> Thanks and happy inferencing!

## Prior context

The skill was authored earlier the same day. Findings from that session that
bear on this intent: LBMA daily USD fixes are available from 1968 and served with
`Access-Control-Allow-Origin: *`; the World Bank / Timothy Green monthly series
(1833+) is served from GitHub raw, also with permissive CORS; FRED's LBMA series
was removed. Historical simplifying assumptions are documented in
`.agents/skills/gold-value-normalizer/historical-notes.md`.
