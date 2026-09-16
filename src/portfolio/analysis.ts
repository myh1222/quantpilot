import type { AccountPositionSummary, CashBalance, Position } from "./repository.js";

export type PositionAnalysis = {
  positionId: number;
  accountName: string;
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
  accountCashBalances: CashBalance[];
  accountPositions: AccountPositionSummary[];
  accountBaseCurrency: string | null;
  accountRiskBudgetPercent: number | null;
  positionWeightPercent: number | null;
  riskToStopPercentOfEquity: number | null;
};

export function analyzePosition(position: Position, currentPrice: number): PositionAnalysis {
  const direction = position.side === "long" ? 1 : -1;
  const costBasis = position.quantity * position.averageCost;
  const marketValue = position.quantity * currentPrice;
  const unrealizedPnl = direction * position.quantity * (currentPrice - position.averageCost);
  const unrealizedPnlPercent = direction * (currentPrice - position.averageCost) / position.averageCost;
  const distanceToStopPercent = position.stopLoss === null
    ? null
    : direction * (currentPrice - position.stopLoss) / currentPrice;
  const distanceToTargetPercent = position.targetPrice === null
    ? null
    : direction * (position.targetPrice - currentPrice) / currentPrice;
  const reward = position.targetPrice === null
    ? null
    : direction * (position.targetPrice - currentPrice);
  const risk = position.stopLoss === null
    ? null
    : direction * (currentPrice - position.stopLoss);
  const riskRewardRatio = reward !== null && risk !== null && reward > 0 && risk > 0
    ? reward / risk
    : null;
  const comparableCurrency = position.accountBaseCurrency === position.currency;
  const positionWeightPercent = comparableCurrency && position.accountReportedEquity !== null
    ? marketValue / position.accountReportedEquity
    : null;
  const riskToStopPercentOfEquity = comparableCurrency && position.accountReportedEquity !== null && risk !== null && risk > 0
    ? risk * position.quantity / position.accountReportedEquity
    : null;

  return {
    positionId: position.id,
    accountName: position.accountName,
    side: position.side,
    quantity: position.quantity,
    averageCost: position.averageCost,
    currentPrice,
    currency: position.currency,
    costBasis,
    marketValue,
    unrealizedPnl,
    unrealizedPnlPercent,
    stopLoss: position.stopLoss,
    targetPrice: position.targetPrice,
    distanceToStopPercent,
    distanceToTargetPercent,
    riskRewardRatio,
    thesis: position.thesis,
    accountEquity: position.accountReportedEquity,
    accountCashBalances: position.accountCashBalances,
    accountPositions: position.accountPositions,
    accountBaseCurrency: position.accountBaseCurrency,
    accountRiskBudgetPercent: position.accountRiskBudgetPercent === null
      ? null
      : position.accountRiskBudgetPercent / 100,
    positionWeightPercent,
    riskToStopPercentOfEquity,
  };
}
