import { z } from "zod";
import type { TechnicalAnalysis } from "../analysis/report.js";

export const aiJudgementSchema = z.object({
  bias: z.enum(["bullish", "bearish", "neutral"]),
  summary: z.string().min(1).max(1200),
  key_observations: z.array(z.string().min(1).max(300)).max(8),
  bullish_scenario: z.string().min(1).max(600),
  bearish_scenario: z.string().min(1).max(600),
  invalidation_conditions: z.array(z.string().min(1).max(300)).max(6),
  risk_factors: z.array(z.string().min(1).max(300)).max(8),
  data_limitations: z.array(z.string().min(1).max(300)).max(8),
}).strict();

export type AiJudgement = z.infer<typeof aiJudgementSchema>;

export interface AnalysisAiProvider {
  readonly provider: string;
  readonly model: string;
  analyze(report: TechnicalAnalysis): Promise<AiJudgement>;
}

export class ResponsesApiProvider implements AnalysisAiProvider {
  readonly provider = "responses-api";

  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.openai.com/v1",
    private readonly timeoutMs = 30_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (apiKey.length === 0) throw new Error("AI API key is empty");
  }

  async analyze(report: TechnicalAnalysis): Promise<AiJudgement> {
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        store: false,
        instructions: [
          "你是证券技术分析助手，只能基于输入的结构化技术数据进行研判。",
          "不得捏造新闻、公告、基本面、实时行情或交易所状态。",
          "AI 不得输出最终 confidence 分数或直接下单建议。",
          "明确区分观察事实、条件场景和数据局限，使用中文。",
        ].join("\n"),
        input: JSON.stringify(toAiInput(report)),
        text: {
          format: {
            type: "json_schema",
            name: "quantpilot_technical_judgement",
            strict: true,
            schema: judgementJsonSchema,
          },
        },
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`AI request failed with HTTP ${response.status}: ${detail}`);
    }
    const payload = await response.json() as Record<string, unknown>;
    const outputText = extractOutputText(payload);
    if (outputText === undefined) throw new Error("AI response has no output text");
    return aiJudgementSchema.parse(JSON.parse(outputText));
  }
}

function toAiInput(report: TechnicalAnalysis) {
  return {
    schemaVersion: report.schemaVersion,
    symbol: report.symbol,
    provider: report.provider,
    providerSymbol: report.providerSymbol,
    timeframe: report.timeframe,
    generatedAt: report.generatedAt,
    lastBarOpenTime: report.lastBarOpenTime,
    barCount: report.barCount,
    technical: report.technical,
    structure: {
      supports: report.structure.supports,
      resistances: report.structure.resistances,
      statistics: report.structure.statistics,
    },
    deterministicJudgement: report.judgement,
  };
}

const judgementJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "bias", "summary", "key_observations", "bullish_scenario", "bearish_scenario",
    "invalidation_conditions", "risk_factors", "data_limitations",
  ],
  properties: {
    bias: { type: "string", enum: ["bullish", "bearish", "neutral"] },
    summary: { type: "string", maxLength: 1200 },
    key_observations: { type: "array", maxItems: 8, items: { type: "string", maxLength: 300 } },
    bullish_scenario: { type: "string", maxLength: 600 },
    bearish_scenario: { type: "string", maxLength: 600 },
    invalidation_conditions: { type: "array", maxItems: 6, items: { type: "string", maxLength: 300 } },
    risk_factors: { type: "array", maxItems: 8, items: { type: "string", maxLength: 300 } },
    data_limitations: { type: "array", maxItems: 8, items: { type: "string", maxLength: 300 } },
  },
} as const;

function extractOutputText(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return undefined;
  for (const item of payload.output) {
    if (item === null || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part !== null && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
        return (part as Record<string, unknown>).text as string;
      }
    }
  }
  return undefined;
}
