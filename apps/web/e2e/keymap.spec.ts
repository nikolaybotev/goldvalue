import { expect, test } from "@playwright/test";
import { cell, openApp, pasteText, typeRow } from "./support";

test.describe("FR18 keyboard behaviour", () => {
  test("navigate mode: arrows move between cells, Enter and typing start editing", async ({
    page,
  }) => {
    await openApp(page);
    await typeRow(page, 0, "1000", "2018-12");
    await typeRow(page, 1, "2000", "2019-12");

    const amount0 = cell(page, 0, "amount");
    await amount0.focus();
    await expect(amount0).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(cell(page, 0, "date")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(cell(page, 1, "date")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(cell(page, 1, "amount")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(amount0).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(amount0).toBeFocused();

    await page.keyboard.press("End");
    await expect(cell(page, 0, "price")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(amount0).toBeFocused();

    await page.keyboard.press("Enter");
    const input = page.locator("input.cell-input");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("1000");
    await page.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(amount0).toBeFocused();

    await page.keyboard.press("F2");
    await expect(input).toBeFocused();
    await page.keyboard.press("Escape");

    await page.keyboard.type("77");
    await expect(input).toHaveValue("77");
    await page.keyboard.press("Enter");
    await expect(cell(page, 1, "amount")).toBeFocused();
    await expect(amount0).toHaveText("77");
  });

  test("edit mode: Enter commits and moves down, Tab commits and moves right, Esc cancels", async ({
    page,
  }) => {
    await openApp(page);
    await cell(page, 0, "amount").focus();
    await page.keyboard.type("1500");
    await page.keyboard.press("Tab");
    await expect(cell(page, 0, "date")).toBeFocused();
    await expect(cell(page, 0, "amount")).toHaveText("1500");
    await page.keyboard.type("1980-01-21");
    await expect(cell(page, 0, "gb")).not.toHaveText("");
    await page.keyboard.press("Enter");
    await expect(cell(page, 1, "date")).toBeFocused();
    await expect(cell(page, 0, "date")).toHaveText("1980-01-21");

    await page.keyboard.press("Shift+Tab");
    await expect(cell(page, 1, "amount")).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.type("999");
    await page.keyboard.press("Escape");
    await expect(cell(page, 1, "amount")).toHaveText("");
    await expect(cell(page, 1, "amount")).toBeFocused();

    await cell(page, 0, "amount").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.type("0");
    await page.keyboard.press("Escape");
    await expect(cell(page, 0, "amount")).toHaveText("1500");
  });

  test("arrow keys move the caret in edit mode instead of the active cell", async ({ page }) => {
    await openApp(page);
    await cell(page, 0, "amount").focus();
    await page.keyboard.type("1234");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("X");
    await expect(page.locator("input.cell-input")).toHaveValue("12X34");
    await page.keyboard.press("Escape");
  });

  test("Tab walks the row and wraps to the next row; Delete clears a cell", async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, "1000", "2018-12");
    await cell(page, 0, "amount").focus();
    for (const col of ["date", "label", "gb", "gbd", "oz", "price"]) {
      await page.keyboard.press("Tab");
      await expect(cell(page, 0, col)).toBeFocused();
    }
    await page.keyboard.press("Tab");
    await expect(cell(page, 1, "amount")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(cell(page, 0, "price")).toBeFocused();

    await cell(page, 0, "date").focus();
    await page.keyboard.press("Delete");
    await expect(cell(page, 0, "date")).toHaveText("");
    await expect(cell(page, 0, "gb")).toHaveText("");
  });

  test("Tab from the last cell leaves the grid instead of trapping focus", async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, "1000", "2018-12");
    await cell(page, 0, "price").focus();
    await page.keyboard.press("Tab");
    await expect(cell(page, 1, "amount")).toBeFocused();
    await cell(page, 1, "price").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("td[data-pos]:focus")).toHaveCount(0);
  });

  test("Alt+Arrow reorders and Alt+Delete removes the active row", async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, "10", "2001");
    await typeRow(page, 1, "20", "2002");
    await typeRow(page, 2, "30", "2003");
    await cell(page, 0, "amount").focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(cell(page, 1, "amount")).toHaveText("10");
    await expect(cell(page, 0, "amount")).toHaveText("20");
    await expect(cell(page, 1, "amount")).toBeFocused();
    await page.keyboard.press("Alt+ArrowUp");
    await expect(cell(page, 0, "amount")).toHaveText("10");
    await page.keyboard.press("Alt+Delete");
    await expect(cell(page, 0, "amount")).toHaveText("20");
    await expect(cell(page, 1, "amount")).toHaveText("30");
  });
});

test.describe("spreadsheet paste (S2)", () => {
  test("tab-separated cells fill amount and date from the active cell", async ({ page }) => {
    await openApp(page);
    await cell(page, 0, "amount").focus();
    await pasteText(page, "1000\t2001\n2000\t2002-06\n3000\t2003-03-14\n");
    await expect(cell(page, 2, "date")).toHaveText("2003-03-14");
    await expect(cell(page, 3, "amount")).toHaveText("");
    await expect(cell(page, 1, "gb")).not.toHaveText("");
  });

  test("CSV with a header maps columns by name and fills labels", async ({ page }) => {
    await openApp(page);
    await cell(page, 0, "amount").focus();
    await pasteText(page, 'Date,Amount,Label\n2001,"1,500",first\n2002-06,2000,second\n');
    await expect(cell(page, 0, "amount")).toHaveText("1,500");
    await expect(cell(page, 0, "date")).toHaveText("2001");
    await expect(cell(page, 1, "label")).toHaveText("second");
  });

  test("a column of dates pasted into the Date column keeps the amounts", async ({ page }) => {
    await openApp(page);
    await typeRow(page, 0, "1", "1990");
    await typeRow(page, 1, "2", "1991");
    await cell(page, 0, "date").focus();
    await pasteText(page, "2001\n2002");
    await expect(cell(page, 0, "date")).toHaveText("2001");
    await expect(cell(page, 1, "date")).toHaveText("2002");
    await expect(cell(page, 1, "amount")).toHaveText("2");
  });

  test("pasting into an edited cell replaces only that cell for a single value", async ({
    page,
  }) => {
    await openApp(page);
    await cell(page, 0, "amount").focus();
    await page.keyboard.press("Enter");
    await pasteText(page, "1,500");
    await page.keyboard.press("Escape");
    await pasteText(page, "$2,500");
    await expect(cell(page, 0, "amount")).toHaveText("$2,500");
  });
});
