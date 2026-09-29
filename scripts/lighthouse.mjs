#!/usr/bin/env node
// Lighthouse CI (mobile, median of 3, performance >= 90) against a build that points the
// LBMA download at the synthetic fixture, so the run never contacts the real LBMA feed.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const outDir = "apps/web/dist-lh";
const run = (command, args, env = {}) => {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

rmSync(outDir, { recursive: true, force: true });
rmSync(".lighthouseci", { recursive: true, force: true });
run(
  "pnpm",
  ["--filter", "@goldvalue/web", "exec", "vite", "build", "--outDir", "dist-lh", "--emptyOutDir"],
  {
    VITE_LBMA_BASE: "./fixture-lbma/",
  },
);
run("python3", [
  "tools/snapshot/sync_data.py",
  "--source-dir",
  "test-vectors/snapshot",
  "--out",
  `${outDir}/data`,
]);
mkdirSync(`${outDir}/fixture-lbma`, { recursive: true });
for (const name of ["gold_am.json", "gold_pm.json"]) {
  cpSync(`test-vectors/snapshot/${name}`, `${outDir}/fixture-lbma/${name}`);
}
run("pnpm", ["exec", "lhci", "autorun", "--config=lighthouserc.cjs"]);
