module.exports = {
  ci: {
    collect: {
      numberOfRuns: 3,
      url: ["http://127.0.0.1:4174/"],
      startServerCommand: "node scripts/serve-dist.mjs apps/web/dist-lh 4174",
      startServerReadyPattern: "Serving",
      startServerReadyTimeout: 20000,
      settings: {
        // Lighthouse's default is the mobile form factor with simulated slow-4G/4x CPU.
        chromeFlags: "--no-sandbox --headless=new",
        onlyCategories: ["performance", "accessibility", "best-practices"],
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.9, aggregationMethod: "median-run" }],
        "categories:accessibility": ["warn", { minScore: 0.95, aggregationMethod: "median-run" }],
        "categories:best-practices": ["warn", { minScore: 0.9, aggregationMethod: "median-run" }],
      },
    },
    upload: { target: "filesystem", outputDir: ".lighthouseci/report" },
  },
};
