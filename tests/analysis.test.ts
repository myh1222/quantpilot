import { describe, expect, it } from "vitest";
import { buildTechnicalAnalysis, renderMarkdown } from "../src/analysis/report.js";
import type { MarketBar } from "../src/local-alerts/rule.js";

describe("technical analysis report", () => {
  it("calculates indicators, frozen levels, statistics, and deterministic judgement", () => {
    const report = buildTechnicalAnalysis({
      symbol: "HKEX:981",
      provider: "test",
      providerSymbol: "0981.HK",
      timeframeMinutes: 15,
      bars: syntheticBars(260),
      now: new Date("2026-09-14T08:00:00Z"),
      pivotLeft: 3,
      pivotRight: 3,
      levelMaxAgeBars: 200,
      touchTolerancePercent: 0.3,
    });

    expect(report.barCount).toBe(260);
    expect(Number.isFinite(report.technical.ema200)).toBe(true);
    expect(report.judgement.technicalScore).toBeGreaterThanOrEqual(0);
    expect(report.judgement.technicalScore).toBeLessThanOrEqual(100);
    expect(report.structure.statistics.confirmed).toBeGreaterThan(0);
    expect(report.structure.statistics.invalidated).toBeGreaterThanOrEqual(0);
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("HKEX:981 技术结构研判");
    expect(markdown).not.toContain("## AI 研判");
  });
});

function syntheticBars(count: number): MarketBar[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 60 + index * 0.02 + Math.sin(index / 5) * 2;
    return {
      openTimeMs: Date.UTC(2026, 5, 1) + index * 15 * 60_000,
      open: close - 0.1,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1_000_000 + index * 100,
    };
  });
}
