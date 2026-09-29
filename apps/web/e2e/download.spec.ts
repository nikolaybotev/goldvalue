import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { cell, openApp, pasteText } from "./support";

const ROWS =
  "Amount,Date,Label\n80000,2018-12,House\n200000,2024-06-03,Later\n1000,1955,Old\n-500,1980-01-21,Debt\n60000,1975,Other\n61000,1975,Same x";

async function fillSheet(page: Page) {
  await openApp(page);
  await cell(page, 0, "amount").focus();
  await pasteText(page, ROWS);
  await expect(page.getByTestId("chart")).toBeVisible();
  await expect(page.getByTestId("point")).toHaveCount(6);
}

async function download(page: Page, name: string, filename: string): Promise<Buffer> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toBe(filename);
  return readFileSync(await file.path());
}

async function chartSize(page: Page) {
  return page.getByTestId("chart").evaluate((svg) => ({
    width: Number(svg.getAttribute("width")),
    height: Number(svg.getAttribute("height")),
  }));
}

function pngHeader(bytes: Buffer) {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

for (const deviceScaleFactor of [1, 3]) {
  test.describe(`AC4: chart download at devicePixelRatio ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor });

    test("the PNG is exactly 2x the SVG's width and height", async ({ page }) => {
      await fillSheet(page);
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(deviceScaleFactor);
      const size = await chartSize(page);
      const png = await download(page, "Download PNG", "goldvalue-chart.png");
      expect(pngHeader(png)).toEqual({ width: size.width * 2, height: size.height * 2 });
    });

    test("the PNG has the chart drawn on a white background", async ({ page }) => {
      await fillSheet(page);
      const png = await download(page, "Download PNG", "goldvalue-chart.png");
      const stats = await page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d") as CanvasRenderingContext2D;
        context.drawImage(bitmap, 0, 0);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        let white = 0;
        let ink = 0;
        let transparent = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] !== 255) transparent++;
          else if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255) white++;
          else ink++;
        }
        return { white, ink, transparent, corner: [data[0], data[1], data[2], data[3]] };
      }, png.toString("base64"));
      expect(stats.transparent).toBe(0);
      expect(stats.corner).toEqual([255, 255, 255, 255]);
      expect(stats.ink).toBeGreaterThan(500);
      expect(stats.white).toBeGreaterThan(stats.ink);
    });
  });
}

test.describe("AC4: SVG download", () => {
  test("it parses and equals the on-screen serialization apart from inlined styles", async ({
    page,
  }) => {
    await fillSheet(page);
    const file = await download(page, "Download SVG", "goldvalue-chart.svg");
    const text = file.toString("utf8");
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg ')).toBe(true);

    const result = await page.evaluate((exported) => {
      const parsed = new DOMParser().parseFromString(exported, "image/svg+xml");
      const parseError = parsed.querySelector("parsererror")?.textContent ?? null;
      // Attribute order is not significant (a parsed document lists xmlns first), so compare a
      // canonical form: tag, sorted attributes without `style`, then children.
      const canonical = (el: Element): string => {
        const attrs = [...el.attributes]
          .filter((attr) => attr.name !== "style")
          .map((attr) => `${attr.name}=${JSON.stringify(attr.value)}`)
          .sort()
          .join(" ");
        const kids = [...el.children].map(canonical).join("");
        return `<${el.localName} ${attrs}>${el.children.length === 0 ? (el.textContent ?? "") : ""}${kids}</${el.localName}>`;
      };
      const withoutStyles = canonical;
      const screen = document.querySelector('[data-testid="chart"]') as SVGSVGElement;
      const root = parsed.documentElement;
      const stylesOf = (selector: string) =>
        [...parsed.querySelectorAll(selector)].map((el) => el.getAttribute("style") ?? "");
      return {
        parseError,
        rootName: root.localName,
        xmlns: root.namespaceURI,
        width: root.getAttribute("width"),
        height: root.getAttribute("height"),
        screenWidth: screen.getAttribute("width"),
        screenHeight: screen.getAttribute("height"),
        exportedTree: withoutStyles(root),
        screenTree: withoutStyles(screen),
        allStyled: [...parsed.querySelectorAll("*")].every((el) => el.hasAttribute("style")),
        rootStyle: root.getAttribute("style") ?? "",
        seriesStyle: stylesOf(".series-line")[0] ?? "",
        pointStyle: stylesOf(".point")[0] ?? "",
        tickTextStyles: stylesOf(".axis text"),
        stylesheets: parsed.querySelectorAll("style, link, foreignObject, image, script").length,
        points: parsed.querySelectorAll('[data-testid="point"]').length,
        screenPoints: screen.querySelectorAll('[data-testid="point"]').length,
      };
    }, text);

    expect(result.parseError).toBeNull();
    expect(result.rootName).toBe("svg");
    expect(result.xmlns).toBe("http://www.w3.org/2000/svg");
    expect(result.width).toBe(result.screenWidth);
    expect(result.height).toBe(result.screenHeight);
    expect(result.exportedTree).toBe(result.screenTree);
    expect(result.points).toBe(6);
    expect(result.points).toBe(result.screenPoints);
    expect(result.allStyled).toBe(true);
    expect(result.stylesheets).toBe(0);
    expect(result.rootStyle).toContain("background-color:#ffffff");
    expect(result.seriesStyle).toContain("fill:none");
    expect(result.seriesStyle).toMatch(/stroke:rgb\(30, 78, 121\)/);
    expect(result.seriesStyle).toContain("stroke-width:1.75px");
    expect(result.pointStyle).toMatch(/fill:rgb\(30, 78, 121\)/);
    expect(result.tickTextStyles.length).toBeGreaterThan(4);
    for (const style of result.tickTextStyles) {
      expect(style).toMatch(/font-family:[^;]*sans-serif/);
      expect(style).toContain("font-size:11px");
    }
    expect(text).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
  });

  test("the SVG round-trips through an <img> at its explicit size", async ({ page }) => {
    await fillSheet(page);
    const text = (await download(page, "Download SVG", "goldvalue-chart.svg")).toString("utf8");
    const natural = await page.evaluate(async (exported) => {
      const url = URL.createObjectURL(new Blob([exported], { type: "image/svg+xml" }));
      const img = new Image();
      img.src = url;
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight };
    }, text);
    expect(natural).toEqual(await chartSize(page));
  });

  test("hover state is not exported", async ({ page }) => {
    await fillSheet(page);
    await page.getByTestId("point").nth(1).hover();
    await expect(page.getByTestId("chart-tooltip")).toBeVisible();
    const text = (await download(page, "Download SVG", "goldvalue-chart.svg")).toString("utf8");
    expect(text).not.toContain('class="guide"');
    expect(text).not.toContain("is-hover");
  });
});

test.describe("FR13: pixel dimensions are shown before download", () => {
  test("the label states the SVG and the 2x PNG size and follows a resize", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await fillSheet(page);
    const label = page.getByTestId("download-size");
    const read = async () => {
      const size = await chartSize(page);
      return `SVG ${size.width} \u00d7 ${size.height} px, PNG ${size.width * 2} \u00d7 ${size.height * 2} px`;
    };
    await expect(label).toHaveText(await read());
    await page.setViewportSize({ width: 700, height: 900 });
    await expect.poll(async () => (await label.textContent()) === (await read())).toBe(true);
    const narrow = await chartSize(page);
    expect(narrow.width).toBeLessThan(700);
    await expect(label).toContainText(`PNG ${narrow.width * 2} \u00d7 ${narrow.height * 2} px`);
  });

  test("no download buttons before there is a chart", async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole("button", { name: "Download SVG" })).toHaveCount(0);
    await expect(page.getByTestId("download-size")).toHaveCount(0);
  });
});
