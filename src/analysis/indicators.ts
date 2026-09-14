import type { MarketBar } from "../local-alerts/rule.js";

export type TechnicalSnapshot = {
  close: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi14: number;
  atr14: number;
  volumeRatio20: number | null;
};

export function ema(values: number[], length: number): number[] {
  if (values.length < length) return [];
  const result = new Array<number>(values.length).fill(Number.NaN);
  let seed = 0;
  for (let index = 0; index < length; index += 1) seed += values[index]!;
  result[length - 1] = seed / length;
  const multiplier = 2 / (length + 1);
  for (let index = length; index < values.length; index += 1) {
    result[index] = (values[index]! - result[index - 1]!) * multiplier + result[index - 1]!;
  }
  return result;
}

export function rsi(values: number[], length = 14): number[] {
  const result = new Array<number>(values.length).fill(Number.NaN);
  if (values.length <= length) return result;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= length; index += 1) {
    const change = values[index]! - values[index - 1]!;
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  let averageGain = gains / length;
  let averageLoss = losses / length;
  result[length] = rsiValue(averageGain, averageLoss);
  for (let index = length + 1; index < values.length; index += 1) {
    const change = values[index]! - values[index - 1]!;
    averageGain = (averageGain * (length - 1) + Math.max(change, 0)) / length;
    averageLoss = (averageLoss * (length - 1) + Math.max(-change, 0)) / length;
    result[index] = rsiValue(averageGain, averageLoss);
  }
  return result;
}

export function atr(bars: RequiredOhlcBar[], length = 14): number[] {
  const ranges = bars.map((bar, index) => index === 0
    ? bar.high - bar.low
    : Math.max(
        bar.high - bar.low,
        Math.abs(bar.high - bars[index - 1]!.close),
        Math.abs(bar.low - bars[index - 1]!.close),
      ));
  const result = new Array<number>(bars.length).fill(Number.NaN);
  if (ranges.length < length) return result;
  let value = ranges.slice(0, length).reduce((sum, range) => sum + range, 0) / length;
  result[length - 1] = value;
  for (let index = length; index < ranges.length; index += 1) {
    value = (value * (length - 1) + ranges[index]!) / length;
    result[index] = value;
  }
  return result;
}

export type RequiredOhlcBar = MarketBar & {
  open: number;
  high: number;
  low: number;
};

export function requireOhlc(bars: MarketBar[]): RequiredOhlcBar[] {
  return bars.filter((bar): bar is RequiredOhlcBar =>
    bar.open !== undefined && bar.high !== undefined && bar.low !== undefined
    && [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite));
}

export function technicalSnapshot(bars: RequiredOhlcBar[]): TechnicalSnapshot {
  if (bars.length < 200) throw new Error(`need at least 200 OHLC bars, received ${bars.length}`);
  const closes = bars.map((bar) => bar.close);
  const last = bars.length - 1;
  const ema20 = ema(closes, 20)[last]!;
  const ema50 = ema(closes, 50)[last]!;
  const ema200 = ema(closes, 200)[last]!;
  const rsi14 = rsi(closes, 14)[last]!;
  const atr14 = atr(bars, 14)[last]!;
  const volumes = bars.slice(-20).map((bar) => bar.volume).filter((value): value is number => value !== undefined);
  const averageVolume = volumes.length === 20
    ? volumes.slice(0, -1).reduce((sum, value) => sum + value, 0) / 19
    : 0;
  return {
    close: bars[last]!.close,
    ema20,
    ema50,
    ema200,
    rsi14,
    atr14,
    volumeRatio20: averageVolume > 0 && bars[last]!.volume !== undefined
      ? bars[last]!.volume / averageVolume
      : null,
  };
}

function rsiValue(averageGain: number, averageLoss: number): number {
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + averageGain / averageLoss);
}
