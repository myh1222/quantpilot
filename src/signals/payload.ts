import { z } from "zod";

export const supportedEvents = [
  "PROBE_BAR_CLOSE",
  "EMA_CROSS_UP",
  "EMA_CROSS_DOWN",
  "ENTER_STRONG_LONG",
  "ENTER_STRONG_SHORT",
  "BREAK_RESISTANCE_1",
  "BREAK_SUPPORT_1",
  "BULL_ALIGNMENT",
  "BEAR_ALIGNMENT",
  "RSI_OVERSOLD_RECOVERY",
  "RSI_OVERBOUGHT_FALLBACK",
  "HEARTBEAT",
] as const;

export const signalPayloadSchema = z.object({
  schema_version: z.literal(1),
  pine_config_version: z.number().int().positive(),
  alert_instance_id: z.string().min(1).max(128),
  run_id: z.string().min(1).max(128).optional(),
  symbol: z.string().regex(/^[^:\s]+:[^:\s]+$/).max(64),
  ticker: z.string().min(1).max(32),
  timeframe: z.string().regex(/^(?:\d+m|\d+[DWM])$/),
  event: z.enum(supportedEvents),
  price: z.number().finite().positive(),
  bar_open_time_ms: z.number().int().positive(),
  probe_ema: z.number().finite().optional(),
}).passthrough();

export type SignalPayload = z.infer<typeof signalPayloadSchema>;
