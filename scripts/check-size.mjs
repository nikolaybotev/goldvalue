#!/usr/bin/env node
// NFR1: the initial static load (everything in dist except on-demand fx_*.csv) must be
// at most 250 KB gzipped. Also guards spec D15: no LBMA price data may be published.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const dist = option("--dist", "apps/web/dist");
const maxBytes = Number(option("--max-kb", "250")) * 1000;
const requireData = args.includes("--require-data");

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

let files;
try {
  files = [...walk(dist)];
} catch {
  console.error(`check-size: ${dist} not found; run the build first`);
  process.exit(2);
}

const problems = [];
const lbmaShaped = /lbma|gold_(am|pm)\.json/i;
for (const file of files) {
  if (lbmaShaped.test(relative(dist, file))) {
    problems.push(`LBMA-shaped file must not be published (spec D15): ${relative(dist, file)}`);
  }
}

const counted = files.filter(
  (file) => !/(^|[\\/])fx_[^\\/]*\.csv$/.test(file) && !file.endsWith(".map"),
);
let total = 0;
const rows = counted.map((file) => {
  const raw = readFileSync(file);
  const gz = gzipSync(raw, { level: 9 }).length;
  total += gz;
  return { name: relative(dist, file), raw: raw.length, gz };
});
rows.sort((a, b) => b.gz - a.gz);
for (const row of rows) {
  console.log(`${String(row.gz).padStart(8)} gz  ${String(row.raw).padStart(8)} raw  ${row.name}`);
}
console.log(
  `total gzipped: ${(total / 1000).toFixed(1)} kB (budget ${(maxBytes / 1000).toFixed(0)} kB)`,
);

if (requireData && !rows.some((row) => row.name === join("data", "monthly.csv"))) {
  problems.push("data/monthly.csv missing from dist; the budget must include the monthly series");
}
if (total > maxBytes) problems.push(`initial dist is ${total} bytes gzipped, over ${maxBytes}`);

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-size: ${problem}`);
  process.exit(1);
}
