import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { cell, openApp, pasteText } from "./support";

const VECTORS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "test-vectors");
const vector = (name: string) => readFileSync(join(VECTORS, name));

async function importBuffer(page: Page, name: string, buffer: Buffer) {
  await page.getByTestId("import-input").setInputFiles({ name, mimeType: "text/csv", buffer });
}

async function exportBytes(page: Page): Promise<Buffer> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("goldvalue.csv");
  const path = await file.path();
  return readFileSync(path);
}

const filledRows = (page: Page) => page.locator("tr.sheet-row:not(.is-blank)");

test.describe("AC3: CSV import and export", () => {
  test("export -> import -> export is byte-identical", async ({ page }) => {
    await openApp(page);
    await cell(page, 0, "amount").focus();
    await pasteText(
      page,
      [
        "Amount,Date,Label",
        '"$1,500",Mar 1975,"gross, incl. bonus"',
        "80000,2018-12,House",
        "200000,today,Now",
        "-1500.25,06/03/2024,debt",
        "10000,1955,",
        "5,foo,Bad row (not exported)",
      ].join("\n"),
    );
    await expect(filledRows(page)).toHaveCount(6);

    const first = await exportBytes(page);
    const text = first.toString("utf8");
    expect(text).not.toContain("\r");
    expect(text.trimEnd().split("\n")).toHaveLength(6);
    expect(text.startsWith("date,amount,currency,label,effective,gold_usd_per_oz,troy_oz,")).toBe(
      true,
    );

    await importBuffer(page, "goldvalue.csv", first);
    await expect(page.getByRole("status").filter({ hasText: "Sheet imported" })).toContainText(
      "5 rows loaded",
    );
    await expect(filledRows(page)).toHaveCount(5);
    const second = await exportBytes(page);
    expect(second.equals(first)).toBe(true);
  });

  test("the app's export equals the CLI's --batch output (shared columns, all vectors)", async ({
    page,
  }) => {
    await openApp(page);
    for (const stem of ["basic", "legacy", "crlf", "dedupe"]) {
      await importBuffer(page, `batch-${stem}-in.csv`, vector(`batch-${stem}-in.csv`));
      await expect(page.getByRole("status").filter({ hasText: "Sheet imported" })).toBeVisible();
      const exported = await exportBytes(page);
      expect(exported.equals(vector(`batch-${stem}-out.csv`)), stem).toBe(true);
    }
  });

  test("bad lines are listed per line and the valid lines load (FR16)", async ({ page }) => {
    await openApp(page);
    const csv = [
      "date,amount,label",
      "1980-01-21,850,ok",
      "someday,5,bad date",
      "2018-12,abc,bad amount",
      "2999-01-01,10,future",
      "2018-12,80000,ok too",
    ].join("\n");
    await importBuffer(page, "mixed.csv", Buffer.from(csv));
    const report = page.getByTestId("import-report");
    await expect(report).toContainText("2 rows loaded, 3 lines skipped");
    const items = report.locator("li");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText("Line 3:");
    await expect(items.nth(1)).toContainText("Line 4:");
    await expect(items.nth(2)).toContainText("Line 5:");
    await expect(filledRows(page)).toHaveCount(2);
    await expect(cell(page, 0, "label")).toContainText("ok");
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.map((violation) => violation.id),
    ).toEqual([]);
  });

  test("a dropped file is imported", async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["date,amount\n2018-12,80000\n1975,1000\n"], "drop.csv", { type: "text/csv" }),
      );
      const target = document.querySelector(".sheet") as Element;
      for (const type of ["dragenter", "dragover", "drop"]) {
        target.dispatchEvent(
          new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }),
        );
      }
    });
    await expect(filledRows(page)).toHaveCount(2);
    await expect(cell(page, 0, "amount")).toContainText("80000");
  });

  test("files over 5 MB are refused without touching the sheet", async ({ page }) => {
    await openApp(page);
    await cell(page, 0, "amount").focus();
    await pasteText(page, "Amount,Date\n1000,2000");
    await expect(filledRows(page)).toHaveCount(1);
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, "a");
    await importBuffer(page, "big.csv", big);
    await expect(page.getByRole("alert")).toContainText("larger than 5 MB");
    await expect(filledRows(page)).toHaveCount(1);
  });

  test("a file without date and amount columns is refused", async ({ page }) => {
    await openApp(page);
    await importBuffer(page, "nope.csv", Buffer.from("foo,bar\n1,2\n"));
    await expect(page.getByRole("alert")).toContainText("date");
  });

  test("passthrough columns persist across a reload and Undo restores the old sheet", async ({
    page,
  }) => {
    await openApp(page);
    await cell(page, 0, "amount").focus();
    await pasteText(page, "Amount,Date\n1000,2000");
    await importBuffer(
      page,
      "region.csv",
      Buffer.from("date,amount,Region\n1980-01-21,850,west\n2018-12,80000,east\n"),
    );
    await expect(filledRows(page)).toHaveCount(2);
    const before = (await exportBytes(page)).toString("utf8");
    expect(before.split("\n")[0]).toContain("label,Region,effective");

    await page.reload();
    await expect(page.getByTestId("data-status")).toContainText("loaded through");
    expect((await exportBytes(page)).toString("utf8")).toBe(before);

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(filledRows(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    expect((await exportBytes(page)).toString("utf8")).toBe(before);
  });

  test("Undo after an import brings the previous rows back", async ({ page }) => {
    await openApp(page);
    await cell(page, 0, "amount").focus();
    await pasteText(page, "Amount,Date\n1000,2000\n2000,2001");
    await importBuffer(page, "one.csv", Buffer.from("date,amount\n2018-12,80000\n"));
    await expect(filledRows(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(filledRows(page)).toHaveCount(2);
  });

  test("export with nothing to export says so", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Export CSV" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Nothing to export" })).toBeVisible();
  });
});
