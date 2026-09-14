import type { SignalPayload } from "../signals/payload.js";

export type MarketBar = {
  openTimeMs: number;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
};

export type RuleState = {
  lastEvaluatedBarMs: number | null;
};

export type RuleOptions = {
  symbol: string;
  timeframe: string;
  emaLength: number;
  pineConfigVersion: number;
  alertInstanceId: string;
};

export type RuleResult = {
  status: "insufficient_history" | "armed" | "evaluated";
  state: RuleState;
  signals: Array<Pick<
    SignalPayload,
    "event" | "price" | "probe_ema" | "bar_open_time_ms"
  >>;
};

export function evaluateEmaCross(
  bars: Array<MarketBar | undefined>,
  previousState: RuleState,
  options: RuleOptions,
): RuleResult {
  const cleanBars = deduplicateBars(bars);
  if (cleanBars.length < options.emaLength) {
    return {
      status: "insufficient_history",
      state: previousState,
      signals: [],
    };
  }

  const emaValues = calculateEmaValues(
    cleanBars.map((bar) => bar.close),
    options.emaLength,
  );
  const lastIndex = cleanBars.length - 1;

  // A cold start intentionally arms rather than replaying historical crosses.
  if (previousState.lastEvaluatedBarMs === null) {
    return {
      status: "armed",
      state: { lastEvaluatedBarMs: cleanBars[lastIndex].openTimeMs },
      signals: [],
    };
  }

  const cursor = previousState.lastEvaluatedBarMs;
  const firstNewIndex = cleanBars.findIndex((bar) => bar.openTimeMs > cursor);
  if (firstNewIndex === -1) {
    return {
      status: "evaluated",
      state: previousState,
      signals: [],
    };
  }

  // If the persisted cursor predates the fetched window, restart in armed mode
  // instead of evaluating an incomplete historical gap.
  if (firstNewIndex === 0) {
    return {
      status: "armed",
      state: { lastEvaluatedBarMs: cleanBars[lastIndex].openTimeMs },
      signals: [],
    };
  }

  const signals: RuleResult["signals"] = [];
  for (let index = firstNewIndex; index < cleanBars.length; index += 1) {
    const bar = cleanBars[index];
    const previous = cleanBars[index - 1];
    const ema = emaValues[index];
    const previousEma = emaValues[index - 1];
    if (ema === undefined || previousEma === undefined) continue;
    const crossedUp = previous.close <= previousEma && bar.close > ema;
    const crossedDown = previous.close >= previousEma && bar.close < ema;

    if (crossedUp || crossedDown) {
      signals.push({
        event: crossedUp ? "EMA_CROSS_UP" : "EMA_CROSS_DOWN",
        price: bar.close,
        probe_ema: ema,
        bar_open_time_ms: bar.openTimeMs,
      });
    }
  }

  return {
    status: "evaluated",
    state: { lastEvaluatedBarMs: cleanBars[lastIndex].openTimeMs },
    signals,
  };
}

function deduplicateBars(bars: Array<MarketBar | undefined>): MarketBar[] {
  const byOpenTime = new Map<number, MarketBar>();
  for (const bar of bars) {
    if (
      bar === undefined ||
      !Number.isSafeInteger(bar.openTimeMs) ||
      bar.openTimeMs <= 0 ||
      !Number.isFinite(bar.close) ||
      bar.close <= 0
    ) continue;
    byOpenTime.set(bar.openTimeMs, bar);
  }
  return [...byOpenTime.values()].sort((left, right) => left.openTimeMs - right.openTimeMs);
}

function calculateEmaValues(closes: number[], length: number): Array<number | undefined> {
  const values: Array<number | undefined> = new Array(closes.length).fill(undefined);
  if (closes.length < length) return values;

  const multiplier = 2 / (length + 1);
  let seed = 0;
  for (let index = 0; index < length; index += 1) seed += closes[index];
  values[length - 1] = seed / length;

  for (let index = length; index < closes.length; index += 1) {
    const previous = values[index - 1];
    if (previous === undefined) continue;
    values[index] = (closes[index] - previous) * multiplier + previous;
  }
  return values;
}
