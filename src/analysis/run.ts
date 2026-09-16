import type { AiJudgement, AnalysisAiProvider } from "../ai/provider.js";
import type { AiPositionContext } from "../ai/provider.js";
import type { MarketProvider } from "../local-alerts/provider.js";
import type { MarketBar } from "../local-alerts/rule.js";
import { analyzePosition, type PositionAnalysis } from "../portfolio/analysis.js";
import type { Position } from "../portfolio/repository.js";
import type {
  TradingViewEnrichment,
  TradingViewSnapshotProvider,
} from "../tradingview/types.js";
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
  position?: Position;
  sharePositionWithAi?: boolean;
};

export type AiAnalysisResult =
  | { status: "disabled" }
  | { status: "completed"; provider: string; model: string; promptVersion: string; judgement: AiJudgement }
  | { status: "failed"; provider: string; model: string; promptVersion: string; error: string };

export type AnalysisRunResult = {
  technicalAnalysis: TechnicalAnalysis;
  ai: AiAnalysisResult;
  positionAnalysis: PositionAnalysis | null;
  tradingView: TradingViewEnrichment;
  chartBars: MarketBar[];
};

export async function runAnalysis(
  input: AnalysisRunInput,
  marketProvider: MarketProvider,
  aiProvider?: AnalysisAiProvider,
  tradingViewProvider?: TradingViewSnapshotProvider,
): Promise<AnalysisRunResult> {
  const now = input.now ?? new Date();
  const barsPromise = marketProvider.fetchBars({
    providerSymbol: input.providerSymbol,
    timeframeMinutes: input.timeframeMinutes,
    startMs: now.getTime() - input.lookbackDays * 24 * 60 * 60_000,
    endMs: now.getTime(),
  });
  const bars = await barsPromise;
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
  const positionAnalysis = input.position === undefined
    ? null
    : analyzePosition(input.position, report.technical.close);
  let tradingView: TradingViewEnrichment = { status: "disabled" };
  if (tradingViewProvider !== undefined) {
    try {
      const snapshot = await tradingViewProvider.fetchSnapshot({
        symbol: input.symbol,
        timeframeMinutes: input.timeframeMinutes,
      });
      tradingView = {
        status: "completed",
        snapshot,
        alignment: alignment(snapshot.close, snapshot.barTimeMs,
          report.technical.close, new Date(report.lastBarOpenTime).getTime()),
      };
    } catch (error) {
      tradingView = {
        status: "unavailable",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  let ai: AiAnalysisResult = { status: "disabled" };
  if (aiProvider !== undefined) {
    try {
      ai = {
        status: "completed",
        provider: aiProvider.provider,
        model: aiProvider.model,
        promptVersion: "technical-judgement-v1",
        judgement: await aiProvider.analyze(
          report,
          input.sharePositionWithAi === true ? sanitizePositionForAi(positionAnalysis) : null,
          tradingView,
        ),
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
    positionAnalysis,
    tradingView,
    chartBars: confirmed.slice(-240),
  };
}

export function sanitizePositionForAi(position: PositionAnalysis | null): AiPositionContext | null {
  if (position === null) return null;
  return {
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
    cashBalances: position.accountCashBalances.map(({ currency, amount }) => ({ currency, amount })),
    accountPositions: position.accountPositions.map((item) => ({
      symbol: item.symbol,
      side: item.side,
      quantity: item.quantity,
      averageCost: item.averageCost,
      currency: item.currency,
      stopLoss: item.stopLoss,
      targetPrice: item.targetPrice,
    })),
    accountBaseCurrency: position.accountBaseCurrency,
    accountRiskBudgetPercent: position.accountRiskBudgetPercent,
    positionWeightPercent: position.positionWeightPercent,
    riskToStopPercentOfEquity: position.riskToStopPercentOfEquity,
  };
}

function alignment(
  tradingViewClose: number,
  tradingViewBarTimeMs: number,
  localClose: number,
  localBarTimeMs: number,
): Extract<TradingViewEnrichment, { status: "completed" }>["alignment"] {
  const closeDifferencePercent = localClose === 0
    ? 0
    : Math.abs(tradingViewClose - localClose) / Math.abs(localClose);
  const barTimeDifferenceMinutes = Math.abs(tradingViewBarTimeMs - localBarTimeMs) / 60_000;
  return {
    closeDifferencePercent,
    barTimeDifferenceMinutes,
    quality: closeDifferencePercent <= 0.005 && barTimeDifferenceMinutes <= 60 ? "matched" : "diverged",
  };
}
