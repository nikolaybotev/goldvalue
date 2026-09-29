import { expect, test } from "vitest";
import { APP_NAME } from "../src/index";

test("app stub", () => {
  expect(APP_NAME).toBe("GoldValue");
});
