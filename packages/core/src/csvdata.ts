export class DataCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataCsvError";
  }
}

/**
 * Parse one of the fixed-schema data files (`lbma_daily.csv`, `monthly.csv`).
 * The files are unquoted and regular, so a `split` is enough and much cheaper than a
 * general CSV parser. Accepts `\n` and `\r\n` line endings, an optional BOM, and
 * blank lines. The header must contain every name in `columns`; extra columns are
 * ignored. Returns one array of strings per row, ordered like `columns`.
 */
export function parseDataCsv(text: string, columns: readonly string[]): string[][] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerLine = lines[0];
  if (headerLine === undefined || headerLine.trim() === "") {
    throw new DataCsvError("data file is empty");
  }
  const header = headerLine.split(",").map((name) => name.trim());
  const indexes = columns.map((name) => header.indexOf(name));
  const missing = columns.filter((_, i) => indexes[i] === -1);
  if (missing.length > 0) {
    throw new DataCsvError(`data file is missing column(s): ${missing.join(", ")}`);
  }
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() === "") continue;
    const fields = line.split(",");
    if (fields.length < header.length) {
      throw new DataCsvError(
        `line ${i + 1}: expected ${header.length} fields, got ${fields.length}`,
      );
    }
    rows.push(indexes.map((index) => (fields[index] as string).trim()));
  }
  return rows;
}
