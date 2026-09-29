export const GB_PER_OZ = 1000;
export const GBD_PER_OZ = 50;

export type Unit = "USD" | "GB" | "GBD" | "OZ";

const UNIT_ALIASES: Record<string, Unit> = {
  usd: "USD",
  $: "USD",
  dollar: "USD",
  dollars: "USD",
  gb: "GB",
  goldback: "GB",
  goldbacks: "GB",
  gbd: "GBD",
  "gold-backed-dollar": "GBD",
  goldbackeddollar: "GBD",
  oz: "OZ",
  ozt: "OZ",
  troyoz: "OZ",
  ounce: "OZ",
  ounces: "OZ",
};

export class UnitParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnitParseError";
  }
}

export function parseUnit(text: string): Unit {
  const key = text.trim().toLowerCase().replaceAll(" ", "");
  const unit = Object.hasOwn(UNIT_ALIASES, key) ? UNIT_ALIASES[key] : undefined;
  if (!unit) {
    throw new UnitParseError(`unknown unit ${JSON.stringify(text)}; use USD, GB, GBD, or OZ`);
  }
  return unit;
}

export function toOz(amount: number, unit: Unit, price: number): number {
  switch (unit) {
    case "USD":
      return amount / price;
    case "GB":
      return amount / GB_PER_OZ;
    case "GBD":
      return amount / GBD_PER_OZ;
    case "OZ":
      return amount;
  }
}

export interface UnitAmounts {
  USD: number;
  GB: number;
  GBD: number;
  OZ: number;
}

export function fromOz(oz: number, price: number): UnitAmounts {
  return { USD: oz * price, GB: oz * GB_PER_OZ, GBD: oz * GBD_PER_OZ, OZ: oz };
}
