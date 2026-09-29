import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  cell,
  expectDisplayed,
  FIXTURE_LAST_FIX,
  monthlyPrice,
  openApp,
  PINNED_TODAY,
  pasteText,
  typeRow,
} from "./support";

interface Vector {
  name: string;
  family: string;
  input: { amount: number; date: string; from: string; today: string };
  expected: {
    GB: number;
    GBD: number;
    troy_oz: number;
    note: string;
    effective: string;
    gold_usd_per_oz: number;
  };
}

const vectors = (
  JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../test-vectors/gold-usd.json"),
      "utf8",
    ),
  ) as Vector[]
).filter((v) => v.input.from === "USD" && v.input.today === PINNED_TODAY);

const close = (actual: number, expected: number) =>
  Math.abs(actual - expected) <= Math.max(Math.abs(expected) * 1e-9, 1e-12);

test.describe("AC1: fixture values through the sheet", () => {
  test("pasted vector rows show the golden GB, GBD, and oz with the golden notes", async ({
    page,
  }) => {
    await openApp(page);
    expect(vectors.length).toBeGreaterThan(60);
    await cell(page, 0, "amount").focus();
    await pasteText(page, vectors.map((v) => `${v.input.amount}\t${v.input.date}`).join("\n"));
    await expect(cell(page, vectors.length, "amount")).toBeVisible();

    for (const [row, vector] of vectors.entries()) {
      const label = `${vector.name} (row ${row + 1})`;
      const gb = await cell(page, row, "gb").getAttribute("data-value");
      const gbd = await cell(page, row, "gbd").getAttribute("data-value");
      const oz = await cell(page, row, "oz").getAttribute("data-value");
      expect(
        close(Number(gb), vector.expected.GB),
        `${label} GB ${gb} vs ${vector.expected.GB}`,
      ).toBe(true);
      expect(close(Number(gbd), vector.expected.GBD), `${label} GBD`).toBe(true);
      expect(close(Number(oz), vector.expected.troy_oz), `${label} oz`).toBe(true);
      expectDisplayed(
        (await cell(page, row, "gb").textContent()) ?? "",
        vector.expected.GB,
        `${label} GB text`,
      );
      expect(
        await cell(page, row, "price").locator(".price").getAttribute("data-note"),
        label,
      ).toBe(vector.expected.note);
    }
  });

  test("typing an amount and a date computes the golden values", async ({ page }) => {
    await openApp(page);
    const vector = vectors.find((v) => v.input.amount === -5000 && v.input.date === "2018-12");
    if (!vector) throw new Error("vector missing");
    await typeRow(page, 0, "-5000", "2018-12");
    await expect(cell(page, 0, "gb")).toHaveAttribute("data-value", /./);
    const gb = Number(await cell(page, 0, "gb").getAttribute("data-value"));
    expect(close(gb, vector.expected.GB)).toBe(true);
    await expect(cell(page, 0, "gb")).toHaveText(/^-[\d,]+\.\d{2}$/);
    await expect(cell(page, 0, "price").locator(".badge")).toHaveText("LBMA");
  });

  test("the today row uses the latest fix and its note says so", async ({ page }) => {
    await openApp(page);
    const vector = vectors.find(
      (v) => v.input.date === PINNED_TODAY && v.family === "after-latest-fix",
    );
    if (!vector) throw new Error("vector missing");
    await typeRow(page, 0, String(vector.input.amount), "today");
    const note = cell(page, 0, "price").locator(".price");
    await expect(note).toHaveAttribute("data-note", vector.expected.note);
    expect(vector.expected.note).toContain(`used previous fix from ${FIXTURE_LAST_FIX}`);
    const gb = Number(await cell(page, 0, "gb").getAttribute("data-value"));
    expect(close(gb, vector.expected.GB)).toBe(true);
  });

  test("the year average of the pre-1960 series is labelled as an annual average", async ({
    page,
  }) => {
    await openApp(page);
    await typeRow(page, 0, "1000", "1955");
    await expect(cell(page, 0, "price").locator(".badge")).toHaveText("NMA annual");
    await expect(cell(page, 0, "price").locator(".price")).toHaveAttribute(
      "data-note",
      "average of 12 monthly values",
    );
  });
});

test.describe("data loading (spec 6.3.2)", () => {
  test("first visit downloads LBMA immediately; the next visit uses IndexedDB and respects the 12 h limit", async ({
    page,
  }) => {
    const stubs = await openApp(page);
    expect(stubs.lbmaRequests.sort()).toEqual([
      "https://prices.lbma.org.uk/json/gold_am.json",
      "https://prices.lbma.org.uk/json/gold_pm.json",
    ]);
    await typeRow(page, 0, "1000", "2018-12");
    const first = await cell(page, 0, "gb").getAttribute("data-value");

    await page.reload();
    await expect(page.getByTestId("data-status")).toContainText(
      `loaded through ${FIXTURE_LAST_FIX}`,
    );
    await expect(cell(page, 0, "gb")).toHaveAttribute("data-value", first ?? "");
    // The cached latest fix is older than the previous business day, so a top-up is due,
    // but the attempt made moments ago blocks it.
    await page.waitForTimeout(500);
    expect(stubs.lbmaRequests).toHaveLength(2);
  });

  test("a stale table is topped up after 12 hours", async ({ page }) => {
    const stubs = await openApp(page);
    expect(stubs.lbmaRequests).toHaveLength(2);
    await page.clock.setFixedTime(new Date("2026-09-30T02:00:00Z"));
    await page.reload();
    await expect(page.getByTestId("data-status")).toContainText("loaded through");
    await expect.poll(() => stubs.lbmaRequests.length, { timeout: 10_000 }).toBe(4);
  });

  test("without LBMA rows compute at monthly precision and say so", async ({ page }) => {
    await openApp(page, { lbma: "fail" });
    await expect(page.getByTestId("data-status")).toContainText("Daily LBMA prices not loaded");
    await typeRow(page, 0, "80000", "2018-12");
    const expected = (80000 / monthlyPrice("2018-12")) * 1000;
    const gb = Number(await cell(page, 0, "gb").getAttribute("data-value"));
    expect(close(gb, expected)).toBe(true);
    await expect(cell(page, 0, "price").locator(".price")).toHaveAttribute(
      "data-note",
      /daily LBMA prices not loaded/,
    );
  });

  test("when the price data cannot be loaded the app says so instead of computing", async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-09-29T12:00:00Z"));
    await page.route("**/data/**", (route) => route.abort("internetdisconnected"));
    await page.route("https://prices.lbma.org.uk/**", (route) =>
      route.abort("internetdisconnected"),
    );
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText("Price data not available offline");
    await typeRow(page, 0, "1000", "2018");
    await expect(cell(page, 0, "gb")).toHaveText("");
    await expect(cell(page, 0, "price")).toContainText("Price data unavailable");
  });
});
