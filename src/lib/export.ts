// Export of the history built up by manual entry and imports, for backup and portability (pure functions).
// The data lives only in Supabase, so exporting to JSON/CSV improves safety and portability.

import type { Building, Reading } from "./domain";

/** Records plus the building master as a pretty-printed JSON string (a self-contained backup including residence periods). */
export function toExportJson(readings: Reading[], buildings: Building[]): string {
  return JSON.stringify({ buildings, readings }, null, 2);
}

const CSV_HEADER = [
  "utility",
  "building",
  "provider",
  "period_start",
  "period_end",
  "amount_yen",
  "usage_value",
  "usage_unit",
  "note",
  "source",
] as const;

/**
 * Escapes a CSV cell (quotes it only when it contains a comma, quote or newline).
 * Text cells starting with =, +, -, @, tab or CR are prefixed with a single quote so that
 * spreadsheet apps do not evaluate them as formulas (CSV injection). Numbers are left as is.
 */
function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = typeof value === "string" && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Records as a CSV string (CRLF line endings, with header). Buildings are written by name, falling back to the id when unresolved. */
export function toCsv(readings: Reading[], buildings: Building[]): string {
  const nameById = new Map(buildings.map((b) => [b.id, b.name]));
  const lines = [CSV_HEADER.join(",")];
  for (const r of readings) {
    lines.push(
      [
        r.utility,
        nameById.get(r.buildingId) ?? r.buildingId,
        r.provider,
        r.periodStart,
        r.periodEnd,
        r.amountYen,
        r.usageValue,
        r.usageUnit,
        r.note ?? "",
        r.source,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\r\n");
}

/** File name in the form "utility-tracker_YYYY-MM-DD.json". */
export function exportFilename(ext: "json" | "csv", now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `utility-tracker_${stamp}.${ext}`;
}
