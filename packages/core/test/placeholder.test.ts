import { expect, test } from "vitest";
import { GB_PER_OZ, GBD_PER_OZ } from "../src/index";

test("unit constants", () => {
  expect(GB_PER_OZ).toBe(1000);
  expect(GBD_PER_OZ).toBe(50);
});
