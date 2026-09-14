import type { Db } from "../db/database.js";
import type { SignalPayload } from "../signals/payload.js";
import { ingestSignal } from "../signals/ingest.js";
import type { RuleState } from "./rule.js";

export type LocalAlertStateRow = {
  lastEvaluatedBarMs: number | null;
  last_evaluated_bar_ms: number | null;
  consecutive_failures: number;
};

export type LocalAlertStateKey = {
  symbol: string;
  timeframe: string;
  provider: string;
};

export type PersistSuccessInput = {
  key: LocalAlertStateKey;
  providerSymbol: string;
  pineConfigVersion: number;
  alertInstanceId: string;
  runId: string;
  result: {
    state: RuleState;
    signals: Array<Pick<
      SignalPayload,
      "event" | "price" | "probe_ema" | "bar_open_time_ms"
    >>;
  };
  now: Date;
};

export function getLocalAlertState(db: Db, key: LocalAlertStateKey): LocalAlertStateRow {
  const row = db.prepare(`
    SELECT last_evaluated_bar_ms, consecutive_failures
    FROM local_alert_state
    WHERE symbol = ? AND timeframe = ? AND provider = ?
  `).get(key.symbol, key.timeframe, key.provider) as LocalAlertStateRow | undefined;
  if (row !== undefined) return { ...row, lastEvaluatedBarMs: row.last_evaluated_bar_ms };
  return { lastEvaluatedBarMs: null, last_evaluated_bar_ms: null, consecutive_failures: 0 };
}

export function persistEvaluationSuccess(db: Db, input: PersistSuccessInput): void {
  const transaction = db.transaction(() => {
    for (const signal of input.result.signals) {
      ingestSignal(
        db,
        buildSignalPayload(input, signal),
        input.pineConfigVersion,
        input.now,
        { jobType: "notify_local_alert" },
      );
    }

    upsertState(db, input.key, input.providerSymbol, {
      lastEvaluatedBarMs: input.result.state.lastEvaluatedBarMs,
      consecutiveFailures: 0,
      lastError: null,
      lastPolledAt: input.now,
      updatedAt: input.now,
    });
  });
  transaction();
}

export function persistProviderFailure(
  db: Db,
  key: LocalAlertStateKey,
  providerSymbol: string,
  error: unknown,
  now: Date,
): void {
  const existing = getLocalAlertState(db, key);
  upsertState(db, key, providerSymbol, {
    lastEvaluatedBarMs: existing.last_evaluated_bar_ms,
    consecutiveFailures: existing.consecutive_failures + 1,
    lastError: error instanceof Error ? error.message : String(error),
    lastPolledAt: now,
    updatedAt: now,
  });
}

function upsertState(
  db: Db,
  key: LocalAlertStateKey,
  providerSymbol: string,
  values: {
    lastEvaluatedBarMs: number | null;
    consecutiveFailures: number;
    lastError: string | null;
    lastPolledAt: Date;
    updatedAt: Date;
  },
): void {
  db.prepare(`
    INSERT INTO local_alert_state (
      symbol, timeframe, provider, provider_symbol, last_evaluated_bar_ms,
      consecutive_failures, last_error, last_polled_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol, timeframe, provider) DO UPDATE SET
      provider_symbol = excluded.provider_symbol,
      last_evaluated_bar_ms = excluded.last_evaluated_bar_ms,
      consecutive_failures = excluded.consecutive_failures,
      last_error = excluded.last_error,
      last_polled_at = excluded.last_polled_at,
      updated_at = excluded.updated_at
  `).run(
    key.symbol,
    key.timeframe,
    key.provider,
    providerSymbol,
    values.lastEvaluatedBarMs,
    values.consecutiveFailures,
    values.lastError,
    values.lastPolledAt.toISOString(),
    values.updatedAt.toISOString(),
  );
}

function buildSignalPayload(
  input: PersistSuccessInput,
  signal: PersistSuccessInput["result"]["signals"][number],
): SignalPayload {
  return {
    schema_version: 1,
    pine_config_version: input.pineConfigVersion,
    alert_instance_id: input.alertInstanceId,
    run_id: input.runId,
    symbol: input.key.symbol,
    ticker: input.key.symbol.split(":", 2)[1],
    timeframe: input.key.timeframe,
    event: signal.event,
    price: signal.price,
    probe_ema: signal.probe_ema,
    bar_open_time_ms: signal.bar_open_time_ms,
  };
}
