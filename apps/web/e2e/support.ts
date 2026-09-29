import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SNAPSHOT = join(ROOT, "test-vectors", "snapshot");

/** The synthetic fixture's latest fix (a Friday); the pinned clock is the Tuesday after. */
export const FIXTURE_LAST_FIX = "2026-09-25";
export const PINNED_NOW = "2026-09-29T12:00:00Z";
export const PINNED_TODAY = "2026-09-29";

const monthlyCsv = readFileSync(join(SNAPSHOT, "monthly.csv"));
const lbmaPm = readFileSync(join(SNAPSHOT, "gold_pm.json"));
const lbmaAm = readFileSync(join(SNAPSHOT, "gold_am.json"));
const monthlyLines = monthlyCsv.toString("utf8").trim().split("\n");
const manifest = JSON.stringify({
  files: {
    "monthly.csv": {
      rows: monthlyLines.length - 1,
      last_date: (monthlyLines.at(-1) ?? "").split(",")[0],
      sha256: createHash("sha256").update(monthlyCsv).digest("hex"),
    },
  },
});

export function monthlyPrice(month: string): number {
  const line = monthlyLines.find((entry) => entry.startsWith(`${month},`));
  if (!line) throw new Error(`no monthly price for ${month}`);
  return Number(line.split(",")[1]);
}

export interface Stubs {
  lbmaRequests: string[];
  /** Switch the LBMA stub between serving the fixture and failing, mid-test. */
  lbma: LbmaMode;
}

export type LbmaMode = "ok" | "fail";

/**
 * Serve the site's data files and the LBMA feed from the synthetic fixture. The app
 * fetches LBMA from prices.lbma.org.uk in the browser; nothing licensed is involved.
 */
export async function stubData(page: Page, lbma: LbmaMode = "ok"): Promise<Stubs> {
  const stubs: Stubs = { lbmaRequests: [], lbma };
  await page.route("**/data/manifest.json", (route) =>
    route.fulfill({ contentType: "application/json", body: manifest }),
  );
  await page.route("**/data/monthly.csv", (route) =>
    route.fulfill({ contentType: "text/csv", body: monthlyCsv }),
  );
  await page.route("https://prices.lbma.org.uk/json/*.json", (route) => {
    const url = route.request().url();
    stubs.lbmaRequests.push(url);
    if (stubs.lbma === "fail") return route.abort("internetdisconnected");
    return route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: url.endsWith("gold_pm.json") ? lbmaPm : lbmaAm,
    });
  });
  return stubs;
}

export async function openApp(
  page: Page,
  options: { lbma?: LbmaMode; now?: string } = {},
): Promise<Stubs> {
  await page.clock.setFixedTime(new Date(options.now ?? PINNED_NOW));
  const stubs = await stubData(page, options.lbma ?? "ok");
  await page.goto("/");
  await expect(page.getByRole("grid")).toBeVisible();
  if ((options.lbma ?? "ok") === "ok") {
    await expect(page.getByTestId("data-status")).toContainText(
      `loaded through ${FIXTURE_LAST_FIX}`,
    );
  }
  return stubs;
}

export const cell = (page: Page, row: number, col: string) =>
  page.locator(`td[data-pos="${row}:${col}"]`);

/** Deliver clipboard text to the focused element as a paste event. */
export async function pasteText(page: Page, text: string): Promise<void> {
  await page.evaluate((data) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", data);
    const event = new ClipboardEvent("paste", {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    });
    document.activeElement?.dispatchEvent(event);
  }, text);
}

/** Type one row through the keyboard: Amount, Tab, Date, Enter (lands on Date of the next row). */
export async function typeRow(page: Page, row: number, amount: string, date: string) {
  await cell(page, row, "amount").focus();
  await page.keyboard.type(amount);
  await page.keyboard.press("Tab");
  await page.keyboard.type(date);
  await page.keyboard.press("Enter");
}

export function decimals(text: string): number {
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Assert displayed text is the correctly rounded rendering of `expected`. */
export function expectDisplayed(text: string, expected: number, label: string) {
  const shown = Number(text.replaceAll(",", ""));
  const tolerance = 0.5 * 10 ** -decimals(text) + 1e-12;
  expect(
    Math.abs(shown - expected),
    `${label}: shown ${text}, expected ${expected}`,
  ).toBeLessThanOrEqual(tolerance);
}
