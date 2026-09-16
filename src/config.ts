import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const fileConfigSchema = z.object({
  phase: z.literal("phase0"),
  alerts: z.object({ currentPineConfigVersion: z.number().int().positive() }),
  signal: z.object({ maxBarAgeMinutes: z.number().int().positive() }),
  worker: z.object({
    pollIntervalMs: z.number().int().positive(),
    leaseSeconds: z.number().int().positive(),
    maxAttempts: z.number().int().positive(),
  }),
  localAlerts: z.object({
    enabled: z.boolean().default(false),
    provider: z.literal("yahoo"),
    pollIntervalMs: z.number().int().min(10_000),
    timeframeMinutes: z.number().int().positive(),
    confirmationLagSeconds: z.number().int().nonnegative().default(10),
    emaLength: z.number().int().min(2),
    pineConfigVersion: z.number().int().positive(),
    alertInstanceId: z.string().min(1).max(128),
    runId: z.string().min(1).max(128),
    desktopNotifications: z.boolean().default(true),
    symbols: z.array(z.object({
      symbol: z.string().regex(/^[^:\s]+:[^:\s]+$/),
      providerSymbol: z.string().min(1),
    })),
  }).optional(),
  analysis: z.object({
    lookbackDays: z.number().int().min(7).max(59).default(30),
    pivotLeft: z.number().int().min(1).max(20).default(5),
    pivotRight: z.number().int().min(1).max(20).default(5),
    levelMaxAgeBars: z.number().int().min(20).default(200),
    touchTolerancePercent: z.number().positive().max(5).default(0.3),
  }).optional(),
  ai: z.object({
    enabled: z.boolean().default(false),
    baseUrl: z.string().url().default("https://api.openai.com/v1"),
    model: z.string().min(1),
    transport: z.enum(["responses", "chat_completions"]).default("responses"),
    timeoutMs: z.number().int().min(1_000).max(300_000).default(30_000),
  }).optional(),
  tradingView: z.object({
    enabled: z.boolean().default(false),
    chartUrl: z.string().url().default("https://www.tradingview.com/chart/"),
    profileDir: z.string().min(1).default("data/tradingview-profile"),
    headless: z.boolean().default(false),
    timeoutMs: z.number().int().min(5_000).max(120_000).default(30_000),
    indicatorTitle: z.string().min(1).default("QuantPilot Structure & Analysis"),
    expectedScriptVersion: z.number().int().positive().default(2),
  }).optional(),
});

const envSchema = z.object({
  QP_WEBHOOK_SECRET: z.string().min(24).optional(),
  QP_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  QP_DB_PATH: z.string().min(1).default("data/monitor.db"),
  QP_CONFIG_PATH: z.string().min(1).default("config/monitor.yaml"),
  QP_AI_API_KEY: z.string().min(1).optional(),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { requireWebhookSecret?: boolean } = {},
) {
  const parsedEnv = envSchema.parse(env);
  if ((options.requireWebhookSecret ?? true) && parsedEnv.QP_WEBHOOK_SECRET === undefined) {
    throw new Error("QP_WEBHOOK_SECRET is required when the HTTP gateway is enabled");
  }
  const configPath = resolve(parsedEnv.QP_CONFIG_PATH);
  const file = fileConfigSchema.parse(parse(readFileSync(configPath, "utf8")));

  return {
    phase: file.phase,
    port: parsedEnv.QP_PORT,
    dbPath: resolve(parsedEnv.QP_DB_PATH),
    webhookSecret: parsedEnv.QP_WEBHOOK_SECRET ?? "",
    currentPineConfigVersion: file.alerts.currentPineConfigVersion,
    maxBarAgeMs: file.signal.maxBarAgeMinutes * 60_000,
    worker: file.worker,
    aiApiKey: parsedEnv.QP_AI_API_KEY,
    localAlerts: file.localAlerts ?? {
      enabled: false,
      provider: "yahoo" as const,
      pollIntervalMs: 60_000,
      timeframeMinutes: 15,
      confirmationLagSeconds: 10,
      emaLength: 20,
      pineConfigVersion: file.alerts.currentPineConfigVersion,
      alertInstanceId: "local-alert-engine-v1",
      runId: "local-alerts",
      desktopNotifications: true,
      symbols: [],
    },
    analysis: file.analysis ?? {
      lookbackDays: 30,
      pivotLeft: 5,
      pivotRight: 5,
      levelMaxAgeBars: 200,
      touchTolerancePercent: 0.3,
    },
    ai: file.ai ?? {
      enabled: false,
      baseUrl: "http://127.0.0.1:8317/v1",
      model: "glm",
      transport: "chat_completions" as const,
      timeoutMs: 30_000,
    },
    tradingView: {
      enabled: file.tradingView?.enabled ?? false,
      chartUrl: file.tradingView?.chartUrl ?? "https://www.tradingview.com/chart/",
      profileDir: resolve(file.tradingView?.profileDir ?? "data/tradingview-profile"),
      headless: file.tradingView?.headless ?? false,
      timeoutMs: file.tradingView?.timeoutMs ?? 30_000,
      indicatorTitle: file.tradingView?.indicatorTitle ?? "QuantPilot Structure & Analysis",
      expectedScriptVersion: file.tradingView?.expectedScriptVersion ?? 2,
    },
  };
}
