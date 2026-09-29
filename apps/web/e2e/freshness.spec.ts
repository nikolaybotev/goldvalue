import { expect, test } from "@playwright/test";
import { cell, FIXTURE_LAST_FIX, openApp, typeRow } from "./support";

test.describe("FR20 freshness and refresh", () => {
  test("shows the latest fix and downloaded time, and Refresh is rate limited", async ({
    page,
  }) => {
    const stubs = await openApp(page);
    const status = page.getByTestId("data-status");
    await expect(status).toContainText(`Daily LBMA prices loaded through ${FIXTURE_LAST_FIX}`);
    await expect(status).toContainText("downloaded Sep 29, 2026, 12:00 PM");
    await expect(status).toContainText("monthly series through 2026-09");
    const refresh = page.getByRole("button", { name: "Refresh", exact: true });
    await expect(refresh).toBeDisabled();
    await expect(page.getByTestId("refresh-hint")).toContainText("once every 12 hours");
    await expect(page.getByTestId("refresh-hint")).toContainText("Sep 30, 2026, 12:00 AM");
    expect(stubs.lbmaRequests).toHaveLength(2);
  });

  test("Refresh downloads again once 12 hours have passed", async ({ page }) => {
    const stubs = await openApp(page);
    await page.clock.setFixedTime(new Date("2026-09-30T01:00:00Z"));
    await page.reload();
    const refresh = page.getByRole("button", { name: "Refresh", exact: true });
    await expect(refresh).toBeEnabled();
    // Reloading also topped up automatically (the cached fix is stale); wait for that to settle.
    await expect.poll(() => stubs.lbmaRequests.length).toBe(4);
    await expect(refresh).toBeDisabled();
    await page.clock.setFixedTime(new Date("2026-10-01T02:00:00Z"));
    await page.reload();
    await expect.poll(() => stubs.lbmaRequests.length).toBe(6);
  });

  test("a failed download is reported, keeps the sheet working, and can be retried", async ({
    page,
  }) => {
    const stubs = await openApp(page, { lbma: "fail" });
    await expect(page.getByTestId("data-status")).toContainText(
      "Daily LBMA prices not loaded; showing monthly values",
    );
    await expect(page.getByTestId("refresh-error")).toContainText("Could not download LBMA prices");
    await typeRow(page, 0, "1000", "2018-12");
    await expect(cell(page, 0, "gb")).not.toHaveText("");

    stubs.lbma = "ok";
    const refresh = page.getByRole("button", { name: "Refresh", exact: true });
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await expect(page.getByTestId("data-status")).toContainText(
      `loaded through ${FIXTURE_LAST_FIX}`,
    );
    await expect(page.getByTestId("refresh-error")).toHaveCount(0);
    await expect(cell(page, 0, "price").locator(".price")).toHaveAttribute(
      "data-note",
      /average of \d+ LBMA daily fixes/,
    );
    await expect(refresh).toBeDisabled();
  });

  test("a failure with older data keeps the data and says the refresh failed", async ({ page }) => {
    const stubs = await openApp(page);
    stubs.lbma = "fail";
    await page.clock.setFixedTime(new Date("2026-09-30T01:00:00Z"));
    await page.reload();
    await expect(page.getByTestId("data-status")).toContainText(
      `loaded through ${FIXTURE_LAST_FIX}`,
    );
    await expect(page.getByTestId("refresh-error")).toContainText("Could not download LBMA prices");
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  });
});
