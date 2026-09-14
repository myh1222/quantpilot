import type { BarRequest, MarketProvider } from "./provider.js";
import type { MarketBar } from "./rule.js";

type FetchLike = typeof globalThis.fetch;

export class YahooChartProvider implements MarketProvider {
  readonly name = "yahoo";

  constructor(
    private readonly fetchImpl: FetchLike = globalThis.fetch,
    private readonly baseUrl = "https://query1.finance.yahoo.com",
  ) {}

  async fetchBars(request: BarRequest): Promise<MarketBar[]> {
    const period1 = Math.floor(request.startMs / 1000);
    const period2 = Math.ceil(request.endMs / 1000);
    const interval = `${request.timeframeMinutes}m`;
    const url = new URL(
      `/v8/finance/chart/${encodeURIComponent(request.providerSymbol)}`,
      this.baseUrl,
    );
    url.searchParams.set("period1", String(period1));
    url.searchParams.set("period2", String(period2));
    url.searchParams.set("interval", interval);
    url.searchParams.set("includePrePost", "false");

    const response = await this.fetchImpl(url, {
      headers: { "User-Agent": "QuantPilot local alert poller" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Yahoo chart request failed with HTTP ${response.status}`);
    }

    return parseYahooBars(await response.json());
  }
}

export function parseYahooBars(payload: unknown): MarketBar[] {
  const chart = getProperty(payload, "chart");
  const error = getProperty(chart, "error");
  if (error !== null && error !== undefined) {
    throw new Error(`Yahoo chart error: ${JSON.stringify(error)}`);
  }

  const results = getProperty(chart, "result", []);
  if (!Array.isArray(results)) throw new Error("Yahoo chart response has invalid results");
  const result = results[0];
  if (result === undefined) throw new Error("Yahoo chart response has no result");

  const timestamps = getProperty(result, "timestamp", []);
  const indicators = getProperty(result, "indicators", {});
  const quotes = getProperty(indicators, "quote", []);
  if (!Array.isArray(quotes)) throw new Error("Yahoo chart response has invalid quotes");
  const quote = quotes[0] ?? {};
  const opens = getProperty(quote, "open", []);
  const highs = getProperty(quote, "high", []);
  const lows = getProperty(quote, "low", []);
  const closes = getProperty(quote, "close", []);
  const volumes = getProperty(quote, "volume", []);
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) {
    throw new Error("Yahoo chart response has invalid quote arrays");
  }

  const bars: MarketBar[] = [];
  for (const [index, timestamp] of timestamps.entries()) {
    const seconds = Number(timestamp);
    const close = Number(closes[index]);
    if (
      !Number.isSafeInteger(seconds) ||
      seconds <= 0 ||
      !Number.isFinite(close) ||
      close <= 0
    ) continue;
    const open = numericAt(opens, index);
    const high = numericAt(highs, index);
    const low = numericAt(lows, index);
    const volume = numericAt(volumes, index);
    bars.push({
      openTimeMs: seconds * 1000,
      close,
      ...(open === undefined ? {} : { open }),
      ...(high === undefined ? {} : { high }),
      ...(low === undefined ? {} : { low }),
      ...(volume === undefined ? {} : { volume }),
    });
  }
  return bars;
}

function numericAt(value: unknown, index: number): number | undefined {
  if (!Array.isArray(value)) return undefined;
  const item = value[index];
  if (item === null || item === undefined) return undefined;
  const number = Number(item);
  return Number.isFinite(number) ? number : undefined;
}

function getProperty(value: unknown, name: string, fallback?: unknown): unknown {
  if (value === null || typeof value !== "object") return fallback;
  const property = (value as Record<string, unknown>)[name];
  return property === undefined ? fallback : property;
}
