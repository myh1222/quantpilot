import { execFileSync } from "node:child_process";
import { sanitizePositionForAi } from "./analysis/run.js";
import {
  aiJudgementSchema,
  ResponsesApiProvider,
  type AiJudgement,
  type AiPositionContext,
} from "./ai/provider.js";
import type { TechnicalAnalysis } from "./analysis/report.js";
import type { PositionAnalysis } from "./portfolio/analysis.js";
import type { TradingViewEnrichment } from "./tradingview/types.js";
import { loadConfig } from "./config.js";
import { migrate, openDatabase } from "./db/database.js";
import { seedWatchlist } from "./portfolio/repository.js";
import { buildUiApp } from "./server/ui.js";
import { TradingViewBrowserSnapshotProvider } from "./tradingview/browser-provider.js";

const config = loadConfig(process.env, { requireWebhookSecret: false });
let keychainApiKey: string | undefined;
try {
  keychainApiKey = execFileSync("security", [
    "find-generic-password", "-w", "-s", "QuantPilot", "-a", "AI",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
} catch {
  // The UI remains usable without AI; the user can still supply a per-request key.
}
const db = openDatabase(config.dbPath);
migrate(db);
seedWatchlist(db, config.localAlerts.symbols);
const serverApiKey = config.aiApiKey ?? keychainApiKey;
const tradingViewProvider = config.tradingView.enabled
  ? new TradingViewBrowserSnapshotProvider(config.tradingView)
  : undefined;
const app = buildUiApp({
  config,
  db,
  serverApiKey,
  tradingViewProvider,
  askFollowUp: serverApiKey === undefined ? undefined : async ({ result, messages }) => {
    const value = result as {
      technicalAnalysis: TechnicalAnalysis;
      ai: { judgement?: unknown };
      positionAnalysis: PositionAnalysis | null;
      tradingView: TradingViewEnrichment;
    };
    const judgement = aiJudgementSchema.parse(value.ai.judgement);
    const provider = new ResponsesApiProvider(
      config.ai.model, serverApiKey, config.ai.baseUrl,
      config.ai.timeoutMs, fetch, config.ai.transport,
    );
    return provider.followUp(
      value.technicalAnalysis,
      sanitizePositionForAi(value.positionAnalysis),
      value.tradingView,
      judgement satisfies AiJudgement,
      messages,
    );
  },
});

app.listen({ host: "127.0.0.1", port: config.port }).then((address) => {
  process.stdout.write(`QuantPilot 已启动：${address}\n`);
  process.stdout.write("按 Ctrl+C 停止。\n");
}).catch((error) => {
  console.error("QuantPilot 前端启动失败：", error);
  process.exitCode = 1;
});

const shutdown = async () => {
  await app.close();
  await tradingViewProvider?.close();
  db.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
