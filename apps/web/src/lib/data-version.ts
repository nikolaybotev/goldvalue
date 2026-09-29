/**
 * A short identity for the deployed data files: the `name:sha256` pairs of the manifest, in
 * name order. It changes exactly when a published data file changes (formatting of
 * `manifest.json` does not matter). Null when the manifest is missing or has no hashes.
 */
export function dataVersionOf(manifest: unknown): string | null {
  if (typeof manifest !== "object" || manifest === null) return null;
  const files = (manifest as { files?: unknown }).files;
  if (typeof files !== "object" || files === null) return null;
  const parts = Object.entries(files as Record<string, unknown>)
    .flatMap(([name, info]) => {
      const sha = (info as { sha256?: unknown } | null)?.sha256;
      return typeof sha === "string" && sha !== "" ? [`${name}:${sha}`] : [];
    })
    .sort();
  return parts.length === 0 ? null : parts.join("|");
}

/**
 * Whether the stored LBMA table must be thrown away because the site's data changed.
 * A table saved without a version, or a page without a manifest, never triggers this.
 * While offline nothing is discarded: the stored table is the only daily copy, and there
 * would be no way to replace it (spec 6.3.3, NFR2).
 */
export function shouldDiscardStored(
  stored: string | null | undefined,
  current: string | null,
  online: boolean,
): boolean {
  return online && typeof stored === "string" && current !== null && stored !== current;
}
