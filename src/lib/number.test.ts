import { describe, it, expect } from "vitest";
import { parseLenientNumber } from "./number";

describe("parseLenientNumber", () => {
  it("returns null for blank input", () => {
    expect(parseLenientNumber("")).toBeNull();
    expect(parseLenientNumber("   ")).toBeNull();
  });

  it("parses plain numbers", () => {
    expect(parseLenientNumber("6200")).toBe(6200);
    expect(parseLenientNumber("24.5")).toBe(24.5);
  });

  it("accepts thousands separators, yen marks and spaces", () => {
    expect(parseLenientNumber("6,200")).toBe(6200);
    expect(parseLenientNumber("¥6,200")).toBe(6200);
    expect(parseLenientNumber("6,200 円")).toBe(6200);
    expect(parseLenientNumber("\\6200")).toBe(6200);
  });

  it("accepts full-width digits, comma, period and yen sign", () => {
    expect(parseLenientNumber("６，２００")).toBe(6200);
    expect(parseLenientNumber("￥６２００円")).toBe(6200);
    expect(parseLenientNumber("２４．５")).toBe(24.5);
    expect(parseLenientNumber("　１２　")).toBe(12);
  });

  it("accepts a trailing usage unit", () => {
    expect(parseLenientNumber("320kWh")).toBe(320);
    expect(parseLenientNumber("24 m³")).toBe(24);
    expect(parseLenientNumber("24㎥")).toBe(24);
  });

  it("normalises unicode minus signs", () => {
    expect(parseLenientNumber("−120")).toBe(-120);
    expect(parseLenientNumber("－120")).toBe(-120);
  });

  it("returns NaN for text that is not a number", () => {
    expect(parseLenientNumber("abc")).toBeNaN();
    expect(parseLenientNumber("1.2.3")).toBeNaN();
  });
});
