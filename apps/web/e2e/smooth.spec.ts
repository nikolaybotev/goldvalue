import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { cell, openApp, PINNED_TODAY, stubFx, typeRow } from "./support";

const NOTES =
  "https://github.com/nikolaybotev/goldvalue/blob/main/.agents/skills/gold-value-normalizer/historical-notes.md";

const SMOOTHED_COPY =
  "Smoothed mode divides by a trailing average of monthly gold prices over the selected window. It is a store-of-value gauge for comparing snapshots across long horizons. It is not a consumer-price index and not a claim that gold tracks inflation.";

const PARTIAL_NOTE = "10-year average; 48 months, 1833-01 to 1836-12; series starts 1833-01";

interface Vector {
  name: string;
  input: { amount: number; date: string; from: string; today: string; smooth?: string };
  expected: { GB: number };
}

const tenYear = (
  JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../test-vectors/gold-usd.json"),
      "utf8",
    ),
  ) as Vector[]
).find(
  (vector) =>
    vector.name === "2018-12 10y" &&
    vector.input.today === PINNED_TODAY &&
    vector.input.smooth === "10y",
);

const close = (actual: number, expected: number) =>
  Math.abs(actual - expected) <= Math.max(Math.abs(expected) * 1e-9, 1e-12);

const sheetRow = (page: Page, index: number) => page.locator("tr.sheet-row").nth(index);

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") pushField();
    else if (ch === "\n") {
      pushField();
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      row = [];
    } else if (ch !== "\r") field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    rows.push(row);
  }
  return rows;
}

function fields(text: string, name: string): string[] {
  const [header, ...body] = parseCsv(text);
  const index = header?.indexOf(name) ?? -1;
  if (index < 0) throw new Error(`missing column ${name}`);
  return body.map((line) => line[index] ?? "");
}

async function exportText(page: Page): Promise<string> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  const path = await file.path();
  if (!path) throw new Error("download has no path");
  return readFileSync(path, "utf8");
}

const ROUND_TRIP = ["gold_usd_per_oz", "troy_oz", "GB", "GBD", "USD", "note", "gold_mode"] as const;

