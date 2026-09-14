import { describe, expect, it } from "vitest";
import { parseYahooBars } from "../src/local-alerts/yahoo.js";

describe("Yahoo chart parsing", () => {
  it("normalizes timestamps and closes while dropping null quotes", () => {
    const bars = parseYahooBars({
      chart: {
        result: [{
          timestamp: [1_700_000_000, 1_700_009_000],
          indicators: { quote: [{ close: [10.5, null] }] },
        }],
      },
    });

    expect(bars).toEqual([{ openTimeMs: 1_700_000_000_000, close: 10.5 }]);
  });

  it("surfaces provider errors", () => {
    expect(() => parseYahooBars({ chart: { error: { code: "Not Found" } } }))
      .toThrow(/Yahoo chart error/);
  });

  it("accepts an explicit null provider error", () => {
    const bars = parseYahooBars({
      chart: { error: null, result: [{ timestamp: [1], indicators: { quote: [{ close: [10] }] } }] },
    });

    expect(bars).toEqual([{ openTimeMs: 1000, close: 10 }]);
  });
});
