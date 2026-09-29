import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CivilDate, FxRates, GoldTable, parseIso } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
export const VECTORS_DIR = join(here, "..", "..", "..", "test-vectors");

export function readVectorFile(name: string): string {
  return readFileSync(join(VECTORS_DIR, name), "utf8");
}

export function readVectorBytes(name: string): Buffer {
  return readFileSync(join(VECTORS_DIR, name));
}

export function readJson<T>(name: string): T {
  return JSON.parse(readVectorFile(name)) as T;
}

/** The committed synthetic snapshot (no real LBMA data; spec D15). */
export function loadSnapshotTable(): GoldTable {
  return GoldTable.fromCsv(
    readVectorFile("snapshot/lbma_daily.csv"),
    readVectorFile("snapshot/monthly.csv"),
  );
}

/** The committed synthetic FX snapshot (BIS-shaped, made-up values). */
export function loadSnapshotFx(): FxRates {
  return FxRates.fromCsv({
    EUR: readVectorFile("snapshot/fx_eur.csv"),
    GBP: readVectorFile("snapshot/fx_gbp.csv"),
    CHF: readVectorFile("snapshot/fx_chf.csv"),
  });
}

export const day = (iso: string): CivilDate => parseIso(iso);
