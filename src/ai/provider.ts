import { z } from "zod";
import type { TechnicalAnalysis } from "../analysis/report.js";
import type { TradingViewEnrichment } from "../tradingview/types.js";

export type AiTransport = "responses" | "chat_completions";

export type AiPositionContext = {
  side: "long" | "short";
  quantity: number;
  averageCost: number;
  currentPrice: number;
  currency: string;
  costBasis: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  stopLoss: number | null;
  targetPrice: number | null;
  distanceToStopPercent: number | null;
  distanceToTargetPercent: number | null;
  riskRewardRatio: number | null;
  thesis: string | null;
  accountEquity: number | null;
  cashBalances: Array<{ currency: string; amount: number }>;
  accountPositions: Array<{
    symbol: string; side: "long" | "short"; quantity: number; averageCost: number;
    currency: string; stopLoss: number | null; targetPrice: number | null;
  }>;
  accountBaseCurrency: string | null;
  accountRiskBudgetPercent: number | null;
  positionWeightPercent: number | null;
  riskToStopPercentOfEquity: number | null;
};

const decisionActionSchema = z.object({
  priority: z.number().int().min(1).max(5),
  action: z.string().min(1).max(300),
  trigger: z.string().min(1).max(300),
  rationale: z.string().min(1).max(500),
}).strict();

export const aiJudgementSchema = z.object({
  bias: z.enum(["bullish", "bearish", "neutral"]),
  summary: z.string().min(1).max(1200),
  key_observations: z.array(z.string().min(1).max(300)).max(8),
  bullish_scenario: z.string().min(1).max(600),
  bearish_scenario: z.string().min(1).max(600),
  invalidation_conditions: z.array(z.string().min(1).max(300)).max(6),
  risk_factors: z.array(z.string().min(1).max(300)).max(8),
  data_limitations: z.array(z.string().min(1).max(300)).max(8),
  portfolio_decision: z.object({
    stance: z.enum(["no_position", "hold", "watch", "reduce_risk", "add_on_confirmation", "exit_on_invalidation"]),
    risk_level: z.enum(["low", "medium", "high", "unknown"]),
    position_assessment: z.string().min(1).max(800),
    actions: z.array(decisionActionSchema).max(5),
  }).strict(),
}).strict();

export type AiJudgement = z.infer<typeof aiJudgementSchema>;

export interface AnalysisAiProvider {
  readonly provider: string;
  readonly model: string;
  analyze(
    report: TechnicalAnalysis,
    position?: AiPositionContext | null,
    tradingView?: TradingViewEnrichment,
  ): Promise<AiJudgement>;
}

export const aiFollowUpSchema = z.object({
  answer: z.string().min(1).max(4000),
  evidence: z.array(z.string().min(1).max(500)).max(8),
  limitations: z.array(z.string().min(1).max(300)).max(5),
}).strict();

export type AiFollowUp = z.infer<typeof aiFollowUpSchema>;

