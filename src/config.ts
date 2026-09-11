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
});

const envSchema = z.object({
  QP_WEBHOOK_SECRET: z.string().min(24),
  QP_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  QP_DB_PATH: z.string().min(1).default("data/monitor.db"),
  QP_CONFIG_PATH: z.string().min(1).default("config/monitor.yaml"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsedEnv = envSchema.parse(env);
  const configPath = resolve(parsedEnv.QP_CONFIG_PATH);
  const file = fileConfigSchema.parse(parse(readFileSync(configPath, "utf8")));

  return {
    phase: file.phase,
    port: parsedEnv.QP_PORT,
    dbPath: resolve(parsedEnv.QP_DB_PATH),
    webhookSecret: parsedEnv.QP_WEBHOOK_SECRET,
    currentPineConfigVersion: file.alerts.currentPineConfigVersion,
    maxBarAgeMs: file.signal.maxBarAgeMinutes * 60_000,
    worker: file.worker,
  };
}
