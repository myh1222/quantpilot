import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("configuration", () => {
  it("loads local alert settings with defaults", () => {
    const directory = mkdtempSync(join(tmpdir(), "quantpilot-config-"));
    const configPath = join(directory, "monitor.yaml");
    writeFileSync(configPath, `
phase: phase0
alerts:
  currentPineConfigVersion: 2
signal:
  maxBarAgeMinutes: 60
worker:
  pollIntervalMs: 250
  leaseSeconds: 30
  maxAttempts: 5
localAlerts:
  enabled: false
  provider: yahoo
  pollIntervalMs: 60000
  timeframeMinutes: 15
  emaLength: 20
  pineConfigVersion: 2
  alertInstanceId: local-v1
  runId: local-run
  symbols:
    - symbol: HKEX:981
      providerSymbol: 0981.HK
`);

    const config = loadConfig({
      QP_WEBHOOK_SECRET: "test-secret-with-at-least-24-characters",
      QP_CONFIG_PATH: configPath,
    });

    expect(config.localAlerts).toMatchObject({
      confirmationLagSeconds: 10,
      desktopNotifications: true,
      symbols: [{ symbol: "HKEX:981", providerSymbol: "0981.HK" }],
    });
  });

  it("allows offline analysis config without a webhook secret", () => {
    const directory = mkdtempSync(join(tmpdir(), "quantpilot-analysis-config-"));
    const configPath = join(directory, "monitor.yaml");
    writeFileSync(configPath, `
phase: phase0
alerts: { currentPineConfigVersion: 1 }
signal: { maxBarAgeMinutes: 60 }
worker: { pollIntervalMs: 250, leaseSeconds: 30, maxAttempts: 5 }
`);
    expect(loadConfig(
      { QP_CONFIG_PATH: configPath },
      { requireWebhookSecret: false },
    ).webhookSecret).toBe("");
    expect(() => loadConfig({ QP_CONFIG_PATH: configPath })).toThrow(/QP_WEBHOOK_SECRET/);
  });
});
