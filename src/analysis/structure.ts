import type { RequiredOhlcBar } from "./indicators.js";

export type LevelKind = "support" | "resistance";
export type StructureLevel = {
  id: string;
  kind: LevelKind;
  price: number;
  pivotBarMs: number;
  confirmedAtMs: number;
  status: "ACTIVE" | "BROKEN" | "INVALIDATED";
  brokenAtMs: number | null;
  touches: number;
};

export type StructureSnapshot = {
  supports: StructureLevel[];
  resistances: StructureLevel[];
  allLevels: StructureLevel[];
  statistics: {
    confirmed: number;
    active: number;
    broken: number;
    invalidated: number;
    touches: number;
    supportBreakRate: number | null;
    resistanceBreakRate: number | null;
  };
};

export function analyzeStructure(
  bars: RequiredOhlcBar[],
  options: { left: number; right: number; touchTolerance: number; maxAgeBars: number },
): StructureSnapshot {
  const levels: StructureLevel[] = [];
  for (let index = options.left; index < bars.length - options.right; index += 1) {
    const window = bars.slice(index - options.left, index + options.right + 1);
    const bar = bars[index]!;
    const isHigh = window.every((candidate) => candidate.high <= bar.high)
      && window.some((candidate) => candidate !== bar && candidate.high < bar.high);
    const isLow = window.every((candidate) => candidate.low >= bar.low)
      && window.some((candidate) => candidate !== bar && candidate.low > bar.low);
    const confirmedIndex = index + options.right;
    if (isLow) levels.push(trackLevel("support", bar.low, index, confirmedIndex, bars, options));
    if (isHigh) levels.push(trackLevel("resistance", bar.high, index, confirmedIndex, bars, options));
  }

  const lastIndex = bars.length - 1;
  const eligible = levels.filter((level) => {
    const confirmedIndex = bars.findIndex((bar) => bar.openTimeMs === level.confirmedAtMs);
    return confirmedIndex >= 0 && lastIndex - confirmedIndex <= options.maxAgeBars;
  });
  const close = bars.at(-1)!.close;
  const supports = eligible.filter((level) => level.status === "ACTIVE" && level.price < close)
    .sort((left, right) => right.price - left.price).slice(0, 2);
  const resistances = eligible.filter((level) => level.status === "ACTIVE" && level.price > close)
    .sort((left, right) => left.price - right.price).slice(0, 2);
  const supportLevels = levels.filter((level) => level.kind === "support");
  const resistanceLevels = levels.filter((level) => level.kind === "resistance");
  return {
    supports,
    resistances,
    allLevels: levels,
    statistics: {
      confirmed: levels.length,
      active: levels.filter((level) => level.status === "ACTIVE").length,
      broken: levels.filter((level) => level.status === "BROKEN").length,
      invalidated: levels.filter((level) => level.status === "INVALIDATED").length,
      touches: levels.reduce((sum, level) => sum + level.touches, 0),
      supportBreakRate: rate(supportLevels),
      resistanceBreakRate: rate(resistanceLevels),
    },
  };
}

function trackLevel(
  kind: LevelKind,
  price: number,
  pivotIndex: number,
  confirmedIndex: number,
  bars: RequiredOhlcBar[],
  options: { touchTolerance: number },
): StructureLevel {
  let touches = 0;
  let brokenAtMs: number | null = null;
  const invalidAtConfirmation = kind === "support"
    ? bars[confirmedIndex]!.close < price
    : bars[confirmedIndex]!.close > price;
  if (invalidAtConfirmation) {
    return {
      id: `pivot-${kind}-${bars[pivotIndex]!.openTimeMs}`,
      kind,
      price,
      pivotBarMs: bars[pivotIndex]!.openTimeMs,
      confirmedAtMs: bars[confirmedIndex]!.openTimeMs,
      status: "INVALIDATED",
      brokenAtMs: null,
      touches: 0,
    };
  }
  for (let index = confirmedIndex + 1; index < bars.length; index += 1) {
    const bar = bars[index]!;
    if (kind === "support" && bar.close < price) {
      brokenAtMs = bar.openTimeMs;
      break;
    }
    if (kind === "resistance" && bar.close > price) {
      brokenAtMs = bar.openTimeMs;
      break;
    }
    const distance = kind === "support" ? Math.abs(bar.low - price) : Math.abs(bar.high - price);
    if (distance / price <= options.touchTolerance) touches += 1;
  }
  return {
    id: `pivot-${kind}-${bars[pivotIndex]!.openTimeMs}`,
    kind,
    price,
    pivotBarMs: bars[pivotIndex]!.openTimeMs,
    confirmedAtMs: bars[confirmedIndex]!.openTimeMs,
    status: brokenAtMs === null ? "ACTIVE" : "BROKEN",
    brokenAtMs,
    touches,
  };
}

function rate(levels: StructureLevel[]): number | null {
  const activated = levels.filter((level) => level.status !== "INVALIDATED");
  if (activated.length === 0) return null;
  return activated.filter((level) => level.status === "BROKEN").length / activated.length;
}