export class ResponsesApiProvider implements AnalysisAiProvider {
  readonly provider = "responses-api";

  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.openai.com/v1",
    private readonly timeoutMs = 30_000,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly transport: AiTransport = "responses",
  ) {
    if (apiKey.length === 0) throw new Error("AI API key is empty");
  }

  async analyze(
    report: TechnicalAnalysis,
    position?: AiPositionContext | null,
    tradingView: TradingViewEnrichment = { status: "disabled" },
  ): Promise<AiJudgement> {
    if (this.transport === "chat_completions") {
      return this.analyzeWithChatCompletions(report, position ?? null, tradingView);
    }

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
          "如提供仓位，只能给出带触发条件和失效条件的仓位管理建议；不得代替用户做交易决定，不得给出未经账户净值与风险预算支持的精确加减仓数量。",
          "如未提供仓位，portfolio_decision.stance 必须为 no_position。",
          "明确区分观察事实、条件场景和数据局限，使用中文。",
        ].join("\n"),
        input: JSON.stringify(toAiInput(report, position ?? null, tradingView)),
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
    return parseJudgementText(outputText);
  }

  private async analyzeWithChatCompletions(
    report: TechnicalAnalysis,
    position: AiPositionContext | null,
    tradingView: TradingViewEnrichment,
  ): Promise<AiJudgement> {
    const messages = [
      { role: "system", content: chatSystemPrompt() },
      { role: "user", content: JSON.stringify(toAiInput(report, position, tradingView)) },
    ];
    const firstContent = await this.requestChatCompletion(messages);
    const first = tryParseJudgementText(firstContent);
    if (first !== undefined) return first;

    const repairMessages = [
      ...messages,
      { role: "assistant", content: firstContent },
      {
        role: "user",
        content: "上一个 JSON 不符合约定。请根据系统消息中的 JSON Schema 补齐并修正字段；只输出修正后的 JSON object。",
      },
    ];
    const repairedContent = await this.requestChatCompletion(repairMessages);
    return parseJudgementText(repairedContent, true);
  }

  private async requestChatCompletion(messages: Array<{ role: string; content: string }>): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        messages,
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`AI request failed with HTTP ${response.status}: ${detail}`);
    }
    const payload = await response.json() as Record<string, unknown>;
    const choices = payload.choices;
    if (!Array.isArray(choices) || choices[0] === null || typeof choices[0] !== "object") {
      throw new Error("AI response has no completion choice");
    }
    const message = (choices[0] as Record<string, unknown>).message;
    const content = message === null || typeof message !== "object"
      ? undefined
      : (message as Record<string, unknown>).content;
    if (typeof content !== "string") throw new Error("AI response has no message content");
    return content;
  }

  async followUp(
    report: TechnicalAnalysis,
    position: AiPositionContext | null,
    tradingView: TradingViewEnrichment,
    judgement: AiJudgement,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<AiFollowUp> {
    const conversation = [
      {
        role: "system",
        content: [
          "你是证券技术分析助手。基于已提供的结构化技术上下文和先前 AI 研判继续回答用户问题。",
          "必须只输出 JSON object：{\"answer\":string,\"evidence\":string[],\"limitations\":string[]}。",
          "不得捏造新闻、公告、基本面、实时行情或交易所状态；不得输出 confidence 分数或直接下单建议。",
          "如答案未被上下文支持，明确说明数据局限；使用中文。",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(followUpContext(report, position, tradingView)),
      },
      { role: "assistant", content: judgement.summary },
      ...messages.map((message) => ({ role: message.role, content: message.content })),
    ];
    const content = await this.requestChatCompletion(conversation);
    const parsed = aiFollowUpSchema.safeParse(parseModelJson(content));
    if (parsed.success) return parsed.data;

    const repaired = await this.requestChatCompletion([
      ...conversation,
      { role: "assistant", content },
      { role: "user", content: "上一个 JSON 不符合约定。只输出修正后的 JSON object。" },
    ]);
    const result = aiFollowUpSchema.safeParse(parseModelJson(repaired));
    if (result.success) return result.data;
    throw new Error("AI 返回格式不符合 QuantPilot 追问协议（已自动修复重试 1 次）");
  }
}

function followUpContext(
  report: TechnicalAnalysis,
  position: AiPositionContext | null,
  tradingView: TradingViewEnrichment,
) {
  const context = toAiInput(report, position, tradingView);
  return {
    symbol: context.symbol,
    timeframe: context.timeframe,
    lastBarOpenTime: context.lastBarOpenTime,
    technical: context.technical,
    structure: context.structure,
    deterministicJudgement: context.deterministicJudgement,
    positionContext: context.positionContext,
    tradingViewContext: context.tradingViewContext,
  };
}

function toAiInput(
  report: TechnicalAnalysis,
    position: AiPositionContext | null,
  tradingView: TradingViewEnrichment,
) {
  return {
    symbol: report.symbol,
    providerSymbol: report.providerSymbol,
    timeframe: report.timeframe,
    lastBarOpenTime: report.lastBarOpenTime,
    technical: {
      close: report.technical.close,
      ema20: report.technical.ema20,
      ema50: report.technical.ema50,
      ema200: report.technical.ema200,
      rsi14: report.technical.rsi14,
      atr14: report.technical.atr14,
      volumeRatio20: report.technical.volumeRatio20,
    },
    structure: {
      supports: report.structure.supports,
      resistances: report.structure.resistances,
      statistics: report.structure.statistics,
    },
    deterministicJudgement: {
      bias: report.judgement.bias,
      technicalScore: report.judgement.technicalScore,
      evidence: report.judgement.evidence,
      invalidationLevels: report.judgement.invalidationLevels,
    },
    positionContext: position === null ? null : {
      side: position.side,
      quantity: position.quantity,
      averageCost: position.averageCost,
      currentPrice: position.currentPrice,
      currency: position.currency,
      costBasis: position.costBasis,
      marketValue: position.marketValue,
      unrealizedPnl: position.unrealizedPnl,
      unrealizedPnlPercent: position.unrealizedPnlPercent,
      stopLoss: position.stopLoss,
      targetPrice: position.targetPrice,
      distanceToStopPercent: position.distanceToStopPercent,
      distanceToTargetPercent: position.distanceToTargetPercent,
      riskRewardRatio: position.riskRewardRatio,
      thesis: position.thesis,
      accountEquity: position.accountEquity,
      cashBalances: position.cashBalances,
      accountPositions: position.accountPositions,
      accountBaseCurrency: position.accountBaseCurrency,
      accountRiskBudgetPercent: position.accountRiskBudgetPercent,
      positionWeightPercent: position.positionWeightPercent,
      riskToStopPercentOfEquity: position.riskToStopPercentOfEquity,
    },
    tradingViewContext: tradingView.status === "completed"
      ? {
        snapshot: {
          close: tradingView.snapshot.close,
          ema20: tradingView.snapshot.ema20,
          ema50: tradingView.snapshot.ema50,
          ema200: tradingView.snapshot.ema200,
          rsi14: tradingView.snapshot.rsi14,
          atr14: tradingView.snapshot.atr14,
          dailyTrend: tradingView.snapshot.dailyTrend,
          technicalScore: tradingView.snapshot.technicalScore,
          support1: tradingView.snapshot.support1,
          resistance1: tradingView.snapshot.resistance1,
          scriptVersion: tradingView.snapshot.scriptVersion,
        },
        alignment: tradingView.alignment,
      }
      : { status: tradingView.status },
  };
}

function chatSystemPrompt(): string {
  return [
    "你是证券技术分析助手。必须只输出一个 JSON object，不得输出 Markdown、代码块、解释或额外字段。",
    "输出 JSON 必须精确匹配以下 TypeScript 结构和枚举：",
    "bias: 'bullish' | 'bearish' | 'neutral'",
    "summary, bullish_scenario, bearish_scenario: string",
    "key_observations, invalidation_conditions, risk_factors, data_limitations: string[]",
    "portfolio_decision: { stance: 'no_position'|'hold'|'watch'|'reduce_risk'|'add_on_confirmation'|'exit_on_invalidation', risk_level: 'low'|'medium'|'high'|'unknown', position_assessment: string, actions: Array<{priority:number,action:string,trigger:string,rationale:string}> }",
    "不得捏造新闻、公告、基本面、实时行情或交易所状态；不得输出 confidence 分数或直接下单建议。",
    "如提供仓位，只能给出带触发条件和失效条件的仓位管理建议；不得代替用户做交易决定，不得给出未经账户净值与风险预算支持的精确加减仓数量。",
    "如未提供仓位，portfolio_decision.stance 必须为 no_position，actions 为空数组。",
    "明确区分观察事实、条件场景和数据局限，使用中文。",
    `JSON Schema 供格式参考：${JSON.stringify(judgementJsonSchema)}`,
  ].join("\n");
}

const judgementJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "bias", "summary", "key_observations", "bullish_scenario", "bearish_scenario",
    "invalidation_conditions", "risk_factors", "data_limitations",
    "portfolio_decision",
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
    portfolio_decision: {
      type: "object",
      additionalProperties: false,
      required: ["stance", "risk_level", "position_assessment", "actions"],
      properties: {
        stance: {
          type: "string",
          enum: ["no_position", "hold", "watch", "reduce_risk", "add_on_confirmation", "exit_on_invalidation"],
        },
        risk_level: { type: "string", enum: ["low", "medium", "high", "unknown"] },
        position_assessment: { type: "string", maxLength: 800 },
        actions: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["priority", "action", "trigger", "rationale"],
            properties: {
              priority: { type: "integer", minimum: 1, maximum: 5 },
              action: { type: "string", maxLength: 300 },
              trigger: { type: "string", maxLength: 300 },
              rationale: { type: "string", maxLength: 500 },
            },
          },
        },
      },
    },
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

function parseModelJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Some Responses-compatible bridges wrap structured JSON in Markdown.
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1] !== undefined) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // Fall through to embedded-object extraction.
    }
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // Continue to the explicit error below.
    }
  }

  throw new Error("AI response is not valid JSON");
}

function tryParseJudgementText(text: string): AiJudgement | undefined {
  try {
    const parsed = aiJudgementSchema.safeParse(parseModelJson(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function parseJudgementText(text: string, repaired = false): AiJudgement {
  const parsed = tryParseJudgementText(text);
  if (parsed !== undefined) return parsed;
  throw new Error(repaired
    ? "AI 返回格式不符合 QuantPilot 研判协议（已自动修复重试 1 次）"
    : "AI 返回格式不符合 QuantPilot 研判协议");
}
