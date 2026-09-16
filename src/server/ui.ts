import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import Fastify from "fastify";
import { z } from "zod";
import {
  ResponsesApiProvider,
  type AiTransport,
  type AiFollowUp,
  type AnalysisAiProvider,
} from "../ai/provider.js";
import { runAnalysis } from "../analysis/run.js";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/database.js";
import type { MarketProvider } from "../local-alerts/provider.js";
import {
  TencentSymbolSearch,
  YahooSymbolSearch,
  type SymbolSearchResult,
} from "../local-alerts/search.js";
import { searchKnownSymbols } from "../local-alerts/known-symbols.js";
import { YahooChartProvider } from "../local-alerts/yahoo.js";
import {
  deletePosition,
  deleteAccount,
  deleteCashBalance,
  deleteWatchlistItem,
  countPositionsForWatchlist,
  getPosition,
  listPositions,
  listAccounts,
  listWatchlist,
  savePosition,
  saveAccount,
  saveCashBalance,
  saveWatchlistItem,
} from "../portfolio/repository.js";
import { canonicalSymbol, normalizeProviderSymbol } from "../portfolio/symbols.js";
import type { TradingViewSnapshotProvider } from "../tradingview/types.js";

const analysisRequestSchema = z.object({
  symbol: z.string().trim().min(1).max(64),
  providerSymbol: z.string().trim().min(1).max(64),
  timeframeMinutes: z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(60)]),
  lookbackDays: z.number().int().min(7).max(59),
  useAi: z.boolean(),
  apiKey: z.string().max(512).optional(),
  model: z.string().trim().min(1).max(128),
  baseUrl: z.string().url().max(512),
  transport: z.enum(["responses", "chat_completions"]).default("responses"),
  positionId: z.number().int().positive().nullable().optional(),
  sharePositionWithAi: z.boolean().default(false),
  useTradingView: z.boolean().default(false),
}).strict();

const followUpRequestSchema = z.object({
  analysisSessionId: z.string().uuid(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(2000),
  })).min(1).max(12),
}).strict();

const watchlistSchema = z.object({
  id: z.number().int().positive().optional(),
  symbol: z.string().trim().min(1).max(64),
  providerSymbol: z.string().trim().min(1).max(64),
  name: z.string().trim().max(100).nullable().optional(),
  market: z.string().trim().max(64).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
}).strict();

const positionSchema = z.object({
  id: z.number().int().positive().optional(),
  watchlistItemId: z.number().int().positive(),
  accountId: z.number().int().positive(),
  side: z.enum(["long", "short"]),
  quantity: z.number().positive().finite(),
  averageCost: z.number().positive().finite(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/),
  stopLoss: z.number().positive().finite().nullable().optional(),
  targetPrice: z.number().positive().finite().nullable().optional(),
  thesis: z.string().trim().max(2000).nullable().optional(),
  openedAt: z.string().refine(isIsoDate, "日期不正确").nullable().optional(),
}).strict();

const accountSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(100),
  baseCurrency: z.string().trim().regex(/^[A-Za-z]{3}$/),
  reportedEquity: z.number().positive().finite().nullable().optional(),
  riskBudgetPercent: z.number().positive().max(100).finite().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
}).strict();

const cashBalanceSchema = z.object({
  id: z.number().int().positive().optional(),
  accountId: z.number().int().positive(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/),
  amount: z.number().nonnegative().finite(),
  notes: z.string().trim().max(500).nullable().optional(),
}).strict();

type AiProviderFactory = (input: {
  model: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  transport: AiTransport;
}) => AnalysisAiProvider;

type UiDependencies = {
  config: AppConfig;
  db: Db;
  marketProvider?: MarketProvider;
  publicDirectory?: string;
  symbolSearch?: { search(query: string): Promise<SymbolSearchResult[]> };
  chinaSymbolSearch?: { search(query: string): Promise<SymbolSearchResult[]> };
  serverApiKey?: string;
  tradingViewProvider?: TradingViewSnapshotProvider;
  createAiProvider?: AiProviderFactory;
  askFollowUp?: (input: {
    result: unknown;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }) => Promise<AiFollowUp>;
};

