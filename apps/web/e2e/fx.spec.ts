import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { SYNTHETIC_DEM_NOTE, SYNTHETIC_EUR_NOTE } from "@goldvalue/core";
import { expect, type Page, test } from "@playwright/test";
import { cell, expectDisplayed, openApp, snapshotText, stubFx, typeRow } from "./support";

const FX_JSON = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "test-vectors",
  "fx.json",
);

interface FxCase {
  input: { amount: number; currency: string; date: string };
  expected: { GB: number; GBD: number; troy_oz: number; fx_mode: string; fx_note: string };
}

const fxCases = JSON.parse(readFileSync(FX_JSON, "utf8")) as FxCase[];

function fxCase(currency: string, amount: number, date: string): FxCase {
  const found = fxCases.find(
    (entry) =>
      entry.input.currency === currency &&
      entry.input.amount === amount &&
      entry.input.date === date,
  );
  if (!found) throw new Error(`no FX vector for ${currency} ${amount} ${date}`);
  return found;
}

function lastDate(currency: string): string {
  const file = currency === "GBP" ? "fx_gbp.csv" : currency === "CHF" ? "fx_chf.csv" : "fx_eur.csv";
  const line = snapshotText(file).trim().split("\n").at(-1) ?? "";
  return line.split(",")[0] ?? "";
}

const WARN = "rgb(146, 64, 14)";
const STRONG = "rgb(124, 45, 18)";

const sheetRow = (page: Page, index: number) => page.locator("tr.sheet-row").nth(index);

async function choose(page: Page, code: string): Promise<void> {
  await page.getByTestId("currency").selectOption(code);
  const status = page.getByTestId("data-status");
  if (code === "USD") await expect(status).not.toContainText(/FX \(/);
  else await expect(status).toContainText(`FX (${code}) through ${lastDate(code)}`);
}

async function expectUnits(page: Page, row: number, expected: FxCase["expected"]): Promise<void> {
  expectDisplayed(await cell(page, row, "gb").innerText(), expected.GB, "GB");
  expectDisplayed(await cell(page, row, "gbd").innerText(), expected.GBD, "GBD");
  expectDisplayed(await cell(page, row, "oz").innerText(), expected.troy_oz, "oz");
}

async function exportText(page: Page): Promise<string> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  const path = await file.path();
  if (!path) throw new Error("download has no path");
  return readFileSync(path, "utf8");
}

