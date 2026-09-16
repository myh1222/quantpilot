import type { Db } from "../db/database.js";
import { canonicalSymbol, normalizeProviderSymbol } from "./symbols.js";

export type WatchlistItem = {
  id: number; symbol: string; providerSymbol: string; name: string | null;
  market: string | null; notes: string | null; createdAt: string; updatedAt: string;
};

export type CashBalance = {
  id: number; accountId: number; currency: string; amount: number;
  notes: string | null; createdAt: string; updatedAt: string;
};

export type Account = {
  id: number; name: string; baseCurrency: string; reportedEquity: number | null;
  riskBudgetPercent: number | null; notes: string | null; cashBalances: CashBalance[];
  positionCount: number; createdAt: string; updatedAt: string;
};

export type AccountPositionSummary = {
  id: number; symbol: string; name: string | null; side: "long" | "short";
  quantity: number; averageCost: number; currency: string;
  stopLoss: number | null; targetPrice: number | null;
};

export type Position = {
  id: number; watchlistItemId: number; accountId: number; symbol: string;
  providerSymbol: string; name: string | null; accountName: string;
  side: "long" | "short"; quantity: number; averageCost: number; currency: string;
  stopLoss: number | null; targetPrice: number | null; thesis: string | null;
  openedAt: string | null; accountReportedEquity: number | null;
  accountBaseCurrency: string; accountRiskBudgetPercent: number | null;
  accountCashBalances: CashBalance[]; accountPositions: AccountPositionSummary[];
  createdAt: string; updatedAt: string;
};

export function seedWatchlist(db: Db, symbols: Array<{ symbol: string; providerSymbol: string }>, now = new Date()): void {
  const statement = db.prepare(`
    INSERT INTO watchlist_items(symbol, provider_symbol, created_at, updated_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(symbol) DO NOTHING
  `);
  const timestamp = now.toISOString();
  db.transaction(() => {
    for (const item of symbols) statement.run(
      canonicalSymbol(item.symbol, item.providerSymbol),
      normalizeProviderSymbol(item.providerSymbol), timestamp, timestamp,
    );
  })();
}

export function listWatchlist(db: Db): WatchlistItem[] {
  return (db.prepare(`
    SELECT id, symbol, provider_symbol, name, market, notes, created_at, updated_at
    FROM watchlist_items ORDER BY COALESCE(name, symbol), symbol
  `).all() as WatchlistRow[]).map(mapWatchlist);
}

