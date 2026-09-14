import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ResponsesApiProvider } from "./ai/provider.js";
import { renderMarkdown } from "./analysis/report.js";
import { runAnalysis } from "./analysis/run.js";
import { loadConfig } from "./config.js";
import { YahooChartProvider } from "./local-alerts/yahoo.js";

const config = loadConfig(process.env, { requireWebhookSecret: false });
const provider = new YahooChartProvider();
const now = new Date();
const resultDirectory = resolve("results");
mkdirSync(resultDirectory, { recursive: true });

if (config.localAlerts.symbols.length === 0) throw new Error("no symbols configured for analysis");
if (config.ai.enabled && config.aiApiKey === undefined) {
  throw new Error("ai.enabled is true but QP_AI_API_KEY is not set");
}

const aiProvider = config.ai.enabled
  ? new ResponsesApiProvider(config.ai.model, config.aiApiKey!, config.ai.baseUrl, config.ai.timeoutMs)
  : undefined;
const summaries: Array<Record<string, unknown>> = [];

for (const item of config.localAlerts.symbols) {
  const artifact = await runAnalysis({
    symbol: item.symbol,
    providerSymbol: item.providerSymbol,
    timeframeMinutes: config.localAlerts.timeframeMinutes,
    lookbackDays: config.analysis.lookbackDays,
    confirmationLagSeconds: config.localAlerts.confirmationLagSeconds,
    now,
    pivotLeft: config.analysis.pivotLeft,
    pivotRight: config.analysis.pivotRight,
    levelMaxAgeBars: config.analysis.levelMaxAgeBars,
    touchTolerancePercent: config.analysis.touchTolerancePercent,
  }, provider, aiProvider);
  const report = artifact.technicalAnalysis;
  const aiResult = artifact.ai;
  const stem = `${safeName(item.symbol)}-${report.timeframe}`;
  writeFileSync(resolve(resultDirectory, `${stem}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
  writeFileSync(
    resolve(resultDirectory, `${stem}.md`),
    renderMarkdown(report, aiResult.status === "disabled" ? undefined : aiResult),
  );
  summaries.push({
    symbol: item.symbol,
    bias: report.judgement.bias,
    technicalScore: report.judgement.technicalScore,
    support1: report.structure.supports[0]?.price ?? null,
    resistance1: report.structure.resistances[0]?.price ?? null,
    ai: aiResult.status,
    files: [`results/${stem}.json`, `results/${stem}.md`],
  });
}

process.stdout.write(`${JSON.stringify({ analyses: summaries }, null, 2)}\n`);

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
