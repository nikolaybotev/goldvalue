const formatters = new Map<number, Intl.NumberFormat>();

function fixed(digits: number): Intl.NumberFormat {
  let format = formatters.get(digits);
  if (!format) {
    format = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatters.set(digits, format);
  }
  return format;
}

/** Display precision of the CLI's `fmt_unit`: 2 decimals from 100, 4 from 1, else 6. */
export function unitDigits(value: number): number {
  const abs = Math.abs(value);
  if (abs >= 100) return 2;
  if (abs >= 1) return 4;
  return 6;
}

export function formatUnit(value: number): string {
  return fixed(unitDigits(value)).format(value + 0);
}

const money = new Map<string, Intl.NumberFormat>();

/** Nominal amount in the sheet currency (FR10 overlay and chart tooltip). */
export function formatMoney(amount: number, currency: string): string {
  let format = money.get(currency);
  if (!format) {
    format = new Intl.NumberFormat("en-US", { style: "currency", currency });
    money.set(currency, format);
  }
  return format.format(amount);
}

export function formatPrice(value: number): string {
  return `$${fixed(2).format(value)}`;
}

/** Short badge text and a full label for a `price_source` string from core. */
export function sourceBadge(source: string): { short: string; full: string } {
  if (source === "LBMA") return { short: "LBMA", full: "LBMA Gold Price (PM fix, AM if no PM)" };
  if (source.startsWith("World Bank")) return { short: "WB monthly", full: source };
  if (source.startsWith("Timothy Green")) return { short: "NMA annual", full: source };
  return { short: source, full: source };
}
