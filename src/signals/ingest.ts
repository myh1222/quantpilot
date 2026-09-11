import type { Db } from "../db/database.js";
import { deliveryKey, logicalEventKey } from "./identity.js";
import type { SignalPayload } from "./payload.js";

export type IngestResult = {
  delivery: "accepted" | "duplicate" | "stale_config";
  signalId?: number;
};

export function ingestSignal(
  db: Db,
  payload: SignalPayload,
  currentPineConfigVersion: number,
  now = new Date(),
): IngestResult {
  const receivedAt = now.toISOString();
  const delivery = deliveryKey(payload);
  const logical = logicalEventKey(payload);
  const [exchange, ticker] = payload.symbol.split(":", 2) as [string, string];

  const transaction = db.transaction((): IngestResult => {
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO webhook_deliveries (
        delivery_key, logical_event_key, alert_instance_id,
        pine_config_version, processing_status, raw_payload, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      delivery,
      logical,
      payload.alert_instance_id,
      payload.pine_config_version,
      payload.pine_config_version === currentPineConfigVersion ? "accepted" : "stale_config",
      JSON.stringify(payload),
      receivedAt,
    );

    if (inserted.changes === 0) return { delivery: "duplicate" };
    if (payload.pine_config_version !== currentPineConfigVersion) {
      return { delivery: "stale_config" };
    }

    db.prepare(`
      INSERT INTO symbols (
        symbol, exchange, ticker, membership_status, metadata_status,
        enabled, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, 'pending', 'pending', 1, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET last_seen_at = excluded.last_seen_at
    `).run(payload.symbol, exchange, ticker, receivedAt, receivedAt);

    db.prepare(`
      INSERT OR IGNORE INTO signals (
        logical_event_key, symbol, timeframe, event, schema_version,
        selected_pine_config_version, bar_open_time_ms, signal_price,
        payload, received_at, analysis_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      logical,
      payload.symbol,
      payload.timeframe,
      payload.event,
      payload.schema_version,
      payload.pine_config_version,
      payload.bar_open_time_ms,
      payload.price,
      JSON.stringify(payload),
      receivedAt,
    );

    const signal = db.prepare("SELECT id FROM signals WHERE logical_event_key = ?")
      .get(logical) as { id: number };
    db.prepare(`
      INSERT OR IGNORE INTO jobs (
        signal_id, job_type, status, next_retry_at, created_at, updated_at
      ) VALUES (?, 'record_spike', 'pending', ?, ?, ?)
    `).run(signal.id, receivedAt, receivedAt, receivedAt);

    return { delivery: "accepted", signalId: signal.id };
  });
  return transaction();
}
