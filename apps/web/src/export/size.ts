/** The PNG is always this many times the SVG's width and height, whatever the screen's pixel ratio (FR13). */
export const PNG_SCALE = 2;

export interface PixelSize {
  width: number;
  height: number;
}

export function pngSize(svg: PixelSize): PixelSize {
  return { width: svg.width * PNG_SCALE, height: svg.height * PNG_SCALE };
}

export function sizeLabel(svg: PixelSize): string {
  const png = pngSize(svg);
  return `SVG ${svg.width} \u00d7 ${svg.height} px, PNG ${png.width} \u00d7 ${png.height} px`;
}
