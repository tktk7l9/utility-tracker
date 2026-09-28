// Domain types and per-provider settings for the utility tracker.
// Pure data definitions only (no side effects). Shared by aggregation, CSV and UI.

export type Utility = "electricity" | "gas" | "water";

export type ReadingSource = "manual" | "csv" | "pdf";

/**
 * A home (building). One row = one residence period, doubling as the moving record
 * (moving back to the same building is a separate record). Maps to one row of the DB `buildings` table.
 */
export interface Building {
  id: string;
  name: string;
  /** Move-in date (YYYY-MM-DD). */
  movedInOn: string;
  /** Move-out date (YYYY-MM-DD). null = current home. */
  movedOutOn: string | null;
}

/** A new building without an id (the shape submitted by the add form). */
export type NewBuilding = Omit<Building, "id">;

/** A bill record for one provider and one reading period (maps to one row of the DB `readings` table). */
export interface Reading {
  id: string;
  utility: Utility;
  provider: string;
  /** Building (`buildings.id`). */
  buildingId: string;
  /** Start date of the reading period (YYYY-MM-DD). */
  periodStart: string;
  /** End date of the reading period (YYYY-MM-DD). */
  periodEnd: string;
  /** Billed amount including tax (yen). */
  amountYen: number;
  /** Usage (electricity = kWh / gas and water = m³). null when only the amount is known. */
  usageValue: number | null;
  /** Usage unit. */
  usageUnit: string | null;
  note?: string | null;
  source: ReadingSource;
}

/** A new record without an id (the shape submitted by manual entry and CSV import). */
export type NewReading = Omit<Reading, "id">;

export interface UtilityMeta {
  key: Utility;
  /** Japanese display name (電気/ガス/水道). */
  label: string;
  /** Default provider name. */
  provider: string;
  /** Default usage unit. */
  unit: string;
  /** Chart color (hex). */
  color: string;
}

export const UTILITIES: Record<Utility, UtilityMeta> = {
  electricity: {
    key: "electricity",
    label: "電気",
    provider: "TEPCO",
    unit: "kWh",
    color: "#e0a100",
  },
  gas: {
    key: "gas",
    label: "ガス",
    provider: "LPIO",
    unit: "m³",
    color: "#e0603d",
  },
  water: {
    key: "water",
    label: "水道",
    provider: "TokyoWaterworks",
    unit: "m³",
    color: "#2f8fd0",
  },
};

/** How a record was entered, in the words shown on screen (SHIG 11). */
export const SOURCE_LABELS: Record<ReadingSource, string> = {
  manual: "手入力",
  csv: "CSV",
  pdf: "PDF",
};

/** Display order for stacking and the legend. */
export const UTILITY_ORDER: Utility[] = ["electricity", "gas", "water"];

export function utilityMeta(u: Utility): UtilityMeta {
  return UTILITIES[u];
}

export function isUtility(v: string): v is Utility {
  return v === "electricity" || v === "gas" || v === "water";
}

/**
 * Rough monthly average utility costs for a typical household of two or more (yen, approximate).
 * Approximate values based on the Ministry of Internal Affairs and Communications' Family Income and Expenditure Survey (家計調査), used only as reference lines for comparison.
 */
export const HOUSEHOLD_AVERAGE = {
  electricity: 12000,
  gas: 5000,
  water: 5000,
  total: 22000,
} as const;
