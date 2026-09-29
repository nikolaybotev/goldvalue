import { expect, test } from "@playwright/test";
import { cell, openApp, typeRow } from "./support";

test.describe("FR2a and row errors", () => {
  test("a future date is a row error and does not block other rows", async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, "1000", "2030");
    await typeRow(page, 1, "1000", "2020");
    await expect(cell(page, 0, "price")).toContainText("date is in the future");
    await expect(cell(page, 0, "date")).toHaveAttribute("aria-invalid", "true");
    await expect(cell(page, 0, "gb")).toHaveText("");
    await expect(cell(page, 1, "gb")).not.toHaveText("");
    await expect(cell(page, 1, "date")).not.toHaveAttribute("aria-invalid", "true");
  });

  test("tomorrow is in the future, today is not", async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, "1", "2026-09-30");
    await typeRow(page, 1, "1", "2026-09-29");
    await expect(cell(page, 0, "price")).toContainText("date is in the future");
    await expect(cell(page, 1, "price")).not.toContainText("future");
    await expect(cell(page, 1, "gb")).not.toHaveText("");
  });

  test("unparsable amounts and dates are marked with a reason", async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, "12x", "someday");
    await expect(cell(page, 0, "amount")).toHaveAttribute("aria-invalid", "true");
    await expect(cell(page, 0, "date")).toHaveAttribute("aria-invalid", "true");
    await expect(cell(page, 0, "price")).toContainText("invalid amount");
    await expect(cell(page, 0, "price")).toContainText("unrecognised date");
  });

  test("a partly filled row asks for the missing value", async ({ page }) => {
    await openApp(page);
    await cell(page, 0, "amount").focus();
    await page.keyboard.type("500");
    await page.keyboard.press("Enter");
    await expect(cell(page, 0, "price")).toContainText("enter a date");
  });
});

test.describe("sheet behaviour", () => {
  test("FR4: a new empty row appears once the last row has an amount or a date", async ({
    page,
  }) => {
    await openApp(page);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await cell(page, 0, "amount").focus();
    await page.keyboard.type("1");
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await cell(page, 0, "date").focus();
    await page.keyboard.type("2000");
    await page.keyboard.press("Enter");
    await expect(page.locator("tbody tr")).toHaveCount(2);
  });

  test("FR5: move buttons, delete, and sort by date", async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, "10", "2003");
    await typeRow(page, 1, "20", "2001");
    await typeRow(page, 2, "30", "2002-03");

    await page.getByRole("button", { name: "Move row 1 down" }).click();
    await expect(cell(page, 0, "amount")).toHaveText("20");
    await expect(cell(page, 1, "amount")).toHaveText("10");
    await page.getByRole("button", { name: "Move row 2 up" }).click();
    await expect(cell(page, 0, "amount")).toHaveText("10");

    await page.getByRole("button", { name: /Sort by date/ }).click();
    await expect(cell(page, 0, "date")).toHaveText("2001");
    await expect(cell(page, 1, "date")).toHaveText("2002-03");
    await expect(cell(page, 2, "date")).toHaveText("2003");
    await page.getByRole("button", { name: /Sort by date/ }).click();
    await expect(cell(page, 0, "date")).toHaveText("2003");

    await page.getByRole("button", { name: "Delete row 1" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(3);
    await expect(cell(page, 0, "date")).toHaveText("2002-03");
    await expect(cell(page, 2, "amount")).toHaveText("");
  });

  test("FR5: rows can be reordered by dragging", async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, "10", "2001");
    await typeRow(page, 1, "20", "2002");
    await typeRow(page, 2, "30", "2003");
    await page
      .locator("tbody tr")
      .nth(2)
      .locator(".grip")
      .dragTo(page.locator("tbody tr").nth(0).locator(".grip"));
    await expect(cell(page, 0, "amount")).toHaveText("30");
    await expect(cell(page, 1, "amount")).toHaveText("10");
  });

  test("FR7: rows persist across reloads and Clear resets them, with undo", async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, "1500", "1980-01-21");
    await cell(page, 0, "label").click();
    await page.keyboard.press("Enter");
    await page.keyboard.type("house");
    await page.keyboard.press("Enter");
    await page.reload();
    await expect(cell(page, 0, "amount")).toHaveText("1500");
    await expect(cell(page, 0, "label")).toHaveText("house");
    await expect(cell(page, 0, "gb")).not.toHaveText("");

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(cell(page, 0, "amount")).toHaveText("");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.reload();
    await expect(cell(page, 0, "amount")).toHaveText("");

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  });

  test("Clear can be undone", async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, "1500", "1980-01-21");
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(cell(page, 0, "amount")).toHaveText("");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(cell(page, 0, "amount")).toHaveText("1500");
  });

  test("FR8: GBD, oz, and label columns can be hidden and the choice persists", async ({
    page,
  }) => {
    await openApp(page);
    await expect(page.getByRole("columnheader", { name: "GBD" })).toBeVisible();
    await page.getByRole("button", { name: "GBD", exact: true }).click();
    await page.getByRole("button", { name: "Troy oz" }).click();
    await page.getByRole("button", { name: "Label", exact: true }).click();
    await expect(page.getByRole("columnheader", { name: "GBD" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Troy oz" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Label" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "GB", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("columnheader", { name: "GBD" })).toHaveCount(0);
    await page.getByRole("button", { name: "GBD", exact: true }).click();
    await expect(page.getByRole("columnheader", { name: "GBD" })).toBeVisible();
  });

  test("the price note is available on selection for keyboard and touch users", async ({
    page,
  }) => {
    await openApp(page);
    await typeRow(page, 0, "1000", "1975-03");
    await cell(page, 0, "price").click();
    await expect(page.getByTestId("row-detail")).toContainText("average of");
    await expect(page.getByTestId("row-detail")).toContainText("LBMA");
  });

  test("the grid exposes ARIA grid semantics", async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, "1000", "1975-03");
    const grid = page.getByRole("grid");
    await expect(grid).toHaveAttribute("aria-rowcount", "3");
    await expect(page.getByRole("columnheader")).toHaveCount(9);
    await expect(page.getByRole("gridcell").first()).toBeVisible();
    await expect(cell(page, 0, "gb")).toHaveAttribute("aria-readonly", "true");
  });
});
