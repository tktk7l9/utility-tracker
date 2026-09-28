import { describe, it, expect } from "vitest";
import { UTILITIES, UTILITY_ORDER, utilityMeta, isUtility, SOURCE_LABELS } from "./domain";

describe("domain", () => {
  it("defines three utilities in UTILITIES, each with defaults", () => {
    expect(UTILITIES.electricity.unit).toBe("kWh");
    expect(UTILITIES.gas.provider).toBe("LPIO");
    expect(UTILITIES.water.provider).toBe("TokyoWaterworks");
    expect(UTILITIES.water.label).toBe("水道");
  });

  it("orders UTILITY_ORDER as electricity, gas, water", () => {
    expect(UTILITY_ORDER).toEqual(["electricity", "gas", "water"]);
  });

  it("utilityMeta returns the meta for the key", () => {
    expect(utilityMeta("gas").color).toBe(UTILITIES.gas.color);
  });

  it("isUtility is true only for the three kinds", () => {
    expect(isUtility("electricity")).toBe(true);
    expect(isUtility("gas")).toBe(true);
    expect(isUtility("water")).toBe(true);
    expect(isUtility("internet")).toBe(false);
    expect(isUtility("")).toBe(false);
  });

  it("SOURCE_LABELS shows how a record was entered in plain words", () => {
    expect(SOURCE_LABELS).toEqual({ manual: "手入力", csv: "CSV", pdf: "PDF" });
  });
});
