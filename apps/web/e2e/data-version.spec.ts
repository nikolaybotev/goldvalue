import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { FIXTURE_LAST_FIX, openApp } from "./support";

test.describe("IndexedDB is discarded when the manifest changes", () => {
  test("an unchanged manifest keeps the stored LBMA table, a new sha downloads it afresh", async ({
    page,
  }) => {
    const stubs = await openApp(page);
    expect(stubs.lbmaRequests).toHaveLength(2);

    await page.reload();
    await expect(page.getByTestId("data-status")).toContainText(
      `loaded through ${FIXTURE_LAST_FIX}`,
    );
    expect(stubs.lbmaRequests).toHaveLength(2);

    stubs.manifestSha = "0".repeat(64);
    await page.reload();
    await expect.poll(() => stubs.lbmaRequests.length).toBe(4);
    await expect(page.getByTestId("data-status")).toContainText(
      `loaded through ${FIXTURE_LAST_FIX}`,
    );

    await page.reload();
    await expect(page.getByTestId("data-status")).toContainText(
      `loaded through ${FIXTURE_LAST_FIX}`,
    );
    expect(stubs.lbmaRequests).toHaveLength(4);
  });

  test("a new sha with LBMA unreachable leaves the sheet on monthly values", async ({ page }) => {
    const stubs = await openApp(page);
    stubs.manifestSha = "1".repeat(64);
    stubs.lbma = "fail";
    await page.reload();
    await expect(page.getByTestId("data-status")).toContainText("Daily LBMA prices not loaded");
    await expect(page.getByTestId("degraded-note")).toBeVisible();
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.map((violation) => violation.id)).toEqual([]);
  });
});
