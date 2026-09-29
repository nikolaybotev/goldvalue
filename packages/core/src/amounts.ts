import { pyStrip } from "./dates";

export class AmountParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountParseError";
  }
}

const AMOUNT = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/;

/**
 * Port of `parse_amount`: plain decimals only (`1500`, `$1,500`, `-1,500.50`, `.5`).
 * `,`, `$` and `_` are stripped wherever they occur. Exponent forms, `nan`, `inf`,
 * and values that overflow a double are rejected.
 */
export function parseAmount(text: string | null | undefined): number {
  const cleaned = pyStrip((text ?? "").replace(/[,$_]/g, ""));
  if (!AMOUNT.test(cleaned)) throw new AmountParseError(`invalid amount ${JSON.stringify(text)}`);
  const value = Number(cleaned);
  if (!Number.isFinite(value)) throw new AmountParseError(`invalid amount ${JSON.stringify(text)}`);
  return value;
}
