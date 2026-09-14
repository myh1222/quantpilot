import { describe, expect, it } from "vitest";
import { evaluateEmaCross, type MarketBar } from "../src/local-alerts/rule.js";

const minuteMs = 60_000;
const baseTime = Date.UTC(2026, 8, 11, 1, 0, 0);

describe("EMA cross rule", () => {
  it("arms on cold start without replaying history", () => {
    const bars = createBars(20, 100);
    const result = evaluateEmaCross(bars, { lastEvaluatedBarMs: null }, ruleOptions());

    expect(result).toMatchObject({ status: "armed", signals: [] });
    expect(result.state.lastEvaluatedBarMs).toBe(bars.at(-1)?.openTimeMs);
  });

  it("detects an upward close-through-EMA cross", () => {
    const cold = evaluateEmaCross(
      createBars(20, 100),
      { lastEvaluatedBarMs: null },
      ruleOptions(),
    );
    const bars = [...createBars(20, 100), createBar(20, 101)];
    const result = evaluateEmaCross(bars, cold.state, ruleOptions());

    expect(result.status).toBe("evaluated");
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({
      event: "EMA_CROSS_UP",
      price: 101,
      bar_open_time_ms: bars.at(-1)?.openTimeMs,
    });
    expect(result.state.lastEvaluatedBarMs).toBe(bars.at(-1)?.openTimeMs);
  });

  it("rearms rather than evaluating a historical gap", () => {
    const oldBars = createBars(20, 100, baseTime - 10 * minuteMs);
    const cold = evaluateEmaCross(oldBars, { lastEvaluatedBarMs: null }, ruleOptions());
    const disconnectedBars = createBars(20, 150, baseTime + 10 * minuteMs);
    const result = evaluateEmaCross(disconnectedBars, cold.state, ruleOptions());

    expect(result).toMatchObject({ status: "armed", signals: [] });
    expect(result.state.lastEvaluatedBarMs).toBe(disconnectedBars.at(-1)?.openTimeMs);
  });
});

function ruleOptions() {
  return {
    symbol: "HKEX:981",
    timeframe: "15m",
    emaLength: 20,
    pineConfigVersion: 1,
    alertInstanceId: "local-ema-cross-v1",
  };
}

function createBars(count: number, close: number, firstOpenTimeMs = baseTime): MarketBar[] {
  return Array.from({ length: count }, (_, index) => createBar(index, close, firstOpenTimeMs));
}

function createBar(index: number, close: number, firstOpenTimeMs = baseTime): MarketBar {
  return { openTimeMs: firstOpenTimeMs + index * minuteMs, close };
}