test.describe("v1.1 currency and FX", () => {
  test("AC8: EUR 250000 / 2005-06 uses the daily rate, shows no warning, and matches the CLI", async ({
    page,
  }) => {
    await stubFx(page);
    await openApp(page);
    await choose(page, "EUR");
    await expect(page.getByRole("columnheader", { name: "Amount (EUR)" })).toBeVisible();
    await typeRow(page, 0, "250000", "2005-06");

    const expected = fxCase("EUR", 250000, "2005-06").expected;
    expect(expected.fx_mode).toBe("daily");
    expect(expected.fx_note).toBe("");
    await expectUnits(page, 0, expected);
    await expect(sheetRow(page, 0)).toHaveAttribute("data-fx-mode", "daily");
    await expect(sheetRow(page, 0)).not.toHaveClass(/is-fx-warn/);
    await expect(page.getByTestId("fx-marker")).toHaveCount(0);
    await expect(cell(page, 0, "gb")).toHaveCSS("color", "rgb(28, 25, 23)");

    const point = page.getByTestId("point");
    await expect(point).toHaveAttribute("data-fx-mode", "daily");
    await expect(point).not.toHaveClass(/is-fx/);
    await point.hover();
    await expect(page.getByTestId("chart-tooltip")).toBeVisible();
    await expect(page.getByTestId("chart-fx-note")).toHaveCount(0);
  });

  test("AC9: GBP, CHF, and DEM parity rows are amber with the parity note", async ({ page }) => {
    await stubFx(page);
    await openApp(page);
    await choose(page, "GBP");
    await typeRow(page, 0, "1000", "1950-06");

    for (const code of ["GBP", "CHF", "DEM"] as const) {
      await choose(page, code);
      const expected = fxCase(code, 1000, "1950-06").expected;
      expect(expected.fx_mode).toBe("parity");
      expect(expected.fx_note).toContain(code === "GBP" ? "£1 = $2.80" : "Bretton Woods parity");
      await expectUnits(page, 0, expected);

      const row = sheetRow(page, 0);
      await expect(row).toHaveAttribute("data-fx-mode", "parity");
      await expect(row).toHaveClass(/is-fx-warn/);
      await expect(row).not.toHaveClass(/is-fx-strong/);
      await expect(cell(page, 0, "gb")).toHaveCSS("color", WARN);
      const marker = row.getByTestId("fx-marker");
      await expect(marker).toHaveAttribute("title", expected.fx_note);
      await expect(marker.locator("[aria-hidden='true']")).toHaveText("!");

      const point = page.getByTestId("point");
      await expect(point).toHaveClass(/is-fx/);
      await expect(point).not.toHaveClass(/is-strong/);
      await expect(point).toHaveCSS("fill", "rgb(255, 255, 255)");
      await expect(point).toHaveCSS("stroke", WARN);
      await point.hover();
      await expect(page.getByTestId("chart-fx-note")).toHaveText(expected.fx_note);
    }
  });

  test("AC10: synthetic euro and synthetic mark use the verbatim notes", async ({ page }) => {
    await stubFx(page);
    await openApp(page);
    await choose(page, "EUR");
    await typeRow(page, 0, "1000", "1985-06");

    const euro = fxCase("EUR", 1000, "1985-06").expected;
    expect(euro.fx_note).toBe(SYNTHETIC_EUR_NOTE);
    expect(euro.fx_mode).toBe("synthetic");
    await expectUnits(page, 0, euro);
    await expect(sheetRow(page, 0).getByTestId("fx-marker")).toHaveAttribute(
      "title",
      SYNTHETIC_EUR_NOTE,
    );
    await expect(cell(page, 0, "gb")).toHaveCSS("color", WARN);
    await page.getByTestId("point").hover();
    await expect(page.getByTestId("chart-fx-note")).toHaveText(SYNTHETIC_EUR_NOTE);

    await choose(page, "DEM");
    await cell(page, 0, "date").click();
    await cell(page, 0, "date").press("Enter");
    await page.locator("input.cell-input").fill("2005-06");
    await page.keyboard.press("Enter");

    const mark = fxCase("DEM", 1000, "2005-06").expected;
    expect(mark.fx_note).toBe(SYNTHETIC_DEM_NOTE);
    expect(mark.fx_mode).toBe("synthetic");
    await expectUnits(page, 0, mark);
    await expect(sheetRow(page, 0)).toHaveAttribute("data-fx-mode", "synthetic");
    await expect(sheetRow(page, 0).getByTestId("fx-marker")).toHaveAttribute(
      "title",
      SYNTHETIC_DEM_NOTE,
    );
    await expect(cell(page, 0, "gb")).toHaveCSS("color", WARN);
    await page.getByTestId("point").hover();
    await expect(page.getByTestId("chart-fx-note")).toHaveText(SYNTHETIC_DEM_NOTE);
  });

  test("AC11: extrapolated GBP is the stronger warning and the CSV carries fx_mode and fx_note", async ({
    page,
  }) => {
    await stubFx(page);
    await openApp(page);
    await choose(page, "GBP");
    await typeRow(page, 0, "1000", "1900-01");
    await typeRow(page, 1, "1000", "1950-06");

    const extrapolated = fxCase("GBP", 1000, "1900-01").expected;
    const parity = fxCase("GBP", 1000, "1950-06").expected;
    expect(extrapolated.fx_mode).toBe("extrapolated");
    expect(extrapolated.fx_note).toContain("Extrapolated:");
    expect(extrapolated.fx_note).toContain("$4.87");
    await expectUnits(page, 0, extrapolated);
    await expect(sheetRow(page, 0)).toHaveAttribute("data-fx-mode", "extrapolated");
    await expect(sheetRow(page, 0)).toHaveClass(/is-fx-strong/);
    await expect(cell(page, 0, "gb")).toHaveCSS("color", STRONG);
    await expect(sheetRow(page, 0).getByTestId("fx-marker")).toHaveAttribute(
      "title",
      extrapolated.fx_note,
    );
    await expect(cell(page, 1, "gb")).toHaveCSS("color", WARN);

    const point = page.getByTestId("point").first();
    await expect(point).toHaveAttribute("data-date", "1900-01-16");
    await expect(point).toHaveClass(/is-strong/);
    await expect(point).toHaveCSS("stroke", STRONG);
    await point.hover();
    await expect(page.getByTestId("chart-fx-note").first()).toHaveText(extrapolated.fx_note);

    const csv = await exportText(page);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "date,amount,currency,label,effective,gold_usd_per_oz,troy_oz,GB,GBD,USD,price_source,granularity,note,fx_rate,fx_effective,fx_mode,fx_note,gold_mode,ma_years,ma_months,spot_usd_per_oz",
    );
    expect(lines).toHaveLength(3);
    expect(csv).toContain("1900-01,1000,GBP");
    expect(csv).toContain("1950-06,1000,GBP");
    expect(csv).toContain(`,extrapolated,${extrapolated.fx_note}`);
    expect(csv).toContain(`,parity,${parity.fx_note}`);
  });

  test("AC13: switching currency recomputes every row and downloads only that file", async ({
    page,
  }) => {
    const hits = await stubFx(page);
    await openApp(page);
    await expect(page.getByTestId("currency").locator("option")).toHaveText([
      "USD",
      "EUR",
      "GBP",
      "CHF",
      "DEM",
    ]);
    await typeRow(page, 0, "1000", "2005-06");
    await typeRow(page, 1, "1000", "1950-06");
    const usd0 = await cell(page, 0, "gb").innerText();
    const usd1 = await cell(page, 1, "gb").innerText();
    expect(usd0).not.toBe("");
    expect(usd1).not.toBe("");
    expect(hits).toEqual([]);

    await choose(page, "GBP");
    await expect(cell(page, 0, "gb")).not.toHaveText(usd0);
    await expect(cell(page, 1, "gb")).not.toHaveText(usd1);
    expect(hits).toEqual(["fx_gbp.csv"]);
    const gbp0 = await cell(page, 0, "gb").innerText();
    const gbp1 = await cell(page, 1, "gb").innerText();

    await choose(page, "EUR");
    await expect(cell(page, 0, "gb")).not.toHaveText(gbp0);
    await expect(cell(page, 1, "gb")).not.toHaveText(gbp1);
    expect(hits).toEqual(["fx_gbp.csv", "fx_eur.csv"]);
    const eur0 = await cell(page, 0, "gb").innerText();
    const eur1 = await cell(page, 1, "gb").innerText();

    await choose(page, "DEM");
    await expect(cell(page, 0, "gb")).not.toHaveText(eur0);
    await expect(cell(page, 1, "gb")).not.toHaveText(eur1);
    expect(hits).toEqual(["fx_gbp.csv", "fx_eur.csv"]);

    await choose(page, "CHF");
    expect(hits).toEqual(["fx_gbp.csv", "fx_eur.csv", "fx_chf.csv"]);
    await choose(page, "EUR");
    expect(hits).toEqual(["fx_gbp.csv", "fx_eur.csv", "fx_chf.csv"]);
    expect(hits.some((name) => name.includes("dem"))).toBe(false);

    await choose(page, "USD");
    await expect(cell(page, 0, "gb")).toHaveText(usd0);
    await expect(cell(page, 1, "gb")).toHaveText(usd1);
    expect(hits).toEqual(["fx_gbp.csv", "fx_eur.csv", "fx_chf.csv"]);

    await page.reload();
    await expect(page.getByTestId("currency")).toHaveValue("USD");
    await expect(page.getByTestId("data-status")).toContainText("loaded through");
    await expect(cell(page, 0, "gb")).toHaveText(usd0);
    expect(hits).toEqual(["fx_gbp.csv", "fx_eur.csv", "fx_chf.csv"]);
  });

  test("FR14: import warns when a currency column differs from the sheet currency", async ({
    page,
  }) => {
    const hits = await stubFx(page);
    await openApp(page);
    await choose(page, "EUR");
    await page.getByTestId("import-input").setInputFiles({
      name: "mixed.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("date,amount,currency\n2005-06,1000,GBP\n1985-06,1000,EUR\n"),
    });
    const warning = page.getByTestId("import-warning");
    await expect(warning).toContainText(
      "The file's currency column (GBP) differs from the sheet currency EUR; EUR is applied to every row.",
    );
    await expect(sheetRow(page, 0)).toHaveAttribute("data-fx-mode", "daily");
    await expect(sheetRow(page, 1)).toHaveAttribute("data-fx-mode", "synthetic");
    await expect(sheetRow(page, 1).getByTestId("fx-marker")).toHaveAttribute(
      "title",
      SYNTHETIC_EUR_NOTE,
    );
    expect(hits).toEqual(["fx_eur.csv"]);
  });

  test("a parity row stays clear of axe violations", async ({ page }) => {
    await stubFx(page);
    await openApp(page);
    await choose(page, "GBP");
    await typeRow(page, 0, "1000", "1950-06");
    await expect(page.getByTestId("fx-marker")).toBeVisible();
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
