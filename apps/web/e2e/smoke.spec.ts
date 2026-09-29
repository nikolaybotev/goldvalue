import { expect, test } from "@playwright/test";
import { cell, goOffline, typeRow, visitWithWorker } from "./support";

// Runs against the local build and, with BASE_URL, against the deployed site: real shell, real
// data files behind the server, LBMA stubbed. Assertions never depend on data values.
test.use({ serviceWorkers: "allow" });

test.describe("smoke: the served site", () => {
  test("serves the shell, monthly data and manifest, and no LBMA data", async ({ page }) => {
    await visitWithWorker(page);
    const files = await page.evaluate(async () => {
      const get = async (path: string) => {
        const response = await fetch(path, { cache: "no-store" });
        return {
          ok: response.ok,
          type: response.headers.get("content-type") ?? "",
          text: await response.text(),
        };
      };
      return {
        manifest: await get("data/manifest.json"),
        monthly: await get("data/monthly.csv"),
        lbmaCsv: await get("data/lbma_daily.csv"),
        lbmaJson: await get("data/gold_pm.json"),
      };
    });
    expect(files.manifest.ok).toBe(true);
    const manifest = JSON.parse(files.manifest.text) as {
      files: Record<string, { rows: number; last_date: string; sha256: string }>;
    };
    expect(Object.keys(manifest.files).sort()).toEqual([
      "fx_chf.csv",
      "fx_eur.csv",
      "fx_gbp.csv",
      "monthly.csv",
    ]);
    expect(manifest.files["monthly.csv"]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.files["monthly.csv"]?.rows).toBeGreaterThan(2000);
    expect(files.monthly.ok).toBe(true);
    expect(files.monthly.text.startsWith("month,usd")).toBe(true);
    for (const missing of [files.lbmaCsv, files.lbmaJson]) {
      const looksLikeData = missing.ok && /csv|json/.test(missing.type);
      expect(looksLikeData).toBe(false);
    }
  });

  test("a row computes, and the shell and rows survive going offline", async ({ page }) => {
    const network = await visitWithWorker(page);
    await typeRow(page, 0, "80000", "2018-12");
    await expect(cell(page, 0, "gb")).not.toHaveText("");
    const gb = await cell(page, 0, "gb").getAttribute("data-value");
    expect(Number(gb)).toBeGreaterThan(0);
    await expect(page.getByTestId("chart")).toBeVisible();
    await expect(page.getByText("gold-denominated, not CPI").first()).toBeVisible();

    await goOffline(page, network);
    await page.reload();
    await expect(page.getByRole("heading", { name: "GoldValue" })).toBeVisible();
    await expect(cell(page, 0, "gb")).toHaveAttribute("data-value", gb ?? "");
  });
});
