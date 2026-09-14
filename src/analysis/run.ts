import type { AiJudgement, AnalysisAiProvider } from "../ai/provider.js";
import type { MarketProvider } from "../local-alerts/provider.js";
import type { MarketBar } from "../local-alerts/rule.js";
import { buildTechnicalAnalysis, type TechnicalAnalysis } from "./report.js";

export type AnalysisRunInput = {
  symbol: string;
  providerSymbol: string;
  timeframeMinutes: number;
  lookbackDays: number;
  confirmationLagSeconds: number;
  pivotLeft: number;
  pivotRight: number;
  levelMaxAgeBars: number;
  touchTolerancePercent: number;
  now?: Date;
};

export type AiAnalysisResult =
  | { status: "disabled" }
  | { status: "completed"; provider: string; model: string; promptVersion: string; judgement: AiJudgement }
  | { status: "failed"; provider: string; model: string; promptVersion: string; error: string };

export type AnalysisRunResult = {
  technicalAnalysis: TechnicalAnalysis;
  ai: AiAnalysisResult;
  chartBars: MarketBar[];
};

export async function runAnalysis(
  input: AnalysisRunInput,
  marketProvider: MarketProvider,
  aiProvider?: AnalysisAiProvider,
): Promise<AnalysisRunResult> {
  const now = input.now ?? new Date();
  const bars = await marketProvider.fetchBars({
    providerSymbol: input.providerSymbol,
    timeframeMinutes: input.timeframeMinutes,
    startMs: now.getTime() - input.lookbackDays * 24 * 60 * 60_000,
    endMs: now.getTime(),
  });
  const cutoff = now.getTime() - input.confirmationLagSeconds * 1000;
  const confirmed = bars.filter((bar) =>
    bar.openTimeMs + input.timeframeMinutes * 60_000 <= cutoff);
  const report = buildTechnicalAnalysis({
    symbol: input.symbol,
    provider: marketProvider.name,
    providerSymbol: input.providerSymbol,
    timeframeMinutes: input.timeframeMinutes,
    bars: confirmed,
    now,
    pivotLeft: input.pivotLeft,
    pivotRight: input.pivotRight,
    levelMaxAgeBars: input.levelMaxAgeBars,
    touchTolerancePercent: input.touchTolerancePercent,
  });

  let ai: AiAnalysisResult = { status: "disabled" };
  if (aiProvider !== undefined) {
    try {
      ai = {
        status: "completed",
        provider: aiProvider.provider,
        model: aiProvider.model,
        promptVersion: "technical-judgement-v1",
        judgement: await aiProvider.analyze(report),
      };
    } catch (error) {
      ai = {
        status: "failed",
        provider: aiProvider.provider,
        model: aiProvider.model,
        promptVersion: "technical-judgement-v1",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    technicalAnalysis: report,
    ai,
    chartBars: confirmed.slice(-240),
  };
}
