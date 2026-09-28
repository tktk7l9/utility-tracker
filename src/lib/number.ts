// Lenient numeric input (SHIG 50: do not demand precision from the user).
// Pure function; shared by the manual entry form and the record editor.

/**
 * Parses what a person types into an amount/usage field.
 * Accepts thousands separators, full-width digits, yen marks ("¥", "円"), spaces
 * and a trailing usage unit ("kWh", "m³"). Returns null for blank input and NaN
 * when the text is not a number.
 */
export function parseLenientNumber(input: string): number | null {
  const normalized = input
    .normalize("NFKC") // full-width digits/punctuation, "￥" -> "¥", "㎥"/"m³" -> "m3"
    .replace(/[−‒–—]/g, "-")
    .replace(/[\s,¥\\円]/g, "")
    .replace(/(kwh|m3)$/i, "");
  if (normalized === "") return null;
  return Number(normalized);
}
