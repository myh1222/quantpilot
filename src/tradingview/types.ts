export type TradingViewSnapshotRequest = {
  symbol: string;
  timeframeMinutes: number;
};

export type TradingViewSnapshot = {
  source: "tradingview-data-window";
  symbol: string;
  timeframeMinutes: number;
  fetchedAt: string;
  barTimeMs: number;
  close: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi14: number;
  atr14: number;
  volumeRatio20: number | null;
  dailyTrend: -1 | 0 | 1;
  technicalScore: number;
  support1: number | null;
  support2: number | null;
  resistance1: number | null;
  resistance2: number | null;
  support1ConfirmedAtMs: number | null;
  resistance1ConfirmedAtMs: number | null;
  confirmedSupports: number;
  confirmedResistances: number;
  supportTouches: number;
  resistanceTouches: number;
  supportBreaks: number;
  resistanceBreaks: number;
  scriptVersion: number;
};

export interface TradingViewSnapshotProvider {
  fetchSnapshot(request: TradingViewSnapshotRequest): Promise<TradingViewSnapshot>;
  close?(): Promise<void>;
}

export type TradingViewEnrichment =
  | { status: "disabled" }
  | { status: "unavailable"; error: string }
  | {
      status: "completed";
      snapshot: TradingViewSnapshot;
      alignment: {
        closeDifferencePercent: number;
        barTimeDifferenceMinutes: number;
        quality: "matched" | "diverged";
      };
    };
