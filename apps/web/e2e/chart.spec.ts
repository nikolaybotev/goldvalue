import { expect, test } from "@playwright/test";
import { cell, openApp, typeRow } from "./support";

const points = (page: import("@playwright/test").Page) => page.getByTestId("point");

test.describe("AC2: the chart follows the sheet", () => {
  test("it appears after the first valid row and updates within one animation frame of an edit", async ({
    page,
  }) => {
    await openApp(page);
    await expect(page.getByTestId("chart-empty")).toBeVisible();
    await expect(page.getByTestId("chart")).toHaveCount(0);

    await typeRow(page, 0, "1000", "1990-06-15");
    await expect(page.getByTestId("chart")).toBeVisible();
    await expect(points(page)).toHaveCount(1);
    await expect(page.getByTestId("chart-empty")).toHaveCount(0);

    await typeRow(page, 1, "1000", "2001-06-15");
    await expect(points(page)).toHaveCount(2);

    // Edit the second row's date through the real input, then look at the DOM one frame later.
    await cell(page, 1, "date").focus();
    await page.keyboard.press("Enter");
    const frame = await page.evaluate(
      () =>
        new Promise<{ before: string[]; after: string[] }>((resolve) => {
          const read = () =>
            [...document.querySelectorAll('[data-testid="point"]')].map(
              (c) => `${c.getAttribute("data-date")}@${c.getAttribute("cx")}`,
            );
          const input = document.querySelector("input.cell-input") as HTMLInputElement;
          const before = read();
          input.value = "2010-06-15";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          requestAnimationFrame(() => resolve({ before, after: read() }));
        }),
    );
    expect(frame.before[1]).toContain("2001-06-15");
    expect(frame.after[1]).toContain("2010-06-15");
    expect(frame.after[1]).not.toBe(frame.before[1]);

    await page.keyboard.press("Escape");
    await expect(points(page).nth(1)).toHaveAttribute("data-date", "2001-06-15");
  });

  test("an invalid row leaves the chart out and deleting the last valid row empties it", async ({
    page,
  }) => {
    await openApp(page);
    await typeRow(page, 0, "1000", "2030");
    await expect(page.getByTestId("chart-empty")).toBeVisible();
    await typeRow(page, 1, "1000", "2000");
    await expect(points(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Delete row 2" }).click();
    await expect(page.getByTestId("chart-empty")).toBeVisible();
  });
});

test.describe("AC7a FR12: position and tooltip", () => {
  test("a 1975 row plots at 2 July 1975 and its tooltip says year average of N fixes", async ({
    page,
  }) => {
    await openApp(page);
    await typeRow(page, 0, "1000", "1975");
    await expect(points(page).first()).toHaveAttribute("data-date", "1975-07-02");
    await points(page).first().hover();
    const tip = page.getByTestId("chart-tooltip");
    await expect(tip).toBeVisible();
    await expect(tip).toContainText(/year average of \d+ fixes/);
    await expect(tip).toContainText("$1,000.00");
    await expect(tip).toContainText("/oz");
  });

  test("months plot on the 16th and days on themselves, even when the fix rolled back", async ({
    page,
  }) => {
    await openApp(page);
    await typeRow(page, 0, "1", "1975-03");
    await typeRow(page, 1, "1", "2026-09-29");
    await expect(points(page).nth(0)).toHaveAttribute("data-date", "1975-03-16");
    await expect(points(page).nth(1)).toHaveAttribute("data-date", "2026-09-29");
    await points(page).nth(1).hover();
    await expect(page.getByTestId("chart-tooltip"))
      .toContainText("no LBMA fix on 2026-09-29")
      .catch(() => undefined);
    await expect(page.getByTestId("chart-tooltip")).toContainText("daily fix");
  });

  test("rows with the same x are drawn side by side and share one tooltip", async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, "1000", "1975");
    await cell(page, 0, "label").click();
    await page.keyboard.press("Enter");
    await page.keyboard.type("first");
    await page.keyboard.press("Enter");
    await typeRow(page, 1, "5000", "1975");
    await cell(page, 1, "label").click();
    await page.keyboard.press("Enter");
    await page.keyboard.type("second");
    await page.keyboard.press("Enter");
    await typeRow(page, 2, "2000", "1990");

    await expect(points(page)).toHaveCount(3);
    const first = points(page).nth(0);
    const second = points(page).nth(1);
    await expect(first).toHaveAttribute("data-date", "1975-07-02");
    await expect(second).toHaveAttribute("data-date", "1975-07-02");
    const x1 = Number(await first.getAttribute("data-x"));
    const x2 = Number(await second.getAttribute("data-x"));
    expect(x2 - x1).toBeGreaterThan(5);
    expect(x2 - x1).toBeLessThan(15);

    await second.hover();
    const tip = page.getByTestId("chart-tooltip");
    await expect(tip.locator("li")).toHaveCount(2);
    await expect(tip).toContainText("first");
    await expect(tip).toContainText("second");
    await third(page).hover();
    await expect(tip.locator("li")).toHaveCount(1);
  });
});

