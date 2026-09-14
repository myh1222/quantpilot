import type { MarketBar } from "./rule.js";

export type BarRequest = {
  providerSymbol: string;
  timeframeMinutes: number;
  startMs: number;
  endMs: number;
};

export interface MarketProvider {
  readonly name: string;
  fetchBars(request: BarRequest): Promise<MarketBar[]>;
}