export function buildUiApp({
  config,
  db,
  marketProvider = new YahooChartProvider(),
  publicDirectory = resolve("public"),
  symbolSearch = new YahooSymbolSearch(),
  chinaSymbolSearch = new TencentSymbolSearch(),
  serverApiKey = config.aiApiKey,
  tradingViewProvider,
  askFollowUp,
  createAiProvider = (input) => new ResponsesApiProvider(
    input.model, input.apiKey, input.baseUrl, input.timeoutMs, fetch, input.transport,
  ),
}: UiDependencies) {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  const analysisSessions = new Map<string, { result: unknown; expiresAt: number }>();

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
    symbols: listWatchlist(db),
    defaults: {
      timeframeMinutes: config.localAlerts.timeframeMinutes,
      lookbackDays: config.analysis.lookbackDays,
      model: config.ai.model,
      baseUrl: config.ai.baseUrl,
      transport: config.ai.transport,
      hasServerApiKey: serverApiKey !== undefined && serverApiKey.length > 0,
      followUpEnabled: askFollowUp !== undefined,
      tradingViewEnabled: tradingViewProvider !== undefined,
    },
  }));

  app.get("/api/symbol-search", async (request, reply) => {
    const query = String((request.query as { q?: unknown }).q ?? "").trim();
    if (query.length < 1 || query.length > 80) {
      return reply.code(400).send({ error: "搜索关键词长度不正确" });
    }
    const known = searchKnownSymbols(query).map((item) => ({
      symbol: item.symbol,
      name: item.name,
      exchange: item.exchange,
      quoteType: "EQUITY",
    }));
    try {
      const chinaResults = await chinaSymbolSearch.search(query);
      if (chinaResults.length > 0) {
        return reply.send({ results: enrichSearchResults(deduplicateSearchResults([...known, ...chinaResults])), source: "tencent" });
      }
      const yahooResults = await symbolSearch.search(query);
      const combined = deduplicateSearchResults([...known, ...yahooResults]);
      return reply.send({ results: enrichSearchResults(combined), source: yahooResults.length > 0 ? "yahoo" : "offline" });
    } catch {
      // Search is advisory; the user can still enter a provider symbol manually.
      if (known.length > 0) return reply.send({ results: enrichSearchResults(known), source: "offline" });
      return reply.code(503).send({ error: "代码搜索暂不可用，请手动填写 Yahoo 代码" });
    }
  });

  app.get("/api/watchlist", async () => ({ items: listWatchlist(db) }));
  app.post("/api/watchlist", async (request, reply) => {
    const parsed = watchlistSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "自选股信息不正确", details: parsed.error.issues });
    try {
      return reply.send({ item: saveWatchlistItem(db, parsed.data) });
    } catch (error) {
      return persistenceError(reply, error, "保存自选股失败");
    }
  });
  app.delete<{ Params: { id: string } }>("/api/watchlist/:id", async (request, reply) => {
    const id = positiveId(request.params.id);
    if (id === null) return reply.code(400).send({ error: "自选股 ID 不正确" });
    const positionCount = countPositionsForWatchlist(db, id);
    if (positionCount > 0) {
      return reply.code(409).send({ error: `该自选股仍关联 ${positionCount} 条持仓，请先处理持仓` });
    }
    try {
      if (!deleteWatchlistItem(db, id)) return reply.code(404).send({ error: "自选股不存在" });
      return reply.send({ ok: true });
    } catch (error) {
      return persistenceError(reply, error, "删除自选股失败");
    }
  });

  app.get("/api/positions", async () => ({ positions: listPositions(db) }));
  app.get("/api/accounts", async () => ({ accounts: listAccounts(db) }));
  app.post("/api/accounts", async (request, reply) => {
    const parsed = accountSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "账户信息不正确", details: parsed.error.issues });
    try {
      return reply.send({ account: saveAccount(db, parsed.data) });
    } catch (error) {
      return persistenceError(reply, error, "保存账户失败");
    }
  });
  app.delete<{ Params: { id: string } }>("/api/accounts/:id", async (request, reply) => {
    const id = positiveId(request.params.id);
    if (id === null) return reply.code(400).send({ error: "账户 ID 不正确" });
    try {
      if (!deleteAccount(db, id)) return reply.code(404).send({ error: "账户不存在" });
      return reply.send({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("has positions")) {
        return reply.code(409).send({ error: "该账户仍有持仓，请先处理持仓" });
      }
      return persistenceError(reply, error, "删除账户失败");
    }
  });
  app.post("/api/cash-balances", async (request, reply) => {
    const parsed = cashBalanceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "现金余额不正确", details: parsed.error.issues });
    try {
      return reply.send({ cashBalance: saveCashBalance(db, parsed.data) });
    } catch (error) {
      return persistenceError(reply, error, "保存现金余额失败");
    }
  });
  app.delete<{ Params: { id: string } }>("/api/cash-balances/:id", async (request, reply) => {
    const id = positiveId(request.params.id);
    if (id === null) return reply.code(400).send({ error: "现金余额 ID 不正确" });
    if (!deleteCashBalance(db, id)) return reply.code(404).send({ error: "现金余额不存在" });
    return reply.send({ ok: true });
  });
  app.post("/api/positions", async (request, reply) => {
    const parsed = positionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "持仓信息不正确", details: parsed.error.issues });
    try {
      return reply.send({ position: savePosition(db, parsed.data) });
    } catch (error) {
      return persistenceError(reply, error, "保存持仓失败");
    }
  });
  app.delete<{ Params: { id: string } }>("/api/positions/:id", async (request, reply) => {
    const id = positiveId(request.params.id);
    if (id === null) return reply.code(400).send({ error: "持仓 ID 不正确" });
    if (!deletePosition(db, id)) return reply.code(404).send({ error: "持仓不存在" });
    return reply.send({ ok: true });
  });

  app.post("/api/analyze", async (request, reply) => {
    const parsed = analysisRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "请求参数不正确", details: parsed.error.issues });
    }
    const input = parsed.data;
    const requestApiKey = input.apiKey?.trim() || undefined;
    const apiKey = requestApiKey ?? serverApiKey;
    if (input.useAi && !apiKey) {
      return reply.code(400).send({ error: "启用 AI 时必须填写 API Key，或先在本机配置密钥" });
    }

    // A key loaded from the environment or Keychain is bound to server-owned
    // provider settings. Custom destinations must bring their own request key.
    const aiProvider = input.useAi ? createAiProvider(requestApiKey === undefined ? {
      model: config.ai.model,
      apiKey: apiKey!,
      baseUrl: config.ai.baseUrl,
      timeoutMs: config.ai.timeoutMs,
      transport: config.ai.transport,
    } : {
      model: input.model,
      apiKey: apiKey!,
      baseUrl: input.baseUrl,
      timeoutMs: config.ai.timeoutMs,
      // The local bridge serves glm reliably through Chat Completions JSON mode.
      transport: input.baseUrl.replace(/\/$/, "").includes("://127.0.0.1:8317")
        ? "chat_completions"
        : input.transport,
    }) : undefined;
    try {
      const position = input.positionId == null ? undefined : getPosition(db, input.positionId);
      if (input.positionId != null && position === undefined) {
        return reply.code(404).send({ error: "所选持仓不存在" });
      }
      if (position !== undefined && position.symbol !== input.symbol) {
        return reply.code(400).send({ error: "所选持仓与分析股票不一致" });
      }
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
        position,
        sharePositionWithAi: input.sharePositionWithAi,
      }, marketProvider, aiProvider, input.useTradingView ? tradingViewProvider : undefined);
      if (result.ai.status === "completed" && askFollowUp !== undefined) {
        pruneAnalysisSessions(analysisSessions);
        const analysisSessionId = randomUUID();
        analysisSessions.set(analysisSessionId, { result, expiresAt: Date.now() + 60 * 60_000 });
        return reply.send({ ...result, analysisSessionId });
      }
      return reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ error: message }, "analysis failed");
      return reply.code(502).send({ error: friendlyError(message) });
    }
  });

  app.post("/api/ai/follow-up", async (request, reply) => {
    const parsed = followUpRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "追问请求不正确", details: parsed.error.issues });
    }
    if (askFollowUp === undefined) {
      return reply.code(503).send({ error: "AI 追问服务不可用" });
    }
    pruneAnalysisSessions(analysisSessions);
    const session = analysisSessions.get(parsed.data.analysisSessionId);
    if (session === undefined) {
      return reply.code(404).send({ error: "分析会话已过期，请重新运行分析" });
    }
    try {
      return reply.send({ answer: await askFollowUp({ result: session.result, messages: parsed.data.messages }) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ error: message }, "AI follow-up failed");
      return reply.code(502).send({ error: `AI 追问失败：${message}` });
    }
  });

  return app;
}

