import { describe, expect, it } from "vitest";
import { buildUiApp } from "../src/server/ui.js";
import type { MarketProvider } from "../src/local-alerts/provider.js";
import { testConfig } from "./helpers.js";

const marketProvider: MarketProvider = {
  name: "test-market",
  async fetchBars(request) {
    return Array.from({ length: 240 }, (_, index) => {
      const close = 60 + Math.sin(index / 8) * 2 + index * 0.01;
      return {
        openTimeMs: request.endMs - (240 - index) * request.timeframeMinutes * 60_000,
        open: close - 0.1,
        high: close + 0.4,
        low: close - 0.4,
        close,
        volume: 1_000_000 + index,
      };
    });
  },
};

describe("local analysis UI", () => {
  it("serves safe configuration without an API key", async () => {
    const app = buildUiApp({ config: { ...testConfig, aiApiKey: "must-not-leak" }, marketProvider });
    const response = await app.inject({ method: "GET", url: "/api/config" });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("must-not-leak");
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    await app.close();
  });

  it("returns chart data and deterministic analysis without AI", async () => {
    const app = buildUiApp({ config: testConfig, marketProvider });
    const response = await app.inject({ method: "POST", url: "/api/analyze", payload: requestBody() });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.technicalAnalysis.symbol).toBe("HKEX:981");
    expect(body.technicalAnalysis.provider).toBe("test-market");
    expect(body.chartBars).toHaveLength(239);
    expect(body.ai).toEqual({ status: "disabled" });
    await app.close();
  });

  it("requires a key only when AI is enabled", async () => {
    const app = buildUiApp({ config: testConfig, marketProvider });
    const response = await app.inject({
      method: "POST",
      url: "/api/analyze",
      payload: { ...requestBody(), useAi: true },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("API Key");
    await app.close();
  });
});

function requestBody() {
  return {
    symbol: "HKEX:981",
    providerSymbol: "0981.HK",
    timeframeMinutes: 15,
    lookbackDays: 30,
    useAi: false,
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
  };
}
