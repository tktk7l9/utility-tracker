// 光熱費トラッカーのドメイン型と各社設定。
// 純粋なデータ定義のみ（副作用なし）。集計・CSV・UI から共有する。

export type Utility = "electricity" | "gas" | "water";

export type ReadingSource = "manual" | "csv";

/** 1社・1検針期間の請求レコード（DB `readings` テーブルの1行に対応）。 */
export interface Reading {
  id: string;
  utility: Utility;
  provider: string;
  /** 検針期間の開始日 (YYYY-MM-DD)。 */
  periodStart: string;
  /** 検針期間の終了日 (YYYY-MM-DD)。 */
  periodEnd: string;
  /** 税込請求額（円）。 */
  amountYen: number;
  /** 使用量（電気=kWh / ガス・水道=m³）。金額のみ既知なら null。 */
  usageValue: number | null;
  /** 使用量の単位。 */
  usageUnit: string | null;
  note?: string | null;
  source: ReadingSource;
}

/** id を持たない新規レコード（手入力・CSV取込時の投入形）。 */
export type NewReading = Omit<Reading, "id">;

export interface UtilityMeta {
  key: Utility;
  /** 日本語表示名（電気/ガス/水道）。 */
  label: string;
  /** 既定の事業者名。 */
  provider: string;
  /** 既定の使用量単位。 */
  unit: string;
  /** グラフ用の色（16進）。 */
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

/** 積み上げ・凡例の表示順。 */
export const UTILITY_ORDER: Utility[] = ["electricity", "gas", "water"];

export function utilityMeta(u: Utility): UtilityMeta {
  return UTILITIES[u];
}

export function isUtility(v: string): v is Utility {
  return v === "electricity" || v === "gas" || v === "water";
}
