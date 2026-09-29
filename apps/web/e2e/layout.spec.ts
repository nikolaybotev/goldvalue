import { expect, type Page, test } from "@playwright/test";
import { openApp, typeRow } from "./support";

async function boxes(page: Page) {
  const sheet = await page.locator("section.sheet").boundingBox();
  const chart = await page.locator("section.chart-panel").boundingBox();
  if (!sheet || !chart) throw new Error("layout boxes missing");
  return { sheet, chart };
}

test.describe("FR17 layout", () => {
  test("899 px stacks the chart below the sheet", async ({ page }) => {
    await page.setViewportSize({ width: 899, height: 900 });
    await openApp(page);
    await typeRow(page, 0, "1000", "1990");
    await expect(page.locator(".workspace")).toHaveAttribute("data-layout", "narrow");
    const { sheet, chart } = await boxes(page);
    expect(chart.y).toBeGreaterThanOrEqual(sheet.y + sheet.height - 1);
    expect(Math.abs(chart.x - sheet.x)).toBeLessThan(2);
    await expect(page.getByRole("separator")).toHaveCount(0);
  });

  test("900 px puts the sheet on the left and the chart on the right", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await openApp(page);
    await typeRow(page, 0, "1000", "1990");
    await expect(page.locator(".workspace")).toHaveAttribute("data-layout", "wide");
    const { sheet, chart } = await boxes(page);
    expect(chart.x).toBeGreaterThanOrEqual(sheet.x + sheet.width - 1);
    expect(Math.abs(chart.y - sheet.y)).toBeLessThan(2);
    await expect(page.getByRole("separator")).toBeVisible();
  });

  test("the layout follows the viewport when it is resized across the breakpoint", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await openApp(page);
    await expect(page.locator(".workspace")).toHaveAttribute("data-layout", "wide");
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(page.locator(".workspace")).toHaveAttribute("data-layout", "narrow");
  });

  test("the divider resizes by keyboard and by dragging, and the choice persists", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await openApp(page);
    await typeRow(page, 0, "1000", "1990");
    await typeRow(page, 1, "1000", "2000");
    const divider = page.getByRole("separator", { name: "Resize sheet and chart" });
    const start = Number(await divider.getAttribute("aria-valuenow"));
    const before = (await boxes(page)).sheet.width;

    await divider.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(divider).toHaveAttribute("aria-valuenow", String(start - 4));
    expect((await boxes(page)).sheet.width).toBeLessThan(before);

    await page.keyboard.press("Home");
    await expect(divider).toHaveAttribute("aria-valuenow", "30");
    await page.keyboard.press("End");
    await expect(divider).toHaveAttribute("aria-valuenow", "75");

    const box = await divider.boundingBox();
    if (!box) throw new Error("divider not visible");
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(600, box.y + 40, { steps: 6 });
    await page.mouse.up();
    const dragged = Number(await divider.getAttribute("aria-valuenow"));
    expect(dragged).toBeGreaterThan(40);
    expect(dragged).toBeLessThan(60);

    // The chart redraws for its new width.
    const chartWidth = await page.getByTestId("chart").getAttribute("width");
    await page.keyboard.press("End");
    await divider.focus();
    await page.keyboard.press("Home");
    await expect
      .poll(async () => page.getByTestId("chart").getAttribute("width"))
      .not.toBe(chartWidth);

    await page.reload();
    await expect(page.getByRole("separator")).toHaveAttribute("aria-valuenow", "30");
  });

  test("the chart can be collapsed in the narrow layout and the state persists", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await openApp(page);
    await typeRow(page, 0, "1000", "1990");
    const toggle = page.getByRole("button", { name: "Hide chart" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("chart")).toBeVisible();
    await toggle.click();
    await expect(page.getByRole("button", { name: "Show chart" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByTestId("chart")).toBeHidden();
    await page.reload();
    await expect(page.getByRole("button", { name: "Show chart" })).toBeVisible();
    await expect(page.getByTestId("chart")).toBeHidden();
    await page.getByRole("button", { name: "Show chart" }).click();
    await expect(page.getByTestId("chart")).toBeVisible();
  });

  test("a collapsed chart reappears in the wide layout without a collapse button", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await openApp(page);
    await typeRow(page, 0, "1000", "1990");
    await page.getByRole("button", { name: "Hide chart" }).click();
    await page.setViewportSize({ width: 1200, height: 900 });
    await expect(page.getByTestId("chart")).toBeVisible();
    await expect(page.getByRole("button", { name: /chart$/ })).toHaveCount(0);
  });
});
