/** Spec 6.3.4, verbatim. */
export const LBMA_ATTRIBUTION =
  "Daily gold prices are fetched from the LBMA (administered by ICE Benchmark Administration) by your browser for personal, non-commercial use and are not redistributed by this site.";

export const MONTHLY_ATTRIBUTION =
  "Monthly gold prices: World Bank Commodity Markets (Pink Sheet) from 1960 and Timothy Green's Historical Gold Price Table (National Mining Association) for 1833 to 1959, as republished by the Open Knowledge datasets/gold-prices package under the Open Data Commons Public Domain Dedication and License (PDDL 1.0).";

export const BIS_ATTRIBUTION =
  "Foreign-exchange rates come from the Bank for International Settlements (BIS) statistics, which are free to use with attribution.";

const REPO = "https://github.com/nikolaybotev/goldvalue";
const SKILL = `${REPO}/blob/main/.agents/skills/gold-value-normalizer`;

export const LINKS = {
  repo: REPO,
  historicalNotes: `${SKILL}/historical-notes.md`,
  reference: `${SKILL}/reference.md`,
  lbma: "https://www.lbma.org.uk/prices-and-data/precious-metal-prices",
  monthlySeries: "https://github.com/datasets/gold-prices",
} as const;
