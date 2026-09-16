import type { AppConfig } from "../src/config.js";

export const testConfig: AppConfig = {
  phase: "phase0",
  port: 8787,
  dbPath: ":memory:",
  webhookSecret: "test-secret-with-at-least-24-characters",
  currentPineConfigVersion: 1,
  maxBarAgeMs: 60 * 60_000,
  worker: { pollIntervalMs: 10, leaseSeconds: 1, maxAttempts: 3 },
  localAlerts: {
    enabled: false,
    provider: "yahoo",
    pollIntervalMs: 60_000,
    timeframeMinutes: 15,
    confirmationLagSeconds: 10,
    emaLength: 20,
    pineConfigVersion: 1,
    alertInstanceId: "local-ema-cross-v1",
    runId: "local-alerts",
    desktopNotifications: true,
    symbols: [],
  },
  analysis: {
    lookbackDays: 30,
    pivotLeft: 5,
    pivotRight: 5,
    levelMaxAgeBars: 200,
    touchTolerancePercent: 0.3,
  },
  ai: {
    enabled: false,
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    transport: "chat_completions",
    timeoutMs: 30_000,
  },
  tradingView: {
    enabled: false,
    chartUrl: "https://www.tradingview.com/chart/",
    profileDir: "/tmp/quantpilot-test-tradingview-profile",
    headless: true,
    timeoutMs: 30_000,
    indicatorTitle: "QuantPilot Structure & Analysis",
    expectedScriptVersion: 2,
  },
  aiApiKey: undefined,
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
