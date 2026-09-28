// Text decoding for imported CSV files (SHIG 29: automate the only sensible choice).
// Utility companies ship either UTF-8 or Shift_JIS; try UTF-8 first and fall back.

export type CsvEncoding = "utf-8" | "shift_jis";

export interface DecodedCsv {
  text: string;
  encoding: CsvEncoding;
}

/**
 * Decodes a CSV buffer. With an explicit encoding, uses it as is; otherwise decodes
 * as UTF-8 and re-decodes as Shift_JIS when UTF-8 yields replacement characters.
 */
export function decodeCsv(buf: ArrayBuffer, encoding?: CsvEncoding): DecodedCsv {
  if (encoding) return { text: new TextDecoder(encoding).decode(buf), encoding };
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return { text: utf8, encoding: "utf-8" };
  return { text: new TextDecoder("shift_jis").decode(buf), encoding: "shift_jis" };
}
