import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const FORBIDDEN = [
  /\b(?:window|document|navigator|localStorage|sessionStorage|indexedDB|XMLHttpRequest)\b/,
  /\bglobalThis\.(?:fetch|document|window)\b/,
  /from\s+["'](?:node:|fs|path|url|os)/,
  /\brequire\(/,
];

test("packages/core/src uses no DOM or Node APIs (fetch is injected)", () => {
  const offenders: string[] = [];
  for (const name of readdirSync(srcDir).filter((file) => file.endsWith(".ts"))) {
    const code = readFileSync(join(srcDir, name), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const pattern of FORBIDDEN) {
      if (pattern.test(code)) offenders.push(`${name}: ${pattern}`);
    }
  }
  expect(offenders).toEqual([]);
});
