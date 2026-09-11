PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS symbols (
    symbol TEXT PRIMARY KEY,
    exchange TEXT NOT NULL,
    ticker TEXT NOT NULL,
    membership_status TEXT NOT NULL DEFAULT 'pending',
    metadata_status TEXT NOT NULL DEFAULT 'pending',
    enabled INTEGER NOT NULL DEFAULT 1,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_key TEXT UNIQUE NOT NULL,
    logical_event_key TEXT NOT NULL,
    alert_instance_id TEXT NOT NULL,
    pine_config_version INTEGER NOT NULL,
    processing_status TEXT NOT NULL,
    raw_payload TEXT NOT NULL,
    received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deliveries_logical_event
    ON webhook_deliveries(logical_event_key, received_at);

CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    logical_event_key TEXT UNIQUE NOT NULL,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    event TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    selected_pine_config_version INTEGER NOT NULL,
    bar_open_time_ms INTEGER NOT NULL,
    signal_price REAL NOT NULL,
    payload TEXT NOT NULL,
    received_at TEXT NOT NULL,
    analysis_status TEXT NOT NULL DEFAULT 'pending',
    FOREIGN KEY(symbol) REFERENCES symbols(symbol)
);

CREATE INDEX IF NOT EXISTS idx_signals_symbol_bar_time
    ON signals(symbol, bar_open_time_ms DESC);

CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id INTEGER NOT NULL,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT NOT NULL,
    locked_at TEXT,
    locked_until TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(signal_id, job_type),
    FOREIGN KEY(signal_id) REFERENCES signals(id)
);
