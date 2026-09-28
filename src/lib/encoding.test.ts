import { describe, it, expect } from "vitest";
import { decodeCsv } from "./encoding";

const bytes = (...b: number[]) => new Uint8Array(b).buffer;

describe("decodeCsv", () => {
  it("decodes UTF-8 when it is valid", () => {
    const buf = new TextEncoder().encode("検針日,金額\n2026-08-31,6200").buffer;
    expect(decodeCsv(buf)).toEqual({ text: "検針日,金額\n2026-08-31,6200", encoding: "utf-8" });
  });

  it("falls back to Shift_JIS when UTF-8 decoding produces replacement characters", () => {
    // "検針日,金額" in Shift_JIS
    const buf = bytes(0x8c, 0x9f, 0x90, 0x6a, 0x93, 0xfa, 0x2c, 0x8b, 0xe0, 0x8a, 0x7a);
    expect(decodeCsv(buf)).toEqual({ text: "検針日,金額", encoding: "shift_jis" });
  });

  it("uses the explicitly chosen encoding", () => {
    const buf = bytes(0x93, 0x64, 0x8b, 0x43); // "電気" in Shift_JIS
    expect(decodeCsv(buf, "shift_jis").text).toBe("電気");
    expect(decodeCsv(buf, "utf-8").encoding).toBe("utf-8");
  });

  it("treats ASCII-only files as UTF-8", () => {
    expect(decodeCsv(bytes(0x61, 0x2c, 0x62)).encoding).toBe("utf-8");
  });
});
