import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { cell, openApp, pasteText } from "./support";

async function violations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(" | ")})`,
  );
}

async function fill(page: Page) {
  await cell(page, 0, "amount").focus();
  await pasteText(
    page,
    "Amount,Date,Label\n80000,2018-12,House\n200000,today,House now\n1000,1955,Old\n5,2031,Future\n12x,foo,Bad\n-500,1980-01-21,Debt\n60000,1975,Other",
  );
  await expect(page.getByTestId("chart")).toBeVisible();
}

test.describe("NFR3: axe-core", () => {
  test("no violations on the empty page", async ({ page }) => {
    await openApp(page);
    expect(await violations(page)).toEqual([]);
  });

  test("no violations with rows, errors, the chart, and a tooltip", async ({ page }) => {
    await openApp(page);
    await fill(page);
    await page.getByTestId("point").nth(1).hover();
    await expect(page.getByTestId("chart-tooltip")).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test("no violations while editing a cell, with the overlay on, and with the chart collapsed", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await openApp(page);
    await fill(page);
    await page.getByRole("button", { name: "Nominal USD" }).click();
    await cell(page, 0, "date").click();
    await cell(page, 0, "date").click();
    await expect(page.locator("input.cell-input")).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Hide chart" }).click();
    expect(await violations(page)).toEqual([]);
  });

  test("no violations in the wide layout and in the unavailable state", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openApp(page);
    await fill(page);
    expect(await violations(page)).toEqual([]);

    const offline = await page.context().newPage();
    await offline.route("**/data/**", (route) => route.abort("internetdisconnected"));
    await offline.route("https://prices.lbma.org.uk/**", (route) =>
      route.abort("internetdisconnected"),
    );
    await offline.goto("./");
    await expect(offline.getByRole("alert")).toBeVisible();
    expect(await violations(offline)).toEqual([]);
  });
});
