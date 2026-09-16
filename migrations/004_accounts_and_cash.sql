CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    base_currency TEXT NOT NULL,
    reported_equity REAL CHECK(reported_equity > 0),
    risk_budget_percent REAL CHECK(risk_budget_percent > 0 AND risk_budget_percent <= 100),
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT INTO accounts(name, base_currency, reported_equity, risk_budget_percent, created_at, updated_at)
SELECT name, UPPER(base_currency), equity, risk_budget_percent, created_at, updated_at
FROM account_profiles;

INSERT INTO accounts(name, base_currency, created_at, updated_at)
SELECT p.account_name, UPPER(MIN(p.currency)), MIN(p.created_at), MAX(p.updated_at)
FROM positions p
LEFT JOIN accounts a ON a.name = p.account_name
WHERE a.id IS NULL
GROUP BY p.account_name;

CREATE TABLE cash_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    currency TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount >= 0),
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(account_id, currency),
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

INSERT INTO cash_balances(account_id, currency, amount, created_at, updated_at)
SELECT a.id, UPPER(p.base_currency), p.cash, p.created_at, p.updated_at
FROM account_profiles p
JOIN accounts a ON a.name = p.name;

DROP TRIGGER IF EXISTS prevent_watchlist_delete_with_positions;

CREATE TABLE positions_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watchlist_item_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    side TEXT NOT NULL CHECK(side IN ('long', 'short')),
    quantity REAL NOT NULL CHECK(quantity > 0),
    average_cost REAL NOT NULL CHECK(average_cost > 0),
    currency TEXT NOT NULL,
    stop_loss REAL,
    target_price REAL,
    thesis TEXT,
    opened_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(watchlist_item_id, account_id),
    FOREIGN KEY(watchlist_item_id) REFERENCES watchlist_items(id) ON DELETE RESTRICT,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE RESTRICT
);

INSERT INTO positions_v2(
    id, watchlist_item_id, account_id, side, quantity, average_cost, currency,
    stop_loss, target_price, thesis, opened_at, created_at, updated_at
)
SELECT p.id, p.watchlist_item_id, a.id, p.side, p.quantity, p.average_cost, UPPER(p.currency),
       p.stop_loss, p.target_price, p.thesis, p.opened_at, p.created_at, p.updated_at
FROM positions p
JOIN accounts a ON a.name = p.account_name;

DROP TABLE positions;
ALTER TABLE positions_v2 RENAME TO positions;
DROP TABLE account_profiles;

CREATE INDEX idx_positions_watchlist_item
    ON positions(watchlist_item_id, updated_at DESC);
CREATE INDEX idx_positions_account
    ON positions(account_id, updated_at DESC);
CREATE INDEX idx_cash_balances_account
    ON cash_balances(account_id, currency);

CREATE TRIGGER prevent_watchlist_delete_with_positions
BEFORE DELETE ON watchlist_items
WHEN EXISTS (SELECT 1 FROM positions WHERE watchlist_item_id = OLD.id)
BEGIN
    SELECT RAISE(ABORT, 'watchlist item has positions');
END;
