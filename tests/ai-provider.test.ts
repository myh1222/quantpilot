import { describe, expect, it } from "vitest";
import { aiJudgementSchema, ResponsesApiProvider } from "../src/ai/provider.js";
import { buildTechnicalAnalysis } from "../src/analysis/report.js";
import type { MarketBar } from "../src/local-alerts/rule.js";

describe("Responses API analysis provider", () => {
  it("submits processed facts with structured output and parses the judgement", async () => {
    let request: RequestInit | undefined;
    const fetchMock: typeof fetch = async (_input, init) => {
      request = init;
      return new Response(JSON.stringify({
        output: [{ content: [{ type: "output_text", text: JSON.stringify(judgement()) }] }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const provider = new ResponsesApiProvider(
      "test-model", "secret-key", "https://ai.example/v1", 5_000, fetchMock,
    );

    await expect(provider.analyze(report())).resolves.toEqual(judgement());
    expect((request?.headers as Record<string, string>).authorization).toBe("Bearer secret-key");
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body.store).toBe(false);
    expect(body).not.toHaveProperty("api_key");
    expect(JSON.stringify(body)).not.toContain("secret-key");
    expect(String(body.input)).not.toContain("allLevels");
    expect(body.text).toMatchObject({ format: { type: "json_schema", strict: true } });
  });

  it("rejects model attempts to supply a final confidence score", () => {
    expect(aiJudgementSchema.safeParse({ ...judgement(), confidence_score: 88 }).success).toBe(false);
  });
});

function judgement() {
  return {
    bias: "neutral" as const,
    summary: "结构处于区间内。",
    key_observations: ["价格接近 EMA20"],
    bullish_scenario: "确认突破 R1 后观察延续。",
    bearish_scenario: "跌破 S1 后观察弱势延续。",
    invalidation_conditions: ["结构位发生确认突破"],
    risk_factors: ["数据源可能延迟"],
    data_limitations: ["未包含新闻和基本面"],
  };
}

function report() {
  const bars: MarketBar[] = Array.from({ length: 220 }, (_, index) => ({
    openTimeMs: 1_700_000_000_000 + index * 900_000,
    open: 100 + Math.sin(index / 5),
    high: 101 + Math.sin(index / 5),
    low: 99 + Math.sin(index / 5),
    close: 100 + Math.sin(index / 5),
    volume: 1_000,
  }));
  return buildTechnicalAnalysis({
    symbol: "NASDAQ:AAPL",
    provider: "test",
    providerSymbol: "AAPL",
    timeframeMinutes: 15,
    bars,
    now: new Date(),
    pivotLeft: 3,
    pivotRight: 3,
    levelMaxAgeBars: 200,
    touchTolerancePercent: 0.3,
  });
}
