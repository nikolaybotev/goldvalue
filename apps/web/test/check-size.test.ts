import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { ROOT } from "./support";

const script = join(ROOT, "scripts", "check-size.mjs");
const dirs: string[] = [];

function dist(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), "gv-dist-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

function run(dir: string, ...extra: string[]) {
  return spawnSync("node", [script, "--dist", dir, ...extra], { encoding: "utf8" });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("passes when the gzipped initial load is within budget and ignores fx_ files", () => {
  const noise = randomBytes(400_000);
  const dir = dist({
    "index.html": "<html></html>",
    "data/monthly.csv": "month,usd\n",
    "data/fx_eur.csv": noise,
  });
  const result = run(dir, "--require-data");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("total gzipped");
  expect(result.stdout).not.toContain("fx_eur");
});

test("fails when the initial load is over budget", () => {
  const noise = randomBytes(400_000);
  const result = run(dist({ "assets/app.js": noise }), "--max-kb", "100");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("over 100000");
});

test("fails when monthly.csv is required but missing", () => {
  const result = run(dist({ "index.html": "x" }), "--require-data");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("data/monthly.csv missing");
});

test("refuses to publish LBMA-shaped files (spec D15)", () => {
  for (const name of ["data/lbma_daily.csv", "data/gold_pm.json", "gold_am.json"]) {
    const result = run(dist({ "index.html": "x", [name]: "d" }));
    expect(result.status, name).toBe(1);
    expect(result.stderr).toContain("spec D15");
  }
});
