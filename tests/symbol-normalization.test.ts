import { describe, expect, it } from "vitest";
import { canonicalSymbol, normalizeProviderSymbol } from "../src/portfolio/symbols.js";

describe("portfolio symbol normalization", () => {
  it("normalizes provider and canonical market symbols", () => {
    expect(normalizeProviderSymbol(" 0981.hk ")).toBe("0981.HK");
    expect(canonicalSymbol("", "0981.HK")).toBe("HKEX:981");
    expect(canonicalSymbol("", "002371.SZ")).toBe("SZSE:002371");
    expect(canonicalSymbol("", "600519.SS")).toBe("SSE:600519");
    expect(canonicalSymbol("", "AAPL", "NasdaqGS")).toBe("NASDAQ:AAPL");
    expect(canonicalSymbol("hkex:00981", "0981.HK")).toBe("HKEX:981");
  });
});
