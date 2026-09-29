import { expect, test } from "vitest";
import { PNG_SCALE, pngSize, sizeLabel } from "../src/export/size";

test("the PNG is exactly twice the SVG in both directions", () => {
  expect(PNG_SCALE).toBe(2);
  expect(pngSize({ width: 640, height: 320 })).toEqual({ width: 1280, height: 640 });
});

test("the size label names both files in pixels", () => {
  expect(sizeLabel({ width: 640, height: 320 })).toBe(
    "SVG 640 \u00d7 320 px, PNG 1280 \u00d7 640 px",
  );
});
