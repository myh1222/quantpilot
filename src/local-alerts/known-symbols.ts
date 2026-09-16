export type KnownSymbol = {
  symbol: string;
  name: string;
  exchange: string;
};

// A small offline fallback for frequently used China-market symbols.
export const knownSymbols: KnownSymbol[] = [
  { symbol: "002371.SZ", name: "北方华创 NAURA", exchange: "深圳" },
  { symbol: "600519.SS", name: "贵州茅台 KWEICHOW MOUTAI", exchange: "上海" },
  { symbol: "601318.SS", name: "中国平安 PING AN", exchange: "上海" },
  { symbol: "000858.SZ", name: "五粮液 WULIANGYE", exchange: "深圳" },
  { symbol: "300750.SZ", name: "宁德时代 CATL", exchange: "深圳" },
  { symbol: "603986.SS", name: "兆易创新 GIGADEVICE", exchange: "上海" },
  { symbol: "688981.SS", name: "中芯国际 SMIC", exchange: "上海" },
  { symbol: "300997.SZ", name: "欢乐家 HUANLEJIA", exchange: "深圳" },
  { symbol: "0981.HK", name: "中芯国际 SMIC", exchange: "香港" },
  { symbol: "9988.HK", name: "阿里巴巴 ALIBABA", exchange: "香港" },
  { symbol: "0700.HK", name: "腾讯控股 TENCENT", exchange: "香港" },
  { symbol: "AAPL", name: "苹果 APPLE", exchange: "NASDAQ" },
  { symbol: "NVDA", name: "英伟达 NVIDIA", exchange: "NASDAQ" },
  { symbol: "TSLA", name: "特斯拉 TESLA", exchange: "NASDAQ" },
  { symbol: "MSFT", name: "微软 MICROSOFT", exchange: "NASDAQ" },
];

export function searchKnownSymbols(query: string): KnownSymbol[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") return [];
  return knownSymbols
    .filter((item) =>
      item.symbol.toLowerCase().includes(normalized)
      || item.name.toLowerCase().includes(normalized))
    .slice(0, 8);
}
