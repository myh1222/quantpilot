import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, openDatabase } from "../src/db/database.js";
import { analyzePosition } from "../src/portfolio/analysis.js";
import {
  deleteAccount,
  deleteCashBalance,
  deleteWatchlistItem,
  getAccount,
  listAccounts,
  listPositions,
  listWatchlist,
  savePosition,
  saveAccount,
  saveCashBalance,
  saveWatchlistItem,
  seedWatchlist,
} from "../src/portfolio/repository.js";

describe("watchlist and positions", () => {
  it("migrates legacy account_name, equity and cash without losing positions", () => {
    const db = openDatabase(":memory:");
    for (const filename of ["001_initial.sql", "002_local_alerts.sql", "003_portfolio.sql"]) {
      db.exec(readFileSync(resolve("migrations", filename), "utf8"));
    }
    db.prepare(`INSERT INTO watchlist_items(symbol, provider_symbol, created_at, updated_at)
      VALUES ('HKEX:981', '0981.HK', '2026-01-01', '2026-01-01')`).run();
    db.prepare(`INSERT INTO account_profiles(name, equity, cash, base_currency, risk_budget_percent, created_at, updated_at)
      VALUES ('旧账户', 100000, 30000, 'HKD', 1, '2026-01-01', '2026-01-01')`).run();
    db.prepare(`INSERT INTO positions(watchlist_item_id, account_name, side, quantity, average_cost, currency, created_at, updated_at)
      VALUES (1, '旧账户', 'long', 100, 60, 'HKD', '2026-01-01', '2026-01-01')`).run();

    migrate(db);
    expect(listAccounts(db)[0]).toMatchObject({
      name: "旧账户", reportedEquity: 100000,
      cashBalances: [{ currency: "HKD", amount: 30000 }], positionCount: 1,
    });
    expect(listPositions(db)[0]).toMatchObject({ accountName: "旧账户", quantity: 100 });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("persists watchlist entries and protects their account positions", () => {
    const db = openDatabase(":memory:"); migrate(db);
    seedWatchlist(db, [{ symbol: "HKEX:981", providerSymbol: "0981.HK" }], new Date("2026-01-01Z"));
    seedWatchlist(db, [{ symbol: "HKEX:981", providerSymbol: "0981.HK" }], new Date("2026-01-02Z"));
    const item = listWatchlist(db)[0]!;
    const account = saveAccount(db, { name: "港股账户", baseCurrency: "HKD" });
    expect(listWatchlist(db)).toHaveLength(1);

    const position = savePosition(db, {
      watchlistItemId: item.id,
      accountId: account.id,
      side: "long",
      quantity: 1000,
      averageCost: 60,
      currency: "hkd",
      stopLoss: 55,
      targetPrice: 75,
      thesis: "等待行业景气改善",
    });
    expect(position.currency).toBe("HKD");
    expect(listPositions(db)).toHaveLength(1);
    expect(() => deleteWatchlistItem(db, item.id)).toThrow("has positions");
    expect(() => db.prepare("DELETE FROM watchlist_items WHERE id = ?").run(item.id)).toThrow("has positions");
    expect(listPositions(db)).toHaveLength(1);
    db.close();
  });

  it("uses optional account risk parameters without guessing FX conversion", () => {
    const db = openDatabase(":memory:"); migrate(db);
    const item = saveWatchlistItem(db, { symbol: "NASDAQ:AAPL", providerSymbol: "AAPL" });
    const account = saveAccount(db, {
      name: "USD account", baseCurrency: "USD", reportedEquity: 10_000, riskBudgetPercent: 1,
    });
    saveCashBalance(db, { accountId: account.id, currency: "USD", amount: 4_000 });
    const position = savePosition(db, {
      watchlistItemId: item.id, accountId: account.id, side: "long", quantity: 10,
      averageCost: 100, currency: "USD", stopLoss: 90, targetPrice: 140,
    });
    expect(analyzePosition(position, 120)).toMatchObject({
      positionWeightPercent: 0.12,
      riskToStopPercentOfEquity: 0.03,
      accountRiskBudgetPercent: 0.01,
    });
    const differentCurrency = analyzePosition({ ...position, currency: "HKD" }, 120);
    expect(differentCurrency.positionWeightPercent).toBeNull();
    expect(differentCurrency.riskToStopPercentOfEquity).toBeNull();
    db.close();
  });

  it("models independent accounts with zero or more holdings and cash balances", () => {
    const db = openDatabase(":memory:"); migrate(db);
    const firstStock = saveWatchlistItem(db, { symbol: "HKEX:981", providerSymbol: "0981.HK" });
    const secondStock = saveWatchlistItem(db, { symbol: "SZSE:300997", providerSymbol: "300997.SZ" });
    const hk = saveAccount(db, { name: "港股账户", baseCurrency: "HKD" });
    const aShare = saveAccount(db, { name: "A股账户", baseCurrency: "CNY" });
    const empty = saveAccount(db, { name: "空账户", baseCurrency: "USD" });

    saveCashBalance(db, { accountId: hk.id, currency: "HKD", amount: 1000, notes: "活期" });
    saveCashBalance(db, { accountId: hk.id, currency: "USD", amount: 200, notes: "美元" });
    saveCashBalance(db, { accountId: aShare.id, currency: "CNY", amount: 5000 });
    savePosition(db, { watchlistItemId: firstStock.id, accountId: hk.id, side: "long", quantity: 100, averageCost: 60, currency: "HKD" });
    savePosition(db, { watchlistItemId: firstStock.id, accountId: aShare.id, side: "long", quantity: 200, averageCost: 26, currency: "CNY" });
    savePosition(db, { watchlistItemId: secondStock.id, accountId: aShare.id, side: "long", quantity: 300, averageCost: 10, currency: "CNY" });

    const accounts = listAccounts(db);
    expect(accounts).toHaveLength(3);
    expect(accounts.map((account) => [account.name, account.positionCount, account.cashBalances.length])).toEqual([
      ["A股账户", 2, 1], ["港股账户", 1, 2], ["空账户", 0, 0],
    ]);

    const hkPosition = listPositions(db).find((position) => position.accountId === hk.id)!;
    const aSharePosition = listPositions(db).find((position) => position.accountId === aShare.id)!;
    expect(hkPosition.accountCashBalances.map((cash) => [cash.currency, cash.amount])).toEqual([["HKD", 1000], ["USD", 200]]);
    expect(aSharePosition.accountPositions.map((item) => item.symbol)).toEqual(["HKEX:981", "SZSE:300997"]);
    expect(getAccount(db, empty.id)).toMatchObject({ positionCount: 0, cashBalances: [] });

    expect(() => deleteAccount(db, hk.id)).toThrow("has positions");
    expect(deleteCashBalance(db, hkPosition.accountCashBalances[1]!.id)).toBe(true);
    expect(getAccount(db, hk.id)?.cashBalances).toHaveLength(1);
    db.close();
  });

  it("calculates long and short P&L deterministically", () => {
    const db = openDatabase(":memory:"); migrate(db);
    const item = saveWatchlistItem(db, { symbol: "NASDAQ:AAPL", providerSymbol: "AAPL" });
    const account = saveAccount(db, { name: "A", baseCurrency: "USD" });
    const long = savePosition(db, {
      watchlistItemId: item.id, accountId: account.id, side: "long", quantity: 10,
      averageCost: 100, currency: "USD", stopLoss: 90, targetPrice: 140,
    });
    const short = { ...long, id: 99, side: "short" as const };

    expect(analyzePosition(long, 120)).toMatchObject({ marketValue: 1200, unrealizedPnl: 200, unrealizedPnlPercent: 0.2 });
    expect(analyzePosition(short, 80)).toMatchObject({ marketValue: 800, unrealizedPnl: 200, unrealizedPnlPercent: 0.2 });
    db.close();
  });
});
