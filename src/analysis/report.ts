import type { MarketBar } from "../local-alerts/rule.js";
import { requireOhlc, technicalSnapshot, type TechnicalSnapshot } from "./indicators.js";
import { analyzeStructure, type StructureSnapshot } from "./structure.js";

export type TechnicalAnalysis = {
  schemaVersion: 1;
  symbol: string;
  provider: string;
  providerSymbol: string;
  timeframe: string;
  generatedAt: string;
  lastBarOpenTime: string;
  barCount: number;
  technical: TechnicalSnapshot;
  structure: StructureSnapshot;
  judgement: {
    bias: "bullish" | "bearish" | "neutral";
    technicalScore: number;
    summary: string;
    evidence: string[];
    invalidationLevels: { bullish: number | null; bearish: number | null };
  };
};

export function buildTechnicalAnalysis(input: {
  symbol: string;
  provider: string;
  providerSymbol: string;
  timeframeMinutes: number;
  bars: MarketBar[];
  now: Date;
  pivotLeft: number;
  pivotRight: number;
  levelMaxAgeBars: number;
  touchTolerancePercent: number;
}): TechnicalAnalysis {
  const bars = requireOhlc(input.bars);
  const technical = technicalSnapshot(bars);
  const structure = analyzeStructure(bars, {
    left: input.pivotLeft,
    right: input.pivotRight,
    maxAgeBars: input.levelMaxAgeBars,
    touchTolerance: input.touchTolerancePercent / 100,
  });
  const evidence: string[] = [];
  let points = 0;
  if (technical.close > technical.ema20) { points += 10; evidence.push("收盘价位于 EMA20 上方"); }
  else { points -= 10; evidence.push("收盘价位于 EMA20 下方"); }
  if (technical.ema20 > technical.ema50) { points += 10; evidence.push("EMA20 高于 EMA50"); }
  else { points -= 10; evidence.push("EMA20 低于 EMA50"); }
  if (technical.ema50 > technical.ema200) { points += 15; evidence.push("EMA50 高于 EMA200"); }
  else { points -= 15; evidence.push("EMA50 低于 EMA200"); }
  if (technical.rsi14 >= 55) { points += 10; evidence.push(`RSI14 偏强（${technical.rsi14.toFixed(1)}）`); }
  else if (technical.rsi14 <= 45) { points -= 10; evidence.push(`RSI14 偏弱（${technical.rsi14.toFixed(1)}）`); }
  else evidence.push(`RSI14 中性（${technical.rsi14.toFixed(1)}）`);
  if (technical.volumeRatio20 !== null && technical.volumeRatio20 >= 1.5) {
    evidence.push(`当前量能为 20 期均量的 ${technical.volumeRatio20.toFixed(2)} 倍`);
  }
  const technicalScore = Math.max(0, Math.min(100, 50 + points));
  const bias = technicalScore >= 65 ? "bullish" : technicalScore <= 35 ? "bearish" : "neutral";
  const support = structure.supports[0]?.price ?? null;
  const resistance = structure.resistances[0]?.price ?? null;
  const summary = bias === "bullish"
    ? `技术结构偏多，关注 ${formatLevel(resistance, "上方压力未识别")}，跌破 ${formatLevel(support, "下方支撑未识别")} 则多头判断弱化。`
    : bias === "bearish"
      ? `技术结构偏空，关注 ${formatLevel(support, "下方支撑未识别")}，突破 ${formatLevel(resistance, "上方压力未识别")} 则空头判断弱化。`
      : `技术结构中性，等待 ${formatLevel(resistance, "上方压力")} 或 ${formatLevel(support, "下方支撑")} 被确认突破。`;

  return {
    schemaVersion: 1,
    symbol: input.symbol,
    provider: input.provider,
    providerSymbol: input.providerSymbol,
    timeframe: `${input.timeframeMinutes}m`,
    generatedAt: input.now.toISOString(),
    lastBarOpenTime: new Date(bars.at(-1)!.openTimeMs).toISOString(),
    barCount: bars.length,
    technical,
    structure,
    judgement: {
      bias,
      technicalScore,
      summary,
      evidence,
      invalidationLevels: { bullish: support, bearish: resistance },
    },
  };
}

export function renderMarkdown(report: TechnicalAnalysis, ai?: unknown): string {
  const level = (value: number | undefined) => value === undefined ? "—" : value.toFixed(4);
  const percent = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
  const lines = [
    `# ${report.symbol} 技术结构研判`,
    "",
    `- 周期：${report.timeframe}`,
    `- 数据源：${report.provider} (${report.providerSymbol})`,
    `- 最新 K 线：${report.lastBarOpenTime}`,
    `- 样本：${report.barCount} 根`,
    `- 技术偏向：${report.judgement.bias}`,
    `- 确定性技术分：${report.judgement.technicalScore}/100`,
    "",
    "## 研判",
    "",
    report.judgement.summary,
    "",
    ...report.judgement.evidence.map((item) => `- ${item}`),
    "",
    "## 指标",
    "",
    `| Close | EMA20 | EMA50 | EMA200 | RSI14 | ATR14 | Volume Ratio |`,
    `| ---: | ---: | ---: | ---: | ---: | ---: | ---: |`,
    `| ${report.technical.close.toFixed(4)} | ${report.technical.ema20.toFixed(4)} | ${report.technical.ema50.toFixed(4)} | ${report.technical.ema200.toFixed(4)} | ${report.technical.rsi14.toFixed(2)} | ${report.technical.atr14.toFixed(4)} | ${report.technical.volumeRatio20?.toFixed(2) ?? "—"} |`,
    "",
    "## 冻结结构位",
    "",
    `- S1: ${level(report.structure.supports[0]?.price)}`,
    `- S2: ${level(report.structure.supports[1]?.price)}`,
    `- R1: ${level(report.structure.resistances[0]?.price)}`,
    `- R2: ${level(report.structure.resistances[1]?.price)}`,
    `- 已确认：${report.structure.statistics.confirmed}`,
    `- 仍有效：${report.structure.statistics.active}`,
    `- 已突破：${report.structure.statistics.broken}`,
    `- 确认时已失效：${report.structure.statistics.invalidated}`,
    `- 支撑突破率：${percent(report.structure.statistics.supportBreakRate)}`,
    `- 压力突破率：${percent(report.structure.statistics.resistanceBreakRate)}`,
  ];
  if (ai !== undefined) lines.push("", "## AI 研判", "", "```json", JSON.stringify(ai, null, 2), "```");
  return `${lines.join("\n")}\n`;
}

function formatLevel(value: number | null, fallback: string): string {
  return value === null ? fallback : value.toFixed(4);
}
