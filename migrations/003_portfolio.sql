CREATE TABLE IF NOT EXISTS watchlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL UNIQUE,
    provider_symbol TEXT NOT NULL,
    name TEXT,
    market TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watchlist_item_id INTEGER NOT NULL,
    account_name TEXT NOT NULL DEFAULT '默认账户',
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
    UNIQUE(watchlist_item_id, account_name),
    FOREIGN KEY(watchlist_item_id) REFERENCES watchlist_items(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_positions_watchlist_item
    ON positions(watchlist_item_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS account_profiles (
    name TEXT PRIMARY KEY,
    equity REAL NOT NULL CHECK(equity > 0),
    cash REAL NOT NULL CHECK(cash >= 0),
    base_currency TEXT NOT NULL,
    risk_budget_percent REAL CHECK(risk_budget_percent > 0 AND risk_budget_percent <= 100),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Existing development databases may have been created while the foreign key
-- used CASCADE. This trigger protects holdings regardless of that old schema.
CREATE TRIGGER IF NOT EXISTS prevent_watchlist_delete_with_positions
BEFORE DELETE ON watchlist_items
WHEN EXISTS (SELECT 1 FROM positions WHERE watchlist_item_id = OLD.id)
BEGIN
    SELECT RAISE(ABORT, 'watchlist item has positions');
END;
