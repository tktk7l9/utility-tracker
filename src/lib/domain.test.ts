import { describe, it, expect } from "vitest";
import { UTILITIES, UTILITY_ORDER, utilityMeta, isUtility, SOURCE_LABELS } from "./domain";

describe("domain", () => {
  it("UTILITIES に3社が定義され既定値を持つ", () => {
    expect(UTILITIES.electricity.unit).toBe("kWh");
    expect(UTILITIES.gas.provider).toBe("LPIO");
    expect(UTILITIES.water.provider).toBe("TokyoWaterworks");
    expect(UTILITIES.water.label).toBe("水道");
  });

  it("UTILITY_ORDER は電気→ガス→水道", () => {
    expect(UTILITY_ORDER).toEqual(["electricity", "gas", "water"]);
  });

  it("utilityMeta はキーに対応するメタを返す", () => {
    expect(utilityMeta("gas").color).toBe(UTILITIES.gas.color);
  });

  it("isUtility は3種のみ true", () => {
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