test.describe("smoothed gold gauge", () => {
  test("the header defaults to spot and a disabled 10-year window", async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole("radiogroup", { name: "Gold price" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Spot" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Smoothed" })).not.toBeChecked();
    const years = page.getByTestId("smooth-window");
    await expect(years).toBeDisabled();
    await expect(years).toHaveValue("10");
  });

  test("AC14: a 10-year row's GB matches the CLI vector", async ({ page }) => {
    if (!tenYear) throw new Error("2018-12 10y vector missing");
    await openApp(page);
    await page.getByRole("radio", { name: "Smoothed" }).check();
    await expect(page.getByTestId("smooth-window")).toBeEnabled();
    await expect(page.getByTestId("smooth-window")).toHaveValue("10");
    await typeRow(page, 0, String(tenYear.input.amount), tenYear.input.date);
    await expect(cell(page, 0, "gb")).toHaveAttribute("data-value", /./);
    const gb = Number(await cell(page, 0, "gb").getAttribute("data-value"));
    expect(close(gb, tenYear.expected.GB)).toBe(true);
    const price = cell(page, 0, "price").locator(".price");
    await expect(price).toHaveAttribute(
      "data-note",
      "10-year average; 120 months, 2009-01 to 2018-12",
    );
    await expect(price.locator(".price-window")).toHaveText(
      "10-year average; 120 months, 2009-01 to 2018-12",
    );
  });

  test("AC15: spot export round-trips, and smoothed keeps the spot price", async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, "80000", "2018-12");
    await typeRow(page, 1, "1000", "1955");
    await expect(cell(page, 1, "gb")).toHaveAttribute("data-value", /./);
    const before = await exportText(page);

    await page.getByRole("radio", { name: "Smoothed" }).check();
    await expect(cell(page, 0, "price").locator(".price")).toHaveAttribute(
      "data-gold-mode",
      "smoothed",
    );
    const smoothed = await exportText(page);
    expect(fields(smoothed, "spot_usd_per_oz")).toEqual(fields(before, "gold_usd_per_oz"));
    for (const column of ["spot_usd_per_oz", "gold_usd_per_oz"] as const) {
      for (const value of fields(smoothed, column)) expect(value).toMatch(/^-?\d+\.\d{4}$/);
    }

    await page.getByRole("radio", { name: "Spot" }).check();
    const after = await exportText(page);
    for (const column of ROUND_TRIP) {
      expect(fields(after, column), column).toEqual(fields(before, column));
    }
    expect(fields(after, "gold_mode")).toEqual(["spot", "spot"]);
  });

  test("AC16: a partial USD row is not amber; GBP stays amber", async ({ page }) => {
    await stubFx(page);
    await openApp(page);
    await page.getByRole("radio", { name: "Smoothed" }).check();
    await typeRow(page, 0, "1000", "1836");

    const price = cell(page, 0, "price").locator(".price");
    await expect(price).toHaveAttribute("data-gold-mode", "partial");
    await expect(price).toHaveAttribute("data-note", PARTIAL_NOTE);
    await expect(price.locator(".price-window")).toHaveText(PARTIAL_NOTE);
    await expect(sheetRow(page, 0)).not.toHaveClass(/is-fx-warn/);
    await expect(page.getByTestId("fx-marker")).toHaveCount(0);
    await expect(cell(page, 0, "gb")).toHaveCSS("color", "rgb(28, 25, 23)");

    await page.getByTestId("currency").selectOption("GBP");
    await expect(page.getByTestId("data-status")).toContainText("FX (GBP)");
    await expect(price).toHaveAttribute("data-gold-mode", "partial");
    await expect(price).toHaveAttribute("data-note", PARTIAL_NOTE);
    await expect(sheetRow(page, 0)).toHaveClass(/is-fx-warn/);
    await expect(sheetRow(page, 0)).toHaveAttribute("data-fx-mode", "extrapolated");
    const marker = page.getByTestId("fx-marker");
    await expect(marker).toHaveAttribute("title", /parity/);
    await expect(marker).toHaveAttribute("data-fx-mode", "extrapolated");
    await expect(cell(page, 0, "gb")).toHaveCSS("color", "rgb(124, 45, 18)");
  });

  test("AC17: the method panel shows the gauge sentence and the historical notes", async ({
    page,
  }) => {
    await openApp(page);
    await expect(page.getByRole("radiogroup", { name: "Gold price" })).toBeVisible();
    const method = page.getByRole("region", { name: "Method" });
    await expect(method.getByTestId("smoothed-copy")).toHaveText(SMOOTHED_COPY);
    await expect(method.getByRole("link", { name: "historical notes" })).toBeVisible();
    await expect(method.getByRole("link", { name: "historical notes" })).toHaveAttribute(
      "href",
      NOTES,
    );
  });

  test("AC18: the spot overlay is off until turned on, and x stays the requested midpoint", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("radio", { name: "Smoothed" }).check();
    await typeRow(page, 0, "1000", "2019");
    await typeRow(page, 1, "1000", "2019-11-12");
    const points = page.getByTestId("point");
    await expect(points).toHaveCount(2);
    await expect(points.nth(0)).toHaveAttribute("data-date", "2019-07-02");
    await expect(points.nth(1)).toHaveAttribute("data-date", "2019-11-12");
    await expect(page.locator(".series-line")).toHaveCount(1);
    await expect(page.getByTestId("spot-series")).toHaveCount(0);
    const overlay = page.getByRole("button", { name: "Spot overlay" });
    await expect(overlay).toHaveAttribute("aria-pressed", "false");

    await points.nth(0).hover();
    await expect(page.getByTestId("chart-tooltip")).toBeVisible();
    await expect(page.getByTestId("chart-spot-value")).toHaveCount(0);
    await expect(page.getByTestId("chart-price-note")).toContainText("10-year average");
    await expect(page.getByTestId("chart-price-note")).toContainText("120 months");

    await overlay.click();
    await expect(overlay).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("spot-series")).toHaveCount(1);
    await expect(page.locator(".series-line")).toHaveCount(1);
    await points.nth(0).hover();
    const spot = page.getByTestId("chart-spot-value");
    await expect(spot).toBeVisible();
    await expect(spot).toContainText("spot");
    await expect(page.getByTestId("chart")).toHaveAttribute("data-unit", "GB");
  });

  test("the mode and window are remembered", async ({ page }) => {
    await openApp(page);
    await page.getByRole("radio", { name: "Smoothed" }).check();
    await page.getByTestId("smooth-window").selectOption("5");
    await page.getByRole("button", { name: "Spot overlay" }).click();
    await page.reload();
    await expect(page.getByRole("grid")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Smoothed" })).toBeChecked();
    await expect(page.getByTestId("smooth-window")).toBeEnabled();
    await expect(page.getByTestId("smooth-window")).toHaveValue("5");
    await expect(page.getByRole("button", { name: "Spot overlay" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await typeRow(page, 0, "1", "2018");
    await typeRow(page, 1, "1", "2019");
    await expect(page.getByTestId("spot-series")).toHaveCount(1);
  });
});
