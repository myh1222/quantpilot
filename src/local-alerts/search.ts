export type SymbolSearchResult = {
  symbol: string;
  name: string;
  exchange: string | null;
  quoteType: string | null;
  source?: string;
};

type FetchLike = typeof globalThis.fetch;

export class YahooSymbolSearch {
  constructor(
    private readonly fetchImpl: FetchLike = globalThis.fetch,
    private readonly baseUrl = "https://query2.finance.yahoo.com",
  ) {}

  async search(query: string): Promise<SymbolSearchResult[]> {
    const url = new URL("/v1/finance/search", this.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("quotesCount", "8");
    url.searchParams.set("newsCount", "0");
    const response = await this.fetchImpl(url, {
      headers: { "User-Agent": "QuantPilot local symbol search" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`Yahoo symbol search failed with HTTP ${response.status}`);
    }
    return parseYahooSearchResults(await response.json());
  }
}

export class TencentSymbolSearch {
  constructor(
    private readonly fetchImpl: FetchLike = globalThis.fetch,
    private readonly baseUrl = "https://smartbox.gtimg.cn",
  ) {}

  async search(query: string): Promise<SymbolSearchResult[]> {
    const url = new URL("/s3/", this.baseUrl);
    url.searchParams.set("v", "2");
    url.searchParams.set("q", query);
    url.searchParams.set("t", "all");
    const response = await this.fetchImpl(url, {
      headers: { "User-Agent": "QuantPilot local symbol search" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`Tencent symbol search failed with HTTP ${response.status}`);
    }
    return parseTencentSearchResults(await response.text());
  }
}

export function parseYahooSearchResults(payload: unknown): SymbolSearchResult[] {
  if (payload === null || typeof payload !== "object") return [];
  const quotes = (payload as Record<string, unknown>).quotes;
  if (!Array.isArray(quotes)) return [];

  const results: SymbolSearchResult[] = [];
  for (const quote of quotes) {
    if (quote === null || typeof quote !== "object") continue;
    const record = quote as Record<string, unknown>;
    const symbol = record.symbol;
    if (typeof symbol !== "string" || symbol.trim() === "") continue;
    results.push({
      symbol: symbol.trim(),
      name: text(record.shortname) ?? text(record.longname) ?? symbol.trim(),
      exchange: text(record.exchDisp),
      quoteType: text(record.quoteType),
    });
  }
  return results.slice(0, 8);
}

export function parseTencentSearchResults(payload: string): SymbolSearchResult[] {
  const escaped = payload.match(/^v_hint="([^"]*)"$/);
  if (escaped === null) return [];
  const unescaped = unescapeTencentText(escaped[1] ?? "");
  const results: SymbolSearchResult[] = [];
  const fields = unescaped.split("~").map((part) => part.trim());
  for (let index = 0; index + 2 < fields.length; index += 5) {
    const [market, code, name, _acronym, type] = fields.slice(index, index + 5);
    if (market === undefined || code === undefined || name === undefined) continue;
    if (!type?.startsWith("GP")) continue;
    const suffix = tencentMarketSuffix(market);
    if (suffix === null) continue;
    results.push({
      symbol: `${code}${suffix}`,
      name,
      exchange: tencentExchange(market),
      quoteType: tencentQuoteType(type),
      source: "tencent",
    });
  }
  return results.slice(0, 8);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function unescapeTencentText(value: string): string {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)));
}

function tencentMarketSuffix(market: string): string | null {
  if (market === "sh") return ".SS";
  if (market === "sz") return ".SZ";
  if (market === "bj") return ".BJ";
  if (market === "hk") return ".HK";
  return null;
}

function tencentExchange(market: string): string {
  if (market === "sh") return "上海";
  if (market === "sz") return "深圳";
  if (market === "bj") return "北京";
  if (market === "hk") return "香港";
  return market.toUpperCase();
}

function tencentQuoteType(type: string | undefined): string | null {
  if (type === undefined) return null;
  if (type.startsWith("GP")) return "EQUITY";
  if (type.startsWith("ZS")) return "INDEX";
  if (type.startsWith("JJ")) return "FUND";
  return type;
}
