import { downloadBlob } from "../lib/download";
import { type PixelSize, PNG_SCALE, pngSize } from "./size";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Presentation properties copied from computed style into each element's `style` attribute. */
const INLINED_PROPERTIES = [
  "color",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "visibility",
] as const;

const FALLBACK_FONT = "sans-serif";

export interface SvgExport {
  /** The file contents. */
  text: string;
  /** Explicit CSS pixel size of the root `<svg>`. */
  size: PixelSize;
}

/** Explicit `width` and `height` of the root element (Chart always sets both). */
export function svgSize(svg: SVGSVGElement): PixelSize {
  const width = Number.parseFloat(svg.getAttribute("width") ?? "");
  const height = Number.parseFloat(svg.getAttribute("height") ?? "");
  if (!(width > 0) || !(height > 0)) throw new Error("the chart has no explicit width and height");
  return { width, height };
}

function inlineStyles(source: Element, target: Element): void {
  const computed = getComputedStyle(source);
  const style = INLINED_PROPERTIES.map((name) => {
    let value = computed.getPropertyValue(name);
    if (name === "font-family" && !/\bsans-serif\b/.test(value)) {
      value = `${value}, ${FALLBACK_FONT}`;
    }
    return value === "" ? "" : `${name}:${value}`;
  })
    .filter(Boolean)
    .join(";");
  target.setAttribute("style", style);
  const sourceChildren = source.children;
  const targetChildren = target.children;
  for (let i = 0; i < sourceChildren.length; i++) {
    const from = sourceChildren[i];
    const to = targetChildren[i];
    if (from && to) inlineStyles(from, to);
  }
}

/**
 * Serialize the on-screen chart (FR13): a deep copy with `xmlns`, explicit `width` and
 * `height`, and every style the page's CSS gives it written into `style` attributes, so
 * the file looks the same outside the app. Only transient hover state (the guide line and
 * `is-hover`) is dropped; everything else equals the DOM. System fonts only.
 */
export function serializeChart(svg: SVGSVGElement): SvgExport {
  const size = svgSize(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", String(size.width));
  clone.setAttribute("height", String(size.height));
  const root = clone.getAttribute("style") ?? "";
  clone.setAttribute("style", `${root};background-color:#ffffff`);
  for (const guide of clone.querySelectorAll(".guide")) guide.remove();
  for (const hovered of clone.querySelectorAll(".is-hover")) hovered.classList.remove("is-hover");
  const text = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}\n`;
  return { text, size };
}

/**
 * Rasterize the serialized chart into a PNG that is exactly `PNG_SCALE` times the SVG's
 * width and height, independent of `devicePixelRatio`. The image is decoded before it is
 * drawn (Safari draws an undecoded SVG image as nothing).
 */
export async function rasterizeChart(svg: SvgExport): Promise<Blob> {
  const target = pngSize(svg.size);
  const url = URL.createObjectURL(new Blob([svg.text], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.width = svg.size.width;
    img.height = svg.size.height;
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas is not available");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, target.width, target.height);
    context.scale(PNG_SCALE, PNG_SCALE);
    context.drawImage(img, 0, 0, svg.size.width, svg.size.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const SVG_FILENAME = "goldvalue-chart.svg";
export const PNG_FILENAME = "goldvalue-chart.png";

export function downloadSvg(svg: SVGSVGElement): void {
  const { text } = serializeChart(svg);
  downloadBlob(new Blob([text], { type: "image/svg+xml;charset=utf-8" }), SVG_FILENAME);
}

export async function downloadPng(svg: SVGSVGElement): Promise<void> {
  downloadBlob(await rasterizeChart(serializeChart(svg)), PNG_FILENAME);
}
