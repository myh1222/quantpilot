import { createHash } from "node:crypto";
import type { SignalPayload } from "./payload.js";

function hash(parts: Array<string | number>): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

export function deliveryKey(payload: SignalPayload): string {
  return hash([
    payload.alert_instance_id,
    payload.pine_config_version,
    payload.symbol,
    payload.timeframe,
    payload.event,
    payload.bar_open_time_ms,
  ]);
}

export function logicalEventKey(payload: SignalPayload): string {
  return hash([
    payload.symbol,
    payload.timeframe,
    payload.event,
    payload.bar_open_time_ms,
  ]);
}
