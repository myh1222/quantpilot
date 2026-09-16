import { describe, expect, it } from "vitest";
import { parseTencentSearchResults, parseYahooSearchResults } from "../src/local-alerts/search.js";

describe("Yahoo symbol search", () => {
  it("normalizes quote candidates and caps the result count", () => {
    const quotes = Array.from({ length: 10 }, (_, index) => ({
      symbol: `00000${index}.SZ`,
      shortname: `股票${index}`,
      exchDisp: "Shenzhen",
      quoteType: "EQUITY",
    }));

    const results = parseYahooSearchResults({ quotes });

    expect(results).toHaveLength(8);
    expect(results[0]).toEqual({
      symbol: "000000.SZ",
      name: "股票0",
      exchange: "Shenzhen",
      quoteType: "EQUITY",
    });
  });

  it("drops invalid quotes instead of failing the whole search", () => {
    expect(parseYahooSearchResults({
      quotes: [{ symbol: "" }, null, { symbol: "002371.SZ", longname: "北方华创" }],
    })).toEqual([{
      symbol: "002371.SZ",
      name: "北方华创",
      exchange: null,
      quoteType: null,
    }]);
    expect(parseYahooSearchResults(null)).toEqual([]);
  });
});

describe("Tencent symbol search", () => {
  it("normalizes escaped smartbox candidates to Yahoo symbols", () => {
    const payload = 'v_hint="sz~300997~\\u6b22\\u4e50\\u5bb6~hlj~GP-A~sh~600519~\\u8d35\\u5dde\\u8305\\u53f0~gzmt~GP-A"';

    expect(parseTencentSearchResults(payload)).toEqual([
      { symbol: "300997.SZ", name: "欢乐家", exchange: "深圳", quoteType: "EQUITY", source: "tencent" },
      { symbol: "600519.SS", name: "贵州茅台", exchange: "上海", quoteType: "EQUITY", source: "tencent" },
    ]);
  });

  it("ignores unsupported payloads and markets", () => {
    expect(parseTencentSearchResults("invalid")).toEqual([]);
    expect(parseTencentSearchResults('v_hint="us~AAPL~APPLE~aapl~GP-A"')).toEqual([]);
  });

  it("normalizes Hong Kong equity candidates", () => {
    expect(parseTencentSearchResults('v_hint="hk~02513~智谱~zp~GP^hk~hk~13093~智谱汇丰六乙购A~zphflyga~QZ^hk"')).toEqual([{
      symbol: "02513.HK",
      name: "智谱",
      exchange: "香港",
      quoteType: "EQUITY",
      source: "tencent",
    }]);
  });
});