export function saveWatchlistItem(db: Db, input: {
  id?: number; symbol: string; providerSymbol: string; name?: string | null;
  market?: string | null; notes?: string | null;
}, now = new Date()): WatchlistItem {
  const timestamp = now.toISOString();
  const providerSymbol = normalizeProviderSymbol(input.providerSymbol);
  const symbol = canonicalSymbol(input.symbol, providerSymbol);
  if (input.id === undefined) {
    const result = db.prepare(`
      INSERT INTO watchlist_items(symbol, provider_symbol, name, market, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(symbol, providerSymbol, clean(input.name), clean(input.market), clean(input.notes), timestamp, timestamp);
    return getWatchlistItem(db, Number(result.lastInsertRowid));
  }
  const result = db.prepare(`
    UPDATE watchlist_items SET symbol = ?, provider_symbol = ?, name = ?, market = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(symbol, providerSymbol, clean(input.name), clean(input.market), clean(input.notes), timestamp, input.id);
  if (result.changes === 0) throw new Error("watchlist item not found");
  return getWatchlistItem(db, input.id);
}

export function deleteWatchlistItem(db: Db, id: number): boolean {
  if (countPositionsForWatchlist(db, id) > 0) throw new Error("watchlist item has positions");
  return db.prepare("DELETE FROM watchlist_items WHERE id = ?").run(id).changes > 0;
}

export function countPositionsForWatchlist(db: Db, id: number): number {
  return (db.prepare("SELECT COUNT(*) AS count FROM positions WHERE watchlist_item_id = ?")
    .get(id) as { count: number }).count;
}

export function listAccounts(db: Db): Account[] {
  const rows = db.prepare(`
    SELECT a.id, a.name, a.base_currency, a.reported_equity, a.risk_budget_percent,
      a.notes, a.created_at, a.updated_at, COUNT(p.id) AS position_count
    FROM accounts a LEFT JOIN positions p ON p.account_id = a.id
    GROUP BY a.id ORDER BY a.name
  `).all() as AccountRow[];
  return rows.map((row) => mapAccount(db, row));
}

export function getAccount(db: Db, id: number): Account | undefined {
  const row = db.prepare(`
    SELECT a.id, a.name, a.base_currency, a.reported_equity, a.risk_budget_percent,
      a.notes, a.created_at, a.updated_at, COUNT(p.id) AS position_count
    FROM accounts a LEFT JOIN positions p ON p.account_id = a.id
    WHERE a.id = ? GROUP BY a.id
  `).get(id) as AccountRow | undefined;
  return row === undefined ? undefined : mapAccount(db, row);
}

export function saveAccount(db: Db, input: {
  id?: number; name: string; baseCurrency: string; reportedEquity?: number | null;
  riskBudgetPercent?: number | null; notes?: string | null;
}, now = new Date()): Account {
  const timestamp = now.toISOString();
  if (input.id === undefined) {
    const result = db.prepare(`
      INSERT INTO accounts(name, base_currency, reported_equity, risk_budget_percent, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.name.trim(), input.baseCurrency.toUpperCase(), input.reportedEquity ?? null,
      input.riskBudgetPercent ?? null, clean(input.notes), timestamp, timestamp);
    return getAccountRequired(db, Number(result.lastInsertRowid));
  }
  const result = db.prepare(`
    UPDATE accounts SET name = ?, base_currency = ?, reported_equity = ?,
      risk_budget_percent = ?, notes = ?, updated_at = ? WHERE id = ?
  `).run(input.name.trim(), input.baseCurrency.toUpperCase(), input.reportedEquity ?? null,
    input.riskBudgetPercent ?? null, clean(input.notes), timestamp, input.id);
  if (result.changes === 0) throw new Error("account not found");
  return getAccountRequired(db, input.id);
}

export function deleteAccount(db: Db, id: number): boolean {
  const count = (db.prepare("SELECT COUNT(*) AS count FROM positions WHERE account_id = ?")
    .get(id) as { count: number }).count;
  if (count > 0) throw new Error("account has positions");
  return db.prepare("DELETE FROM accounts WHERE id = ?").run(id).changes > 0;
}

export function saveCashBalance(db: Db, input: {
  id?: number; accountId: number; currency: string; amount: number; notes?: string | null;
}, now = new Date()): CashBalance {
  const timestamp = now.toISOString();
  if (input.id === undefined) {
    const result = db.prepare(`
      INSERT INTO cash_balances(account_id, currency, amount, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.accountId, input.currency.toUpperCase(), input.amount, clean(input.notes), timestamp, timestamp);
    return getCashBalanceRequired(db, Number(result.lastInsertRowid));
  }
  const result = db.prepare(`
    UPDATE cash_balances SET account_id = ?, currency = ?, amount = ?, notes = ?, updated_at = ? WHERE id = ?
  `).run(input.accountId, input.currency.toUpperCase(), input.amount, clean(input.notes), timestamp, input.id);
  if (result.changes === 0) throw new Error("cash balance not found");
  return getCashBalanceRequired(db, input.id);
}

export function deleteCashBalance(db: Db, id: number): boolean {
  return db.prepare("DELETE FROM cash_balances WHERE id = ?").run(id).changes > 0;
}

export function listPositions(db: Db): Position[] {
  return (db.prepare(positionSelect("ORDER BY a.name, COALESCE(w.name, w.symbol)"))
    .all() as PositionRow[]).map((row) => hydratePosition(db, row));
}

export function getPosition(db: Db, id: number): Position | undefined {
  const row = db.prepare(positionSelect("WHERE p.id = ?")).get(id) as PositionRow | undefined;
  return row === undefined ? undefined : hydratePosition(db, row);
}

export function savePosition(db: Db, input: {
  id?: number; watchlistItemId: number; accountId: number; side: "long" | "short";
  quantity: number; averageCost: number; currency: string; stopLoss?: number | null;
  targetPrice?: number | null; thesis?: string | null; openedAt?: string | null;
}, now = new Date()): Position {
  const timestamp = now.toISOString();
  if (input.id === undefined) {
    const result = db.prepare(`
      INSERT INTO positions(watchlist_item_id, account_id, side, quantity, average_cost, currency,
        stop_loss, target_price, thesis, opened_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.watchlistItemId, input.accountId, input.side, input.quantity, input.averageCost,
      input.currency.toUpperCase(), input.stopLoss ?? null, input.targetPrice ?? null,
      clean(input.thesis), input.openedAt ?? null, timestamp, timestamp);
    return getPositionRequired(db, Number(result.lastInsertRowid));
  }
  const result = db.prepare(`
    UPDATE positions SET watchlist_item_id = ?, account_id = ?, side = ?, quantity = ?, average_cost = ?,
      currency = ?, stop_loss = ?, target_price = ?, thesis = ?, opened_at = ?, updated_at = ? WHERE id = ?
  `).run(input.watchlistItemId, input.accountId, input.side, input.quantity, input.averageCost,
    input.currency.toUpperCase(), input.stopLoss ?? null, input.targetPrice ?? null,
    clean(input.thesis), input.openedAt ?? null, timestamp, input.id);
  if (result.changes === 0) throw new Error("position not found");
  return getPositionRequired(db, input.id);
}

export function deletePosition(db: Db, id: number): boolean {
  return db.prepare("DELETE FROM positions WHERE id = ?").run(id).changes > 0;
}

function getWatchlistItem(db: Db, id: number): WatchlistItem {
  const row = db.prepare(`SELECT id, symbol, provider_symbol, name, market, notes, created_at, updated_at
    FROM watchlist_items WHERE id = ?`).get(id) as WatchlistRow | undefined;
  if (row === undefined) throw new Error("watchlist item not found");
  return mapWatchlist(row);
}

function getAccountRequired(db: Db, id: number): Account {
  const account = getAccount(db, id);
  if (account === undefined) throw new Error("account not found");
  return account;
}

function getCashBalanceRequired(db: Db, id: number): CashBalance {
  const row = db.prepare(`SELECT id, account_id, currency, amount, notes, created_at, updated_at
    FROM cash_balances WHERE id = ?`).get(id) as CashRow | undefined;
  if (row === undefined) throw new Error("cash balance not found");
  return mapCash(row);
}

function getPositionRequired(db: Db, id: number): Position {
  const position = getPosition(db, id);
  if (position === undefined) throw new Error("position not found");
  return position;
}

function listCashBalances(db: Db, accountId: number): CashBalance[] {
  return (db.prepare(`SELECT id, account_id, currency, amount, notes, created_at, updated_at
    FROM cash_balances WHERE account_id = ? ORDER BY currency`).all(accountId) as CashRow[]).map(mapCash);
}

function listAccountPositionSummaries(db: Db, accountId: number): AccountPositionSummary[] {
  return (db.prepare(`
    SELECT p.id, w.symbol, w.name, p.side, p.quantity, p.average_cost, p.currency, p.stop_loss, p.target_price
    FROM positions p JOIN watchlist_items w ON w.id = p.watchlist_item_id
    WHERE p.account_id = ? ORDER BY COALESCE(w.name, w.symbol)
  `).all(accountId) as AccountPositionRow[]).map((row) => ({
    id: row.id, symbol: row.symbol, name: row.name, side: row.side, quantity: row.quantity,
    averageCost: row.average_cost, currency: row.currency, stopLoss: row.stop_loss, targetPrice: row.target_price,
  }));
}

function positionSelect(suffix: string): string {
  return `
    SELECT p.id, p.watchlist_item_id, p.account_id, w.symbol, w.provider_symbol, w.name,
      a.name AS account_name, a.base_currency AS account_base_currency,
      a.reported_equity AS account_reported_equity, a.risk_budget_percent AS account_risk_budget_percent,
      p.side, p.quantity, p.average_cost, p.currency, p.stop_loss, p.target_price,
      p.thesis, p.opened_at, p.created_at, p.updated_at
    FROM positions p JOIN watchlist_items w ON w.id = p.watchlist_item_id
    JOIN accounts a ON a.id = p.account_id ${suffix}
  `;
}

type WatchlistRow = { id: number; symbol: string; provider_symbol: string; name: string | null;
  market: string | null; notes: string | null; created_at: string; updated_at: string };
type AccountRow = { id: number; name: string; base_currency: string; reported_equity: number | null;
  risk_budget_percent: number | null; notes: string | null; position_count: number;
  created_at: string; updated_at: string };
type CashRow = { id: number; account_id: number; currency: string; amount: number;
  notes: string | null; created_at: string; updated_at: string };
type PositionRow = { id: number; watchlist_item_id: number; account_id: number; symbol: string;
  provider_symbol: string; name: string | null; account_name: string; account_base_currency: string;
  account_reported_equity: number | null; account_risk_budget_percent: number | null;
  side: "long" | "short"; quantity: number; average_cost: number; currency: string;
  stop_loss: number | null; target_price: number | null; thesis: string | null;
  opened_at: string | null; created_at: string; updated_at: string };
type AccountPositionRow = { id: number; symbol: string; name: string | null; side: "long" | "short";
  quantity: number; average_cost: number; currency: string; stop_loss: number | null; target_price: number | null };

function mapWatchlist(row: WatchlistRow): WatchlistItem {
  return { id: row.id, symbol: row.symbol, providerSymbol: row.provider_symbol, name: row.name,
    market: row.market, notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapAccount(db: Db, row: AccountRow): Account {
  return { id: row.id, name: row.name, baseCurrency: row.base_currency,
    reportedEquity: row.reported_equity, riskBudgetPercent: row.risk_budget_percent,
    notes: row.notes, cashBalances: listCashBalances(db, row.id), positionCount: row.position_count,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapCash(row: CashRow): CashBalance {
  return { id: row.id, accountId: row.account_id, currency: row.currency, amount: row.amount,
    notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at };
}

function hydratePosition(db: Db, row: PositionRow): Position {
  return { id: row.id, watchlistItemId: row.watchlist_item_id, accountId: row.account_id,
    symbol: row.symbol, providerSymbol: row.provider_symbol, name: row.name, accountName: row.account_name,
    side: row.side, quantity: row.quantity, averageCost: row.average_cost, currency: row.currency,
    stopLoss: row.stop_loss, targetPrice: row.target_price, thesis: row.thesis, openedAt: row.opened_at,
    accountReportedEquity: row.account_reported_equity, accountBaseCurrency: row.account_base_currency,
    accountRiskBudgetPercent: row.account_risk_budget_percent,
    accountCashBalances: listCashBalances(db, row.account_id),
    accountPositions: listAccountPositionSummaries(db, row.account_id),
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
