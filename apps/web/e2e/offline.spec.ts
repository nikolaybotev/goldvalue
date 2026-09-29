import { expect, type Page, test } from "@playwright/test";
import {
  cell,
  expectDisplayed,
  FIXTURE_LAST_FIX,
  LBMA_URL,
  lbmaFixtureBody,
  monthlyPrice,
  PINNED_NOW,
  pasteText,
} from "./support";

test.use({ serviceWorkers: "allow" });

const DAY_ROW = { amount: "1000", date: "2018-12-14" };

interface Network {
  lbmaHits: string[];
  offline: boolean;
}

/**
 * Go offline. `setOffline` does not stop responses that Playwright fulfils itself, so the
 * LBMA stub is told too and fails like a dead network would.
 */
async function goOffline(page: Page, network: Network) {
  network.offline = true;
  await page.context().setOffline(true);
}

/** First visit online: the real preview server supplies the shell and data; LBMA is stubbed. */
async function firstVisit(page: Page): Promise<Network> {
  const network: Network = { lbmaHits: [], offline: false };
  await page.context().route(LBMA_URL, (route) => {
    const url = route.request().url();
    if (network.offline) return route.abort("internetdisconnected");
    network.lbmaHits.push(url);
    return route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: lbmaFixtureBody(url),
    });
  });
  await page.clock.setFixedTime(new Date(PINNED_NOW));
  await page.goto("/");
  await expect(page.getByRole("grid")).toBeVisible();
  await expect(page.getByTestId("data-status")).toContainText(`loaded through ${FIXTURE_LAST_FIX}`);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await cell(page, 0, "amount").focus();
  await pasteText(page, `Amount,Date\n80000,2018-12\n${DAY_ROW.amount},${DAY_ROW.date}`);
  await expect(cell(page, 1, "gb")).not.toHaveText("");
  return network;
}

const goldbacks = (page: Page, row: number) =>
  cell(page, row, "gb").getAttribute("data-value").then(Number);

async function clearIndexedDb(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Storage.clearDataForOrigin", {
    origin: new URL(page.url()).origin,
    storageTypes: "indexeddb",
  });
}

/** Precache keys carry a `?__WB_REVISION__=` query; compare paths only. */
const pathOf = (url: string) => new URL(url).pathname;

async function cacheContents(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      out[name] = (await cache.keys()).map((request) => request.url);
    }
    return out;
  });
}

test.describe("AC5: offline after the first load", () => {
  test("IndexedDB retained: the shell loads and rows compute at daily precision", async ({
    page,
  }) => {
    const network = await firstVisit(page);
    const dailyGb = await goldbacks(page, 1);
    await expect(cell(page, 1, "price").locator(".price")).toHaveAttribute(
      "data-note",
      "LBMA fix on the requested date",
    );

    await goOffline(page, network);
    await page.reload();
    await expect(page.getByRole("heading", { name: "GoldValue" })).toBeVisible();
    await expect(page.getByRole("grid")).toBeVisible();
    await expect(page.getByTestId("data-status")).toContainText(
      `loaded through ${FIXTURE_LAST_FIX}`,
    );
    await expect(page.getByTestId("degraded-note")).toHaveCount(0);
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    expect(await goldbacks(page, 1)).toBe(dailyGb);
    await expect(cell(page, 1, "price").locator(".price")).toHaveAttribute(
      "data-note",
      "LBMA fix on the requested date",
    );
    await expect(cell(page, 0, "price").locator(".price")).toHaveAttribute(
      "data-note",
      /average of \d+ LBMA daily fixes/,
    );

    // The app is fully usable offline: a new row computes too.
    await cell(page, 2, "amount").focus();
    await page.keyboard.type("500");
    await page.keyboard.press("Tab");
    await page.keyboard.type("2010-03-15");
    await page.keyboard.press("Enter");
    await expect(cell(page, 2, "price").locator(".price")).toHaveAttribute(
      "data-note",
      "LBMA fix on the requested date",
    );
  });

  test("IndexedDB cleared: the app loads at monthly precision and says so", async ({ page }) => {
    const network = await firstVisit(page);
    const dailyGb = await goldbacks(page, 1);
    await clearIndexedDb(page);

    await goOffline(page, network);
    await page.reload();
    await expect(page.getByRole("grid")).toBeVisible();
    await expect(page.getByTestId("data-status")).toContainText(
      "Daily LBMA prices not loaded; showing monthly values",
    );
    const note = page.getByTestId("degraded-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText("Degraded precision");

    await expect(cell(page, 1, "price").locator(".price")).toHaveAttribute(
      "data-note",
      /daily LBMA prices not loaded/,
    );
    const monthlyGb = await goldbacks(page, 1);
    expect(monthlyGb).not.toBe(dailyGb);
    const expected = (Number(DAY_ROW.amount) / monthlyPrice("2018-12")) * 1000;
    expectDisplayed(String(monthlyGb), expected, "monthly-precision GB");
    expect(Math.abs(monthlyGb - expected)).toBeLessThan(expected * 1e-9);
  });

  test("the service worker precaches the shell and data, and never caches LBMA", async ({
    page,
  }) => {
    const { lbmaHits } = await firstVisit(page);
    const urls = Object.values(await cacheContents(page))
      .flat()
      .map(pathOf);
    expect(urls.some((path) => path.endsWith("/data/monthly.csv"))).toBe(true);
    expect(urls.some((path) => path.endsWith("/data/manifest.json"))).toBe(true);
    expect(urls.some((path) => path.endsWith("/index.html"))).toBe(true);
    expect(urls.some((path) => /\.js$/.test(path))).toBe(true);
    expect(urls.filter((path) => /lbma|gold_(am|pm)\.json/i.test(path))).toEqual([]);
    expect(urls.filter((path) => /fx_/.test(path))).toEqual([]);

    // Fetch LBMA twice through the controlled page: both must reach the network.
    const before = lbmaHits.length;
    for (let i = 0; i < 2; i++) {
      const status = await page.evaluate(
        async () => (await fetch("https://prices.lbma.org.uk/json/gold_pm.json")).status,
      );
      expect(status).toBe(200);
    }
    expect(lbmaHits.length - before).toBe(2);
    const after = Object.values(await cacheContents(page)).flat();
    expect(after.filter((url) => /lbma|gold_(am|pm)\.json/i.test(url))).toEqual([]);
    expect(after.filter((url) => /lbma/i.test(new URL(url).hostname))).toEqual([]);
  });

  test("fx_*.csv is cached on first use, not precached", async ({ page }) => {
    const network = await firstVisit(page);
    const fetchFx = () =>
      page.evaluate(async () => {
        const response = await fetch("data/fx_eur.csv");
        return { status: response.status, text: await response.text() };
      });
    expect(await fetchFx()).toEqual({
      status: 200,
      text: "date,usd_per_unit\n1999-01-04,1.1789\n",
    });
    await expect
      .poll(async () => {
        const caches = await cacheContents(page);
        return (caches["goldvalue-fx"] ?? []).some((url) => url.endsWith("/data/fx_eur.csv"));
      })
      .toBe(true);
    await goOffline(page, network);
    expect((await fetchFx()).status).toBe(200);
  });
});
