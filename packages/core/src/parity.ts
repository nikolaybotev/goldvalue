import { addDays, formatIso, parseIso } from "./dates";

/** Irrevocable conversion rate fixed on 1998-12-31: 1 EUR = 1.95583 DEM. */
export const DEM_PER_EUR = 1.95583;
/** First euro trading day; EUR before it is synthetic. */
export const EURO_START = "1999-01-04";
/** Last day of the Deutsche Mark as a currency; DEM after it is synthetic. */
export const DEM_LAST_DAY = "1998-12-31";

export type ParityKind = "parity" | "extrapolated";

/** One Bretton Woods par value: effective from `date`, `rate` USD per unit. */
export interface ParityRow {
  date: string;
  rate: number;
  label: string;
}

/**
 * Bretton Woods par values (spec 6.2a), used only before a currency's first BIS
 * observation. DEM also drives EUR (times DEM_PER_EUR). Keep in step with
 * `PARITY_TABLE` in goldvalue.py; sources are in reference.md.
 */
export const PARITY_TABLE: Readonly<Record<"GBP" | "CHF" | "DEM", readonly ParityRow[]>> = {
  GBP: [
    { date: "1940-01-01", rate: 4.03, label: "\u00a31 = $4.03" },
    { date: "1949-09-18", rate: 2.8, label: "\u00a31 = $2.80" },
  ],
  CHF: [
    {
      date: "1949-01-01",
      rate: 1 / 4.37282,
      label: "CHF 1 = $0.2287 (4.37282 CHF per USD)",
    },
  ],
  DEM: [
    { date: "1948-06-21", rate: 1 / 3.33, label: "DM 1 = $0.3003 (3.33 DM per USD)" },
    { date: "1949-09-28", rate: 1 / 4.2, label: "DM 1 = $0.2381 (4.20 DM per USD)" },
  ],
};

export const EUR_PARITY_LABELS: Readonly<Record<string, string>> = {
  "1948-06-21": "\u20ac1 = $0.5873 (via DM 1 = $0.3003 at 1 \u20ac = 1.95583 DM)",
  "1949-09-28": "\u20ac1 = $0.4657 (via DM 1 = $0.2381 at 1 \u20ac = 1.95583 DM)",
};

export const GBP_EXTRAPOLATION_NOTE =
  " Indicative only: sterling was about $4.87 on the gold standard before 1931 and floated in the 1930s.";

export const SYNTHETIC_EUR_NOTE =
  "Synthetic euro: the euro did not exist before 1999. Value derived from the Deutsche " +
  "Mark at the fixed conversion rate 1 \u20ac = 1.95583 DM. Amounts originally in other " +
  "legacy currencies (francs, lire, \u2026) would differ.";

export const SYNTHETIC_DEM_NOTE =
  "Synthetic Deutsche Mark: the Deutsche Mark was replaced by the euro in 1999. Value " +
  "derived from the euro at the fixed conversion rate 1 \u20ac = 1.95583 DM.";

export const BIS_LAG_NOTE = "BIS data lags about a week";

export interface ParityResult {
  rate: number;
  effective: string;
  note: string;
  kind: ParityKind;
}

/**
 * Port of `parity_rate`: the par value in force on `when` (ISO date); `extrapolated`
 * before the table's first row. `firstObs` is the currency's first BIS observation
 * (the parity in force ends the day before it), or null when unknown.
 */
export function parityRate(
  currency: "EUR" | "GBP" | "CHF" | "DEM",
  when: string,
  firstObs: string | null,
): ParityResult {
  const rows = PARITY_TABLE[currency === "EUR" || currency === "DEM" ? "DEM" : currency];
  let idx = 0;
  rows.forEach((row, i) => {
    if (row.date <= when) idx = i;
  });
  const { date: start, rate: base, label } = rows[idx] as ParityRow;
  const first = rows[0] as ParityRow;
  const extrapolated = when < first.date;
  let rate = base;
  let shown = label;
  if (currency === "EUR") {
    rate = base * DEM_PER_EUR;
    shown = EUR_PARITY_LABELS[start] as string;
  }
  let text: string;
  if (extrapolated) {
    text = `Extrapolated: no parity table entry before ${start}; the earliest entry ${shown} is used.`;
    if (currency === "GBP") text += GBP_EXTRAPOLATION_NOTE;
  } else {
    let end: string | null;
    if (idx + 1 < rows.length) {
      end = formatIso(addDays(parseIso((rows[idx + 1] as ParityRow).date), -1));
    } else {
      end = firstObs ? formatIso(addDays(parseIso(firstObs), -1)) : null;
    }
    const span = end ? `${start} to ${end}` : `from ${start}`;
    text = `Bretton Woods parity ${shown} (${span}).`;
  }
  return {
    rate,
    effective: start,
    note: text,
    kind: extrapolated ? "extrapolated" : "parity",
  };
}
