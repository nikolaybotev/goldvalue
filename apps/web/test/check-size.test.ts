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
  const fx = "date,usd_per_unit\n".concat("1999-01-04,1.1789\n".repeat(20_000));
  const dir = dist({
    "index.html": "<html></html>",
    "data/monthly.csv": "month,usd\n",
    "data/fx_eur.csv": fx,
  });
  const result = run(dir, "--require-data");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("total gzipped");
  expect(result.stdout).toContain("on demand");
  expect(result.stdout).not.toMatch(/raw\s+data\/fx_eur/);
});

test("fails when an FX file is over its 110 KB gzip budget", () => {
  const noise = randomBytes(400_000).toString("hex");
  const result = run(dist({ "index.html": "x", "data/fx_gbp.csv": noise }));
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("data/fx_gbp.csv is");
  expect(result.stderr).toContain("FX budget");
});

test("--require-fx demands all three FX files", () => {
  const csv = "date,usd_per_unit\n1999-01-04,1.0\n";
  const some = run(dist({ "index.html": "x", "data/fx_eur.csv": csv }), "--require-fx");
  expect(some.status).toBe(1);
  expect(some.stderr).toContain("data/fx_gbp.csv missing");
  expect(some.stderr).toContain("data/fx_chf.csv missing");
  const all = run(
    dist({
      "index.html": "x",
      "data/fx_eur.csv": csv,
      "data/fx_gbp.csv": csv,
      "data/fx_chf.csv": csv,
    }),
    "--require-fx",
  );
  expect(all.status).toBe(0);
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
