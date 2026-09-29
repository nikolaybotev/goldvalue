import type { FxMode } from "@goldvalue/core";

/** FR8a / FR10a: parity, synthetic, and extrapolated rates are warnings. Daily and USD are not. */
export const fxWarns = (mode: FxMode | null | undefined): boolean =>
  mode === "parity" || mode === "synthetic" || mode === "extrapolated";

/** Extrapolated is the strongest mode (D10) and is drawn darker than parity or synthetic. */
export const fxStrong = (mode: FxMode | null | undefined): boolean => mode === "extrapolated";
