import type { VitePWAOptions } from "vite-plugin-pwa";

type WorkboxOptions = NonNullable<VitePWAOptions["workbox"]>;

/**
 * Service worker rules (spec 6.3.3, D15).
 *
 * - Precache: the app shell plus `data/monthly.csv` and `data/manifest.json` (hence the
 *   `csv` and `json` globs). `fx_*.csv` (v1.1) is deliberately not precached.
 * - `fx_*.csv` is cached at runtime on first use.
 * - LBMA is never cached: an explicit network-only route (denylist) for `prices.lbma.org.uk`
 *   and any other `lbma.org.uk` host, and `manifestTransforms` drops anything LBMA-shaped from
 *   the precache list as a second guard. No other route can match those URLs, so nothing of
 *   LBMA's ever enters a cache. IndexedDB holds the only copy of the LBMA table.
 *
 * The `urlPattern` functions are serialised into the generated worker with `toString()`, so
 * they must not close over anything.
 */
export const LBMA_SHAPED = /lbma|gold_(am|pm)\.json/i;

export const FX_CACHE = "goldvalue-fx";

export const workboxOptions: WorkboxOptions = {
  globPatterns: ["**/*.{js,css,html,csv,json,svg}"],
  globIgnores: ["**/fx_*.csv", "**/*lbma*", "**/gold_am.json", "**/gold_pm.json", "**/*.map"],
  navigateFallback: "index.html",
  navigateFallbackDenylist: [/\/data\//],
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
  manifestTransforms: [
    (entries) => ({
      manifest: entries.filter((entry) => !LBMA_SHAPED.test(entry.url)),
      warnings: [],
    }),
  ],
  runtimeCaching: [
    {
      urlPattern: ({ url }) =>
        url.hostname === "prices.lbma.org.uk" ||
        url.hostname === "lbma.org.uk" ||
        url.hostname.endsWith(".lbma.org.uk"),
      handler: "NetworkOnly",
    },
    {
      urlPattern: ({ url, sameOrigin }) =>
        sameOrigin && /\/data\/fx_[a-z]{3}\.csv$/.test(url.pathname),
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: FX_CACHE,
        expiration: { maxEntries: 8 },
        cacheableResponse: { statuses: [200] },
      },
    },
  ],
};
