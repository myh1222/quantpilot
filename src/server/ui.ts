import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import { z } from "zod";
import { ResponsesApiProvider } from "../ai/provider.js";
import { runAnalysis } from "../analysis/run.js";
import type { AppConfig } from "../config.js";
import type { MarketProvider } from "../local-alerts/provider.js";
import { YahooChartProvider } from "../local-alerts/yahoo.js";

const analysisRequestSchema = z.object({
  symbol: z.string().trim().min(1).max(64),
  providerSymbol: z.string().trim().min(1).max(64),
  timeframeMinutes: z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(60)]),
  lookbackDays: z.number().int().min(7).max(59),
  useAi: z.boolean(),
  apiKey: z.string().max(512).optional(),
  model: z.string().trim().min(1).max(128),
  baseUrl: z.string().url().max(512),
}).strict();

type UiDependencies = {
  config: AppConfig;
  marketProvider?: MarketProvider;
  publicDirectory?: string;
};

export function buildUiApp({
  config,
  marketProvider = new YahooChartProvider(),
  publicDirectory = resolve("public"),
}: UiDependencies) {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'",
    );
    return payload;
  });

  app.get("/", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(readAsset(publicDirectory, "index.html")));
  app.get("/app.js", async (_request, reply) =>
    reply.type("application/javascript; charset=utf-8").send(readAsset(publicDirectory, "app.js")));
  app.get("/styles.css", async (_request, reply) =>
    reply.type("text/css; charset=utf-8").send(readAsset(publicDirectory, "styles.css")));
  app.get("/favicon.ico", async (_request, reply) => reply.code(204).send());

  app.get("/api/config", async () => ({
    symbols: config.localAlerts.symbols,
    defaults: {
      timeframeMinutes: config.localAlerts.timeframeMinutes,
      lookbackDays: config.analysis.lookbackDays,
      model: config.ai.model,
      baseUrl: config.ai.baseUrl,
    },
  }));

  app.post("/api/analyze", async (request, reply) => {
    const parsed = analysisRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "请求参数不正确", details: parsed.error.issues });
    }
    const input = parsed.data;
    if (input.useAi && !input.apiKey?.trim()) {
      return reply.code(400).send({ error: "启用 AI 时必须填写 API Key" });
    }

    const aiProvider = input.useAi
      ? new ResponsesApiProvider(input.model, input.apiKey!.trim(), input.baseUrl, config.ai.timeoutMs)
      : undefined;
    try {
      const result = await runAnalysis({
        symbol: input.symbol,
        providerSymbol: input.providerSymbol,
        timeframeMinutes: input.timeframeMinutes,
        lookbackDays: input.lookbackDays,
        confirmationLagSeconds: config.localAlerts.confirmationLagSeconds,
        pivotLeft: config.analysis.pivotLeft,
        pivotRight: config.analysis.pivotRight,
        levelMaxAgeBars: config.analysis.levelMaxAgeBars,
        touchTolerancePercent: config.analysis.touchTolerancePercent,
      }, marketProvider, aiProvider);
      return reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ error: message }, "analysis failed");
      return reply.code(502).send({ error: friendlyError(message) });
    }
  });

  return app;
}

function readAsset(directory: string, filename: string): string {
  return readFileSync(resolve(directory, filename), "utf8");
}

function friendlyError(message: string): string {
  if (message.includes("Yahoo")) return `行情数据获取失败：${message}`;
  if (message.includes("at least")) return `有效 K 线数量不足：${message}`;
  return `分析失败：${message}`;
}
