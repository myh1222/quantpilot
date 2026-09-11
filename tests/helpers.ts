import type { AppConfig } from "../src/config.js";

export const testConfig: AppConfig = {
  phase: "phase0",
  port: 8787,
  dbPath: ":memory:",
  webhookSecret: "test-secret-with-at-least-24-characters",
  currentPineConfigVersion: 1,
  maxBarAgeMs: 60 * 60_000,
  worker: { pollIntervalMs: 10, leaseSeconds: 1, maxAttempts: 3 },
};

export function payload(now = Date.now()) {
  return {
    schema_version: 1 as const,
    pine_config_version: 1,
    alert_instance_id: "gate-tv-01-v1",
    run_id: "P0-test",
    symbol: "NASDAQ:AAPL",
    ticker: "AAPL",
    timeframe: "15m",
    event: "PROBE_BAR_CLOSE" as const,
    price: 200,
    bar_open_time_ms: now,
    probe_ema: 199.5,
  };
}
