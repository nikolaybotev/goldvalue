#!/usr/bin/env node
// Build the app for Playwright into apps/web/dist-e2e with SYNTHETIC data files in its public
// folder, so `vite preview` serves real, precachable data/monthly.csv and data/manifest.json
// (the service worker tests need them) without touching a developer's apps/web/public/data.
// VITE_LBMA_BASE stays unset: the app still fetches LBMA from prices.lbma.org.uk, which the
// tests stub with the synthetic fixture.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "apps", "web");
const publicDir = join(web, ".e2e-public");

const run = (command, args, env = {}) => {
  const result = spawnSync(command, args, {
    cwd: web,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

rmSync(publicDir, { recursive: true, force: true });
mkdirSync(join(publicDir, "data"), { recursive: true });
run("python3", [
  join(root, "tools", "snapshot", "sync_data.py"),
  "--source-dir",
  join(root, "test-vectors", "snapshot"),
  "--out",
  join(publicDir, "data"),
]);
// v1.1 will publish fx_*.csv; a tiny stand-in lets the runtime-cache route be tested now.
writeFileSync(join(publicDir, "data", "fx_eur.csv"), "date,usd_per_unit\n1999-01-04,1.1789\n");

delete process.env.VITE_LBMA_BASE;
run("vite", ["build", "--outDir", "dist-e2e", "--emptyOutDir"], { GV_PUBLIC_DIR: ".e2e-public" });