const third = (page: import("@playwright/test").Page) => points(page).nth(2);

test.describe("axis, scale, and overlay controls (FR10, D11)", () => {
  test("the axis defaults to GB, can be switched, and the choice can be saved as default", async ({
    page,
  }) => {
    await openApp(page);
    await typeRow(page, 0, "1000", "1990-01-02");
    const chart = page.getByTestId("chart");
    await expect(chart).toHaveAttribute("data-unit", "GB");
    await expect(
      page
        .getByRole("group", { name: "Y axis unit" })
        .getByRole("button", { name: "GB", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Default axis" })).toBeDisabled();

    const unitButton = page.getByRole("group", { name: "Y axis unit" });
    const before = await points(page).first().getAttribute("data-y");
    await unitButton.getByRole("button", { name: "GBD" }).click();
    await expect(chart).toHaveAttribute("data-unit", "GBD");
    await unitButton.getByRole("button", { name: "oz" }).click();
    await expect(chart).toHaveAttribute("data-unit", "OZ");
    expect(await points(page).first().getAttribute("data-y")).not.toBeNull();
    expect(before).not.toBeNull();

    await unitButton.getByRole("button", { name: "GBD" }).click();
    await page.getByRole("button", { name: "Save as default" }).click();
    await expect(page.getByRole("button", { name: "Default axis" })).toBeDisabled();
    await page.reload();
    await expect(page.getByTestId("chart")).toHaveAttribute("data-unit", "GBD");
    await expect(page.getByRole("button", { name: "Default axis" })).toBeDisabled();
  });

  test("the log toggle exists only while every value is positive", async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, "1000", "1990");
    await typeRow(page, 1, "2000", "2000");
    const log = page.getByRole("button", { name: "Log scale" });
    await expect(log).toBeVisible();
    await expect(page.getByTestId("chart")).toHaveAttribute("data-log", "false");
    await log.click();
    await expect(page.getByTestId("chart")).toHaveAttribute("data-log", "true");

    await typeRow(page, 2, "-500", "2010");
    await expect(points(page)).toHaveCount(3);
    await expect(log).toHaveCount(0);
    await expect(page.getByTestId("chart")).toHaveAttribute("data-log", "false");
    await expect(page.locator("line.zero-line")).toHaveCount(1);

    await page.getByRole("button", { name: "Delete row 3" }).click();
    await expect(log).toBeVisible();
    await expect(page.getByTestId("chart")).toHaveAttribute("data-log", "true");
  });

  test("the nominal overlay is off by default and draws a second series when enabled", async ({
    page,
  }) => {
    await openApp(page);
    await typeRow(page, 0, "1000", "1990");
    await typeRow(page, 1, "2000", "2000");
    await expect(page.getByTestId("nominal-point")).toHaveCount(0);
    await page.getByRole("button", { name: "Nominal USD" }).click();
    await expect(page.getByTestId("nominal-point")).toHaveCount(2);
    await expect(page.locator("path.overlay-line")).toHaveCount(1);
    await expect(page.locator("g.axis-y2")).toHaveCount(1);
    await page.getByRole("button", { name: "Nominal USD" }).click();
    await expect(page.getByTestId("nominal-point")).toHaveCount(0);
  });

  test("a single point renders as a point without a line", async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, "1000", "1990");
    await expect(points(page)).toHaveCount(1);
    await expect(page.locator("path.series-line")).toHaveCount(0);
    await expect(page.getByText("Add another row to draw the line.")).toBeVisible();
    await typeRow(page, 1, "1000", "2000");
    await expect(page.locator("path.series-line")).toHaveCount(1);
  });

  test("the chart resizes with its container", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await openApp(page);
    await typeRow(page, 0, "1000", "1990");
    await typeRow(page, 1, "1000", "2000");
    const chart = page.getByTestId("chart");
    const wide = Number(await chart.getAttribute("width"));
    await page.setViewportSize({ width: 500, height: 800 });
    await expect
      .poll(async () => Number(await chart.getAttribute("width")))
      .toBeLessThan(wide - 300);
    const narrow = Number(await chart.getAttribute("width"));
    expect(Number(await chart.getAttribute("height"))).toBeGreaterThanOrEqual(240);
    expect(narrow).toBeGreaterThan(300);
  });

  test("the chart has a text alternative that points to the sheet", async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, "1000", "1990");
    await typeRow(page, 1, "1000", "2000");
    await expect(page.getByRole("img", { name: /Line chart of 2 rows/ })).toBeVisible();
  });
});
