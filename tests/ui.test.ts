import { describe, expect, it } from "vitest";
import { buildUiApp } from "../src/server/ui.js";
import { migrate, openDatabase } from "../src/db/database.js";
import type { MarketProvider } from "../src/local-alerts/provider.js";
import { saveAccount, savePosition, saveWatchlistItem } from "../src/portfolio/repository.js";
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
    const db = openDatabase(":memory:"); migrate(db);
    const app = buildUiApp({ config: { ...testConfig, aiApiKey: "must-not-leak" }, marketProvider, db });
    const response = await app.inject({ method: "GET", url: "/api/config" });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("must-not-leak");
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    await app.close();
    db.close();
  });

  it("uses a configured server key without exposing it", async () => {
    const db = openDatabase(":memory:"); migrate(db);
    let settings: Record<string, unknown> | undefined;
    const app = buildUiApp({
      config: testConfig, marketProvider, db, serverApiKey: "server-secret",
      createAiProvider: (input) => {
        settings = input;
        return { provider: "test-ai", model: input.model, analyze: async () => judgement() };
      },
    });
    const config = await app.inject({ method: "GET", url: "/api/config" });
    expect(config.json().defaults.hasServerApiKey).toBe(true);
    expect(config.body).not.toContain("server-secret");

    const response = await app.inject({
      method: "POST", url: "/api/analyze",
      payload: { ...requestBody(), useAi: true, apiKey: undefined },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("server-secret");
    expect(settings).toMatchObject({ apiKey: "server-secret", baseUrl: testConfig.ai.baseUrl, transport: "chat_completions" });
    await app.close(); db.close();
  });

  it("binds a configured server key to server-owned AI destination settings", async () => {
    const db = openDatabase(":memory:"); migrate(db);
    let settings: Record<string, unknown> | undefined;
    const app = buildUiApp({
      config: testConfig, marketProvider, db, serverApiKey: "server-secret",
      createAiProvider: (input) => {
        settings = input;
        return { provider: "test-ai", model: input.model, analyze: async () => judgement() };
      },
    });
    const response = await app.inject({
      method: "POST", url: "/api/analyze",
      payload: {
        ...requestBody(), useAi: true, apiKey: undefined,
        baseUrl: "https://attacker.example/v1", model: "attacker-model", transport: "chat_completions",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(settings).toMatchObject({
      apiKey: "server-secret", baseUrl: testConfig.ai.baseUrl,
      model: testConfig.ai.model, transport: testConfig.ai.transport,
    });
    await app.close(); db.close();
  });

  it("keeps follow-up context server-side behind an opaque analysis session id", async () => {
    const db = openDatabase(":memory:"); migrate(db);
    let receivedSymbol = "";
    const app = buildUiApp({
      config: testConfig, marketProvider, db, serverApiKey: "server-secret",
      createAiProvider: (input) => ({ provider: "test-ai", model: input.model, analyze: async () => judgement() }),
      askFollowUp: async ({ result }) => {
        receivedSymbol = (result as { technicalAnalysis: { symbol: string } }).technicalAnalysis.symbol;
        return { answer: "等待确认", evidence: [], limitations: [] };
      },
    });
    const analysis = await app.inject({
      method: "POST", url: "/api/analyze", payload: { ...requestBody(), useAi: true },
    });
    expect(analysis.statusCode).toBe(200);
    const analysisSessionId = analysis.json().analysisSessionId;
    expect(analysisSessionId).toMatch(/^[0-9a-f-]{36}$/);

    const followUp = await app.inject({
      method: "POST", url: "/api/ai/follow-up",
      payload: { analysisSessionId, messages: [{ role: "user", content: "怎么看？" }] },
    });
    expect(followUp.statusCode).toBe(200);
    expect(followUp.json().answer.answer).toBe("等待确认");
    expect(receivedSymbol).toBe("HKEX:981");

    const unknown = await app.inject({
      method: "POST", url: "/api/ai/follow-up",
      payload: { analysisSessionId: "00000000-0000-4000-8000-000000000000", messages: [{ role: "user", content: "怎么看？" }] },
    });
    expect(unknown.statusCode).toBe(404);
    await app.close(); db.close();
  });

  it("enriches an analysis with an on-demand TradingView snapshot", async () => {
    const db = openDatabase(":memory:"); migrate(db);
    const app = buildUiApp({
      config: testConfig, marketProvider, db,
      serverApiKey: "server-secret",
      tradingViewProvider: { fetchSnapshot: async ({ symbol, timeframeMinutes }) => ({
        source: "tradingview-data-window", symbol, timeframeMinutes,
        fetchedAt: new Date().toISOString(), barTimeMs: Date.now(), close: 62,
        ema20: 61, ema50: 60, ema200: 55, rsi14: 58, atr14: 1.2,
        volumeRatio20: 1.3, dailyTrend: 1, technicalScore: 75,
        support1: 60, support2: 58, resistance1: 64, resistance2: 66,
        support1ConfirmedAtMs: null, resistance1ConfirmedAtMs: null,
        confirmedSupports: 2, confirmedResistances: 2, supportTouches: 1,
        resistanceTouches: 1, supportBreaks: 0, resistanceBreaks: 0, scriptVersion: 2,
      }) },
    });
    const response = await app.inject({
      method: "POST", url: "/api/analyze", payload: { ...requestBody(), useTradingView: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().tradingView).toMatchObject({ status: "completed", snapshot: { scriptVersion: 2 } });
    await app.close(); db.close();
  });

  it("returns chart data and deterministic analysis without AI", async () => {
    const db = openDatabase(":memory:"); migrate(db);
    const app = buildUiApp({ config: testConfig, marketProvider, db });
    const response = await app.inject({ method: "POST", url: "/api/analyze", payload: requestBody() });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.technicalAnalysis.symbol).toBe("HKEX:981");
    expect(body.technicalAnalysis.provider).toBe("test-market");
    expect(body.chartBars).toHaveLength(239);
    expect(body.ai).toEqual({ status: "disabled" });
    await app.close();
    db.close();
  });

  it("requires a key only when AI is enabled", async () => {
    const db = openDatabase(":memory:"); migrate(db);
    const app = buildUiApp({ config: testConfig, marketProvider, db });
    const response = await app.inject({
      method: "POST",
      url: "/api/analyze",
      payload: { ...requestBody(), useAi: true },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("API Key");
    await app.close();
    db.close();
  });

  it("persists watchlist and position records through CRUD APIs", async () => {
    const db = openDatabase(":memory:"); migrate(db);
    const app = buildUiApp({ config: testConfig, marketProvider, db });
    const itemResponse = await app.inject({
      method: "POST", url: "/api/watchlist",
      payload: { symbol: "HKEX:981", providerSymbol: "0981.HK", name: "中芯国际" },
    });
    expect(itemResponse.statusCode).toBe(200);
    const item = itemResponse.json().item;
    const accountResponse = await app.inject({
      method: "POST", url: "/api/accounts",
      payload: { name: "港股账户", baseCurrency: "HKD", reportedEquity: 100_000 },
    });
    expect(accountResponse.statusCode).toBe(200);
    const account = accountResponse.json().account;

    const cashResponse = await app.inject({
      method: "POST", url: "/api/cash-balances",
      payload: { accountId: account.id, currency: "HKD", amount: 40_000 },
    });
    expect(cashResponse.statusCode).toBe(200);

    const positionResponse = await app.inject({
      method: "POST", url: "/api/positions",
      payload: {
        watchlistItemId: item.id, accountId: account.id, side: "long",
        quantity: 100, averageCost: 60, currency: "hkd", stopLoss: 55,
      },
    });
    expect(positionResponse.statusCode).toBe(200);
    expect(positionResponse.json().position).toMatchObject({ currency: "HKD", stopLoss: 55 });

    const conflict = await app.inject({
      method: "POST", url: "/api/positions",
      payload: {
        watchlistItemId: item.id, accountId: account.id, side: "long",
        quantity: 1, averageCost: 1, currency: "HKD",
      },
    });
    expect(conflict.statusCode).toBe(409);

    const protectedDelete = await app.inject({ method: "DELETE", url: `/api/watchlist/${item.id}` });
    expect(protectedDelete.statusCode).toBe(409);
    expect(protectedDelete.json().error).toContain("1 条持仓");
    await app.close(); db.close();
  });

  it("rejects impossible position dates and missing accounts", async () => {
    const db = openDatabase(":memory:"); migrate(db);
    const item = saveWatchlistItem(db, { symbol: "NASDAQ:AAPL", providerSymbol: "AAPL" });
    const app = buildUiApp({ config: testConfig, marketProvider, db });
    const invalidDate = await app.inject({
      method: "POST", url: "/api/positions",
      payload: { watchlistItemId: item.id, accountId: 999, side: "long", quantity: 1,
        averageCost: 10, currency: "USD", openedAt: "2026-99-99" },
    });
    expect(invalidDate.statusCode).toBe(400);
    const missingAccount = await app.inject({
      method: "POST", url: "/api/positions",
      payload: { watchlistItemId: item.id, accountId: 999, side: "long", quantity: 1,
        averageCost: 10, currency: "USD" },
    });
    expect(missingAccount.statusCode).toBe(400);
    await app.close(); db.close();
  });

  it("searches Tencent automatically before Yahoo", async () => {
    const db = openDatabase(":memory:"); migrate(db);
    let queried = false;
    const app = buildUiApp({
      config: testConfig, marketProvider, db,
      symbolSearch: { search: async () => { queried = true; return []; } },
      chinaSymbolSearch: { search: async () => [{ symbol: "300997.SZ", name: "欢乐家", exchange: "深圳", quoteType: "EQUITY", source: "tencent" }] },
    });
    const response = await app.inject({ method: "GET", url: "/api/symbol-search?q=%E5%8C%97%E6%96%B9%E5%8D%8E%E5%88%9B" });
    expect(response.statusCode).toBe(200);
    expect(response.json().source).toBe("tencent");
    expect(response.json().results).toContainEqual(expect.objectContaining({ symbol: "300997.SZ", name: "欢乐家" }));
    expect(queried).toBe(false);
    await app.close(); db.close();
  });

  it("proxies unknown symbol search and degrades provider failures safely", async () => {
    const db = openDatabase(":memory:"); migrate(db);
    const success = buildUiApp({
      config: testConfig, marketProvider, db,
      symbolSearch: { search: async () => [{ symbol: "CUSTOM.SI", name: "Custom Equity", exchange: "Singapore", quoteType: "EQUITY" }] },
      chinaSymbolSearch: { search: async () => [] },
    });
    const response = await success.inject({ method: "GET", url: "/api/symbol-search?q=custom%20equity" });
    expect(response.statusCode).toBe(200);
    expect(response.json().results[0]).toMatchObject({ symbol: "CUSTOM.SI", name: "Custom Equity" });
    await success.close();

    const failure = buildUiApp({
      config: testConfig, marketProvider, db,
      symbolSearch: { search: async () => { throw new Error("upstream secret"); } },
      chinaSymbolSearch: { search: async () => [] },
    });
    const failed = await failure.inject({ method: "GET", url: "/api/symbol-search?q=not-known" });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error).not.toContain("upstream secret");
    await failure.close(); db.close();
  });

  it("analyzes a matching position and rejects a mismatched symbol", async () => {
    const db = openDatabase(":memory:"); migrate(db);
    const item = saveWatchlistItem(db, { symbol: "HKEX:981", providerSymbol: "0981.HK" });
    const account = saveAccount(db, { name: "港股账户", baseCurrency: "HKD" });
    const position = savePosition(db, {
      watchlistItemId: item.id, accountId: account.id, side: "long",
      quantity: 10, averageCost: 60, currency: "HKD",
    });
    const app = buildUiApp({ config: testConfig, marketProvider, db });

    const matching = await app.inject({
      method: "POST", url: "/api/analyze",
      payload: { ...requestBody(), positionId: position.id },
    });
    expect(matching.statusCode).toBe(200);
    expect(matching.json().positionAnalysis).toMatchObject({ positionId: position.id, quantity: 10 });

    const mismatched = await app.inject({
      method: "POST", url: "/api/analyze",
      payload: { ...requestBody(), symbol: "NASDAQ:AAPL", providerSymbol: "AAPL", positionId: position.id },
    });
    expect(mismatched.statusCode).toBe(400);
    expect(mismatched.json().error).toContain("不一致");
    await app.close(); db.close();
  });

  it("shares account position context with AI only after explicit consent", async () => {
    const db = openDatabase(":memory:"); migrate(db);
    const item = saveWatchlistItem(db, { symbol: "HKEX:981", providerSymbol: "0981.HK" });
    const account = saveAccount(db, { name: "私密账户", baseCurrency: "HKD", reportedEquity: 100_000 });
    const position = savePosition(db, {
      watchlistItemId: item.id, accountId: account.id, side: "long",
      quantity: 10, averageCost: 60, currency: "HKD",
    });
    let aiInput;
    const app = buildUiApp({
      config: testConfig, marketProvider, db,
      serverApiKey: "server-secret",
      createAiProvider: (input) => ({
        provider: "test-ai", model: input.model,
        analyze: async (_report, positionContext) => { aiInput = positionContext; return judgement(); },
      }),
    });

    const withoutConsent = await app.inject({
      method: "POST", url: "/api/analyze",
      payload: { ...requestBody(), useAi: true, positionId: position.id, sharePositionWithAi: false },
    });
    expect(withoutConsent.statusCode).toBe(200);
    expect(withoutConsent.json().positionAnalysis.positionId).toBe(position.id);
    expect(aiInput).toBeNull();

    const withConsent = await app.inject({
      method: "POST", url: "/api/analyze",
      payload: { ...requestBody(), useAi: true, positionId: position.id, sharePositionWithAi: true },
    });
    expect(withConsent.statusCode).toBe(200);
    expect(aiInput).toMatchObject({ quantity: 10, accountEquity: 100_000 });
    expect(aiInput).not.toHaveProperty("accountName");
    expect(aiInput).not.toHaveProperty("positionId");
    expect(JSON.stringify(aiInput)).not.toContain("私密账户");
    await app.close(); db.close();
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
    transport: "chat_completions",
    sharePositionWithAi: false,
    useTradingView: false,
  };
}

function judgement() {
  return {
    bias: "neutral" as const, summary: "测试", key_observations: [],
    bullish_scenario: "向上", bearish_scenario: "向下", invalidation_conditions: [],
    risk_factors: [], data_limitations: [],
    portfolio_decision: { stance: "no_position" as const, risk_level: "unknown" as const, position_assessment: "无", actions: [] },
  };
}
