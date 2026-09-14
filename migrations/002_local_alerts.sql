CREATE TABLE IF NOT EXISTS local_alert_state (
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_symbol TEXT NOT NULL,
    last_evaluated_bar_ms INTEGER,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_polled_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(symbol, timeframe, provider)
);

CREATE INDEX IF NOT EXISTS idx_local_alert_state_failures
    ON local_alert_state(consecutive_failures, updated_at);
