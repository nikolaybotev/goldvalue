import { SYNTHETIC_DEM_NOTE, SYNTHETIC_EUR_NOTE } from "@goldvalue/core";
import { expect, test } from "@playwright/test";
import { openApp } from "./support";

const LBMA_TEXT =
  "Daily gold prices are fetched from the LBMA (administered by ICE Benchmark Administration) by your browser for personal, non-commercial use and are not redistributed by this site.";
const NOTES =
  "https://github.com/nikolaybotev/goldvalue/blob/main/.agents/skills/gold-value-normalizer/historical-notes.md";
const REFERENCE =
  "https://github.com/nikolaybotev/goldvalue/blob/main/.agents/skills/gold-value-normalizer/reference.md";

test.describe("AC6 and FR19: the Method panel", () => {
  test("is visible on load and states gold-denominated, not CPI", async ({ page }) => {
    await openApp(page);
    const method = page.getByRole("region", { name: "Method" });
    await expect(method).toBeVisible();
    await expect(method).toContainText("gold-denominated, not CPI");
    await expect(method).toContainText("PM fix");
    await expect(method).toContainText("within 9 days");
    await expect(method).toContainText("year to date");
    await expect(method).toContainText("daily LBMA prices not loaded");
    await expect(method.getByRole("table", { name: "Price resolution rules" })).toBeVisible();
  });

  test("links to the historical notes and the reference by absolute GitHub URLs", async ({
    page,
  }) => {
    await openApp(page);
    const method = page.getByRole("region", { name: "Method" });
    await expect(method.getByRole("link", { name: "historical notes" })).toHaveAttribute(
      "href",
      NOTES,
    );
    await expect(method.getByRole("link", { name: "source and method reference" })).toHaveAttribute(
      "href",
      REFERENCE,
    );
  });

  test("states the LBMA attribution verbatim in the panel and in the footer", async ({ page }) => {
    await openApp(page);
    await expect(
      page.getByRole("region", { name: "Method" }).getByText(LBMA_TEXT, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("contentinfo").getByText(LBMA_TEXT, { exact: true })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toContainText("Open Data Commons Public Domain");
    await expect(page.getByRole("contentinfo")).toContainText("Bank for International Settlements");
  });

  test("states USD routing, parity, and the synthetic euro, and attributes BIS in the present tense", async ({
    page,
  }) => {
    await openApp(page);
    const method = page.getByRole("region", { name: "Method" });
    await expect(method).toContainText("USD-routing tenet");
    await expect(method).toContainText("ratio of means");
    await expect(method).toContainText("Bretton Woods");
    await expect(method).toContainText(SYNTHETIC_EUR_NOTE);
    await expect(method).toContainText(SYNTHETIC_DEM_NOTE);
    await expect(method.getByRole("link", { name: "historical notes" })).toHaveAttribute(
      "href",
      NOTES,
    );
    const bis =
      "Foreign-exchange rates come from the Bank for International Settlements (BIS) statistics, which are free to use with attribution.";
    await expect(method.getByText(bis, { exact: true })).toBeVisible();
    await expect(page.getByRole("contentinfo").getByText(bis, { exact: true })).toBeVisible();
    await expect(method).not.toContainText("will come from");
  });
});
