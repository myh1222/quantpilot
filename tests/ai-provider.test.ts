import { describe, expect, it } from "vitest";
import { aiFollowUpSchema, aiJudgementSchema, ResponsesApiProvider } from "../src/ai/provider.js";
import { buildTechnicalAnalysis } from "../src/analysis/report.js";
import type { AiPositionContext } from "../src/ai/provider.js";
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
    expect(JSON.parse(String(body.input)).positionContext).toBeNull();
    expect(body.text).toMatchObject({ format: { type: "json_schema", strict: true } });
  });

  it("includes server-calculated position context without secrets", async () => {
    let input;
    const fetchMock: typeof fetch = async (_input, init) => {
      input = JSON.parse(JSON.parse(String(init?.body)).input);
      return new Response(JSON.stringify({
        output: [{ content: [{ type: "output_text", text: JSON.stringify(judgement()) }] }],
      }), { status: 200 });
    };
    const provider = new ResponsesApiProvider("test-model", "secret-key", "https://ai.example/v1", 5_000, fetchMock);
    const position: AiPositionContext = {
      side: "long", quantity: 100,
      averageCost: 60, currentPrice: 66, currency: "HKD", costBasis: 6000,
      marketValue: 6600, unrealizedPnl: 600, unrealizedPnlPercent: 0.1,
      stopLoss: 55, targetPrice: 75, distanceToStopPercent: 0.1515,
      distanceToTargetPercent: 0.1364, riskRewardRatio: 2.2, thesis: "结构企稳",
      accountEquity: null, cashBalances: [{ currency: "HKD", amount: 5000 }],
      accountPositions: [{ symbol: "HKEX:981", side: "long", quantity: 100,
        averageCost: 60, currency: "HKD", stopLoss: 55, targetPrice: 75 }], accountBaseCurrency: "HKD",
      accountRiskBudgetPercent: null, positionWeightPercent: null,
      riskToStopPercentOfEquity: null,
    };

    await provider.analyze(report(), position);
    expect(input.positionContext).toMatchObject({ side: "long", quantity: 100, thesis: "结构企稳" });
    expect(input.positionContext).not.toHaveProperty("accountName");
    expect(input.positionContext).not.toHaveProperty("positionId");
    expect(JSON.stringify(input)).not.toContain("secret-key");
  });

  it("rejects model attempts to supply a final confidence score", () => {
    expect(aiJudgementSchema.safeParse({ ...judgement(), confidence_score: 88 }).success).toBe(false);
  });

  it("accepts structured JSON wrapped in Markdown", async () => {
    const fetchMock: typeof fetch = async () => new Response(JSON.stringify({
      output: [{
        content: [{
          type: "output_text",
          text: `# 技术报告\n\n\`\`\`json\n${JSON.stringify(judgement())}\n\`\`\``,
        }],
      }],
    }), { status: 200 });
    const provider = new ResponsesApiProvider("test-model", "secret-key", "https://ai.example/v1", 5_000, fetchMock);

    await expect(provider.analyze(report())).resolves.toEqual(judgement());
  });

  it("uses Chat Completions JSON mode for the local NewAPI bridge", async () => {
    let request;
    const fetchMock: typeof fetch = async (input, init) => {
      request = { url: String(input), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(judgement()) } }],
      }), { status: 200 });
    };
    const provider = new ResponsesApiProvider(
      "glm", "secret-key", "http://127.0.0.1:8317/v1", 5_000, fetchMock, "chat_completions",
    );

    await expect(provider.analyze(report())).resolves.toEqual(judgement());
    expect(request.url).toContain("/chat/completions");
    expect(request.body.response_format).toEqual({ type: "json_object" });
    expect(request.body.messages[0].role).toBe("system");
    expect(String(request.body.messages[0].content)).not.toContain("secret-key");
  });

  it("rejects incomplete JSON from the local NewAPI bridge", async () => {
    let requests = 0;
    const fetchMock: typeof fetch = async () => {
      requests += 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ bias: "invalid", portfolio_decision: { reason: "x" } }) } }],
      }), { status: 200 });
    };
    const provider = new ResponsesApiProvider(
      "glm", "secret-key", "http://127.0.0.1:8317/v1", 5_000, fetchMock, "chat_completions",
    );

    await expect(provider.analyze(report())).rejects.toThrow("已自动修复重试 1 次");
    expect(requests).toBe(2);
  });

  it("repairs an incompatible Chat Completions response once", async () => {
    let requests = 0;
    const fetchMock: typeof fetch = async () => {
      requests += 1;
      const content = requests === 1 ? { stance: "hold", reason: "结构稳定" } : judgement();
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
    };
    const provider = new ResponsesApiProvider(
      "glm", "secret-key", "http://127.0.0.1:8317/v1", 5_000, fetchMock, "chat_completions",
    );

    await expect(provider.analyze(report())).resolves.toEqual(judgement());
    expect(requests).toBe(2);
  });

  it("uses strict JSON for follow-up conversations on the local bridge", async () => {
    let request;
    const followUp = { answer: "当前结构中性，等待确认。", evidence: ["价格接近 EMA20"], limitations: ["没有新闻信息"] };
    const fetchMock: typeof fetch = async (input, init) => {
      request = { url: String(input), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(followUp) } }],
      }), { status: 200 });
    };
    const provider = new ResponsesApiProvider(
      "glm", "secret-key", "http://127.0.0.1:8317/v1", 5_000, fetchMock, "chat_completions",
    );

    await expect(provider.followUp(report(), null, { status: "disabled" }, judgement(), [
      { role: "user", content: "这个结构怎么理解？" },
    ])).resolves.toEqual(followUp);
    expect(request.url).toContain("/chat/completions");
    expect(request.body.response_format).toEqual({ type: "json_object" });
    expect(request.body.messages.at(-1)).toMatchObject({ role: "user", content: "这个结构怎么理解？" });
    expect(aiFollowUpSchema.safeParse({ ...followUp, confidence: 90 }).success).toBe(false);
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
    portfolio_decision: {
      stance: "no_position" as const,
      risk_level: "unknown" as const,
      position_assessment: "未提供持仓信息。",
      actions: [],
    },
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
