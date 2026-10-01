import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CivilDate, GoldTable, parseIso } from "@goldvalue/core";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const VECTORS = join(ROOT, "test-vectors");

export function readVectorFile(...parts: string[]): string {
  return readFileSync(join(VECTORS, ...parts), "utf8");
}

export function fixtureTable(daily = true): GoldTable {
  return GoldTable.fromCsv(
    daily ? readVectorFile("snapshot", "lbma_daily.csv") : null,
    readVectorFile("snapshot", "monthly.csv"),
  );
}

export interface Vector {
  name: string;
  family: string;
  input: {
    amount: number;
    currency: string;
    date: string;
    from: string;
    today: string;
    smooth?: string;
  };
  expected: {
    effective: string;
    granularity: string;
    points: number;
    gold_usd_per_oz: number;
    price_source: string;
    note: string;
    troy_oz: number;
    GB: number;
    GBD: number;
    USD: number;
  };
}

export function vectors(): Vector[] {
  return JSON.parse(readVectorFile("gold-usd.json")) as Vector[];
}

export const day = (iso: string): CivilDate => parseIso(iso);
