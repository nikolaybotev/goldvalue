import { expect, test } from "vitest";
import { FX_CACHE, LBMA_SHAPED, workboxOptions } from "../pwa.config";

type Match = (context: { url: URL; sameOrigin: boolean }) => boolean;

const routes = workboxOptions.runtimeCaching ?? [];
const match = (index: number, url: string, sameOrigin = false) => {
  const pattern = routes[index]?.urlPattern as Match | undefined;
  if (!pattern) throw new Error(`no runtime route ${index}`);
  return pattern({ url: new URL(url), sameOrigin });
};

const LBMA_URLS = [
  "https://prices.lbma.org.uk/json/gold_pm.json",
  "https://prices.lbma.org.uk/json/gold_am.json?x=1",
  "https://www.lbma.org.uk/prices-and-data",
  "https://lbma.org.uk/x",
];

test("precache covers the shell plus csv and json data files", () => {
  const globs = workboxOptions.globPatterns?.join(" ") ?? "";
  for (const extension of ["js", "css", "html", "csv", "json"]) expect(globs).toContain(extension);
  expect(workboxOptions.globIgnores).toEqual(expect.arrayContaining(["**/fx_*.csv"]));
});

test("autoUpdate semantics: the new worker takes over without a prompt", () => {
  expect(workboxOptions.skipWaiting).toBe(true);
  expect(workboxOptions.clientsClaim).toBe(true);
  expect(workboxOptions.cleanupOutdatedCaches).toBe(true);
});

test("LBMA hosts have an explicit network-only route, first in the runtime list", () => {
  expect(routes[0]?.handler).toBe("NetworkOnly");
  for (const url of LBMA_URLS) expect(match(0, url), url).toBe(true);
  expect(match(0, "https://example.com/data/monthly.csv")).toBe(false);
  expect(match(0, "https://notlbma.org.uk/")).toBe(false);
});

test("no caching route can match an LBMA URL", () => {
  for (const [index, route] of routes.entries()) {
    if (route.handler === "NetworkOnly") continue;
    for (const url of LBMA_URLS) expect(match(index, url, false), `${index} ${url}`).toBe(false);
  }
});

test("fx_*.csv is cached on first use, same origin only", () => {
  const fx = routes.findIndex((route) => route.options?.cacheName === FX_CACHE);
  expect(fx).toBeGreaterThan(0);
  expect(routes[fx]?.handler).toBe("StaleWhileRevalidate");
  expect(match(fx, "https://host.test/goldvalue/data/fx_eur.csv", true)).toBe(true);
  expect(match(fx, "https://host.test/data/fx_gbp.csv", true)).toBe(true);
  expect(match(fx, "https://host.test/data/monthly.csv", true)).toBe(false);
  expect(match(fx, "https://other.test/data/fx_eur.csv", false)).toBe(false);
});

test("LBMA-shaped entries are removed from the precache list", async () => {
  const transform = workboxOptions.manifestTransforms?.[0];
  const entries = [
    { url: "index.html", revision: "1", size: 1 },
    { url: "data/monthly.csv", revision: "2", size: 1 },
    { url: "data/lbma_daily.csv", revision: "3", size: 1 },
    { url: "fixture-lbma/gold_pm.json", revision: "4", size: 1 },
    { url: "gold_am.json", revision: "5", size: 1 },
  ];
  const result = await transform?.(entries);
  expect(result?.manifest.map((entry) => entry.url)).toEqual(["index.html", "data/monthly.csv"]);
  expect(LBMA_SHAPED.test("data/manifest.json")).toBe(false);
});