function pruneAnalysisSessions(sessions: Map<string, { result: unknown; expiresAt: number }>): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
  while (sessions.size > 100) sessions.delete(sessions.keys().next().value!);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function enrichSearchResults(results: SymbolSearchResult[]) {
  return results.map((item) => ({
    ...item,
    symbol: normalizeProviderSymbol(item.symbol),
    displaySymbol: canonicalSymbol("", item.symbol, item.exchange),
  }));
}

function deduplicateSearchResults(results: SymbolSearchResult[]): SymbolSearchResult[] {
  const seen = new Set<string>();
  return results.filter((item) => {
    const key = normalizeProviderSymbol(item.symbol);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function positiveId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function persistenceError(reply: { code(statusCode: number): { send(payload: unknown): unknown } }, error: unknown, prefix: string) {
  const message = error instanceof Error ? error.message : String(error);
  const conflict = message.includes("UNIQUE constraint failed");
  return reply.code(conflict ? 409 : 400).send({ error: conflict ? "记录已存在，请编辑原记录" : `${prefix}：${message}` });
}

function readAsset(directory: string, filename: string): string {
  return readFileSync(resolve(directory, filename), "utf8");
}

function friendlyError(message: string): string {
  if (message.includes("Yahoo")) return `行情数据获取失败：${message}`;
  if (message.includes("at least")) return `有效 K 线数量不足：${message}`;
  return `分析失败：${message}`;
}
