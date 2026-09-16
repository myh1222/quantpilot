import { describe, expect, it } from "vitest";
import { parseTradingViewNumber } from "../src/tradingview/browser-provider.js";

describe("TradingView Data Window parsing", () => {
  it("parses localized numeric values and unavailable fields", () => {
    expect(parseTradingViewNumber("1,234.56")).toBe(1234.56);
    expect(parseTradingViewNumber("−12.5")).toBe(-12.5);
    expect(parseTradingViewNumber("—")).toBeNull();
    expect(parseTradingViewNumber("∅")).toBeNull();
    expect(parseTradingViewNumber("n/a")).toBeNull();
  });

  it("rejects text that is not a numeric field", () => {
    expect(() => parseTradingViewNumber("bullish")).toThrow("Invalid TradingView");
  });
});
